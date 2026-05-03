import { describe, expect, it } from "vitest";
import { CommitRevealRound } from "../../src/mechanism/commit-reveal.js";
import {
  EventBus,
  InProcessTransportBackend,
} from "../../src/transport/backends/in-process.js";
import type { TransportMessage } from "../../src/transport/backend.js";

/**
 * Two participants run a full commit-reveal round over the EventBus.
 * If this passes, swapping the in-process transport for any other transport
 * is a deployment problem, not a logic problem.
 */
describe("mechanism over transport (integration)", () => {
  it("two participants reach RESOLVED with median(reveals, anchor)", async () => {
    const bus = new EventBus();
    const aliceT = new InProcessTransportBackend(bus, "alice");
    const bobT = new InProcessTransportBackend(bus, "bob");

    // Alice runs the round; Bob does too. They share state via a single
    // CommitRevealRound on each side, fed by transport.
    const cfg = {
      participants: ["alice", "bob"] as [string, string],
      commitTimeoutMs: 1_000,
      revealTimeoutMs: 1_000,
      normalization: 1,
      anchor: async () => 25, // outside the [10, 20] interval -> median = 20
    };

    const aliceRound = new CommitRevealRound(cfg);
    const bobRound = new CommitRevealRound(cfg);

    // Each side records events for its own observability.
    const aliceEvents: string[] = [];
    const bobEvents: string[] = [];

    const aliceP = aliceRound.run(async (e) => {
      aliceEvents.push(e.type);
    });
    const bobP = bobRound.run(async (e) => {
      bobEvents.push(e.type);
    });

    // Wire commit topic: each side publishes its commit and ingests its peer's.
    await aliceT.subscribe("commit", async (msg: TransportMessage) => {
      aliceRound.ingestCommit(msg.from, msg.payload as string);
    });
    await bobT.subscribe("commit", async (msg: TransportMessage) => {
      bobRound.ingestCommit(msg.from, msg.payload as string);
    });
    await aliceT.subscribe("reveal", async (msg: TransportMessage) => {
      const { value, salt } = msg.payload as { value: number; salt: string };
      aliceRound.ingestReveal(msg.from, value, salt);
    });
    await bobT.subscribe("reveal", async (msg: TransportMessage) => {
      const { value, salt } = msg.payload as { value: number; salt: string };
      bobRound.ingestReveal(msg.from, value, salt);
    });

    const aliceValue = 10;
    const aliceSalt = CommitRevealRound.randomSalt();
    const bobValue = 20;
    const bobSalt = CommitRevealRound.randomSalt();

    const aliceCommit = CommitRevealRound.commit(aliceValue, aliceSalt);
    const bobCommit = CommitRevealRound.commit(bobValue, bobSalt);

    // Alice ingests her own commit locally and broadcasts to Bob.
    aliceRound.ingestCommit("alice", aliceCommit);
    await aliceT.send({
      from: "alice",
      to: "broadcast",
      topic: "commit",
      payload: aliceCommit,
      nonce: "c-a",
    });
    bobRound.ingestCommit("bob", bobCommit);
    await bobT.send({
      from: "bob",
      to: "broadcast",
      topic: "commit",
      payload: bobCommit,
      nonce: "c-b",
    });

    // Wait one tick for the bus deliveries.
    await new Promise((r) => setTimeout(r, 0));

    // Now reveals.
    aliceRound.ingestReveal("alice", aliceValue, aliceSalt);
    await aliceT.send({
      from: "alice",
      to: "broadcast",
      topic: "reveal",
      payload: { value: aliceValue, salt: aliceSalt },
      nonce: "r-a",
    });
    bobRound.ingestReveal("bob", bobValue, bobSalt);
    await bobT.send({
      from: "bob",
      to: "broadcast",
      topic: "reveal",
      payload: { value: bobValue, salt: bobSalt },
      nonce: "r-b",
    });

    const [aliceFinal, bobFinal] = await Promise.all([aliceP, bobP]);

    expect(aliceFinal.phase).toBe("resolved");
    expect(bobFinal.phase).toBe("resolved");
    if (aliceFinal.phase !== "resolved" || bobFinal.phase !== "resolved")
      return;

    // Both sides agree on the resolution = median(10, 20, 25) = 20.
    expect(aliceFinal.resolution).toBe(20);
    expect(bobFinal.resolution).toBe(20);

    // And both sides assigned scores to both participants.
    expect(aliceFinal.scores.size).toBe(2);
    expect(aliceFinal.scores.get("alice")).toBe(
      CommitRevealRound.score(10, 20, 1),
    );
    expect(aliceFinal.scores.get("bob")).toBe(
      CommitRevealRound.score(20, 20, 1),
    );
  });
});
