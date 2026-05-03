import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommitRevealRound } from "../../src/mechanism/commit-reveal.js";
import type {
  ParticipantId,
  RoundConfig,
  RoundEvent,
} from "../../src/mechanism/types.js";

const ALICE: ParticipantId = "alice";
const BOB: ParticipantId = "bob";

const baseCfg = (
  overrides: Partial<RoundConfig> = {},
): RoundConfig => ({
  participants: [ALICE, BOB],
  commitTimeoutMs: 1_000,
  revealTimeoutMs: 1_000,
  normalization: 1,
  ...overrides,
});

const makeSink = () => {
  const events: RoundEvent[] = [];
  return {
    events,
    submit: async (event: RoundEvent) => {
      events.push(event);
    },
  };
};

describe("CommitRevealRound.commit (static)", () => {
  it("1. produces deterministic hashes for the same (value, salt)", () => {
    expect(CommitRevealRound.commit(42, "deadbeef")).toBe(
      CommitRevealRound.commit(42, "deadbeef"),
    );
  });

  it("2. is hiding: different salts produce different hashes for the same value", () => {
    expect(CommitRevealRound.commit(42, "saltA")).not.toBe(
      CommitRevealRound.commit(42, "saltB"),
    );
  });
});

describe("CommitRevealRound.score (static)", () => {
  it("3. is zero at the resolution point", () => {
    expect(CommitRevealRound.score(5, 5, 1)).toBe(0);
  });

  it("4. is negative and monotonically decreasing in |x - resolution|", () => {
    const near = CommitRevealRound.score(5.5, 5, 1);
    const far = CommitRevealRound.score(7, 5, 1);
    expect(near).toBeLessThan(0);
    expect(far).toBeLessThan(near);
  });

  it("5. penalizes quadratically: doubling distance quadruples |penalty|", () => {
    const d1 = Math.abs(CommitRevealRound.score(6, 5, 1));
    const d2 = Math.abs(CommitRevealRound.score(7, 5, 1));
    expect(d2).toBeCloseTo(4 * d1, 10);
  });
});

describe("CommitRevealRound.run state transitions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("6. transitions IDLE -> COMMITTING on first commit", async () => {
    const round = new CommitRevealRound(baseCfg());
    const { submit } = makeSink();
    const promise = round.run(submit);
    round.ingestCommit(ALICE, CommitRevealRound.commit(10, "salt-a"));
    expect(round.peek().phase).toBe("committing");
    vi.runAllTimers();
    await promise;
  });

  it("7. transitions COMMITTING -> REVEALING after both commits", async () => {
    const round = new CommitRevealRound(baseCfg());
    const { submit } = makeSink();
    const promise = round.run(submit);
    round.ingestCommit(ALICE, CommitRevealRound.commit(10, "salt-a"));
    round.ingestCommit(BOB, CommitRevealRound.commit(20, "salt-b"));
    await Promise.resolve();
    expect(round.peek().phase).toBe("revealing");
    vi.runAllTimers();
    await promise;
  });

  it("8. rejects reveals before all commits received", async () => {
    const round = new CommitRevealRound(baseCfg());
    const { submit } = makeSink();
    const promise = round.run(submit);
    round.ingestCommit(ALICE, CommitRevealRound.commit(10, "salt-a"));
    expect(() => round.ingestReveal(ALICE, 10, "salt-a")).toThrow();
    vi.runAllTimers();
    await promise;
  });

  it("9. aborts when a reveal's hash does not match the commit", async () => {
    const round = new CommitRevealRound(baseCfg());
    const { events, submit } = makeSink();
    const promise = round.run(submit);
    round.ingestCommit(ALICE, CommitRevealRound.commit(10, "salt-a"));
    round.ingestCommit(BOB, CommitRevealRound.commit(20, "salt-b"));
    await Promise.resolve();
    round.ingestReveal(ALICE, 10, "salt-a");
    round.ingestReveal(BOB, 999, "wrong-salt");
    const final = await promise;
    expect(final.phase).toBe("aborted");
    if (final.phase === "aborted") {
      expect(final.reason).toBe("invalid_reveal");
    }
    expect(events.some((e) => e.type === "aborted")).toBe(true);
  });

  it("10. transitions REVEALING -> RESOLVED with median resolution (no anchor)", async () => {
    const round = new CommitRevealRound(baseCfg());
    const { submit } = makeSink();
    const promise = round.run(submit);
    round.ingestCommit(ALICE, CommitRevealRound.commit(10, "salt-a"));
    round.ingestCommit(BOB, CommitRevealRound.commit(20, "salt-b"));
    await Promise.resolve();
    round.ingestReveal(ALICE, 10, "salt-a");
    round.ingestReveal(BOB, 20, "salt-b");
    const final = await promise;
    expect(final.phase).toBe("resolved");
    if (final.phase === "resolved") {
      // No anchor: arithmetic mean of two reveals.
      expect(final.resolution).toBe(15);
    }
  });

  it("11. with anchor uses median of three", async () => {
    const round = new CommitRevealRound(
      baseCfg({ anchor: async () => 25 }),
    );
    const { submit } = makeSink();
    const promise = round.run(submit);
    round.ingestCommit(ALICE, CommitRevealRound.commit(10, "salt-a"));
    round.ingestCommit(BOB, CommitRevealRound.commit(20, "salt-b"));
    await Promise.resolve();
    round.ingestReveal(ALICE, 10, "salt-a");
    round.ingestReveal(BOB, 20, "salt-b");
    const final = await promise;
    expect(final.phase).toBe("resolved");
    if (final.phase === "resolved") {
      // median(10, 20, 25) = 20
      expect(final.resolution).toBe(20);
    }
  });

  it("12. without anchor uses arithmetic mean of two reveals", async () => {
    const round = new CommitRevealRound(baseCfg());
    const { submit } = makeSink();
    const promise = round.run(submit);
    round.ingestCommit(ALICE, CommitRevealRound.commit(8, "salt-a"));
    round.ingestCommit(BOB, CommitRevealRound.commit(12, "salt-b"));
    await Promise.resolve();
    round.ingestReveal(ALICE, 8, "salt-a");
    round.ingestReveal(BOB, 12, "salt-b");
    const final = await promise;
    expect(final.phase).toBe("resolved");
    if (final.phase === "resolved") {
      expect(final.resolution).toBe(10);
    }
  });

  it("13. transitions to ABORTED on commit timeout", async () => {
    const round = new CommitRevealRound(
      baseCfg({ commitTimeoutMs: 100 }),
    );
    const { events, submit } = makeSink();
    const promise = round.run(submit);
    round.ingestCommit(ALICE, CommitRevealRound.commit(10, "salt-a"));
    // Bob never commits.
    vi.advanceTimersByTime(150);
    const final = await promise;
    expect(final.phase).toBe("aborted");
    if (final.phase === "aborted") {
      expect(final.reason).toBe("timeout");
    }
    expect(
      events.some((e) => e.type === "aborted" && e.reason === "timeout"),
    ).toBe(true);
  });

  it("14. transitions to ABORTED on reveal timeout", async () => {
    const round = new CommitRevealRound(
      baseCfg({ commitTimeoutMs: 1_000, revealTimeoutMs: 100 }),
    );
    const { submit } = makeSink();
    const promise = round.run(submit);
    round.ingestCommit(ALICE, CommitRevealRound.commit(10, "salt-a"));
    round.ingestCommit(BOB, CommitRevealRound.commit(20, "salt-b"));
    await Promise.resolve();
    round.ingestReveal(ALICE, 10, "salt-a");
    // Bob never reveals.
    vi.advanceTimersByTime(150);
    const final = await promise;
    expect(final.phase).toBe("aborted");
    if (final.phase === "aborted") {
      expect(final.reason).toBe("timeout");
    }
  });

  it("15. emits events in order: commit_received x2, reveal_received x2, resolved", async () => {
    const round = new CommitRevealRound(baseCfg());
    const { events, submit } = makeSink();
    const promise = round.run(submit);
    round.ingestCommit(ALICE, CommitRevealRound.commit(10, "salt-a"));
    round.ingestCommit(BOB, CommitRevealRound.commit(20, "salt-b"));
    await Promise.resolve();
    round.ingestReveal(ALICE, 10, "salt-a");
    round.ingestReveal(BOB, 20, "salt-b");
    await promise;
    const types = events.map((e) => e.type);
    expect(types).toEqual([
      "commit_received",
      "commit_received",
      "reveal_received",
      "reveal_received",
      "resolved",
    ]);
  });
});
