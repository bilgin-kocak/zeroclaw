import { describe, expect, it } from "vitest";
import {
  EventBus,
  InProcessTransportBackend,
} from "../../src/transport/backends/in-process.js";
import type { TransportMessage } from "../../src/transport/backend.js";

describe("InProcessTransportBackend", () => {
  it("delivers a directly addressed message", async () => {
    const bus = new EventBus();
    const a = new InProcessTransportBackend(bus, "alice");
    const b = new InProcessTransportBackend(bus, "bob");
    const received: TransportMessage[] = [];
    await b.subscribe("hello", async (m) => {
      received.push(m);
    });
    await a.send({
      from: "alice",
      to: "bob",
      topic: "hello",
      payload: { v: 1 },
      nonce: "n1",
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(received).toHaveLength(1);
    expect(received[0]?.payload).toEqual({ v: 1 });
  });

  it("does not deliver to the sender", async () => {
    const bus = new EventBus();
    const a = new InProcessTransportBackend(bus, "alice");
    const received: TransportMessage[] = [];
    await a.subscribe("ping", async (m) => {
      received.push(m);
    });
    await a.send({
      from: "alice",
      to: "broadcast",
      topic: "ping",
      payload: 1,
      nonce: "n",
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(received).toHaveLength(0);
  });

  it("broadcast reaches all peers", async () => {
    const bus = new EventBus();
    const a = new InProcessTransportBackend(bus, "alice");
    const b = new InProcessTransportBackend(bus, "bob");
    const c = new InProcessTransportBackend(bus, "carol");
    const got: string[] = [];
    await b.subscribe("bcast", async () => {
      got.push("bob");
    });
    await c.subscribe("bcast", async () => {
      got.push("carol");
    });
    await a.send({
      from: "alice",
      to: "broadcast",
      topic: "bcast",
      payload: null,
      nonce: "n",
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(got.sort()).toEqual(["bob", "carol"]);
  });

  it("whoami returns the configured identity", async () => {
    const bus = new EventBus();
    const a = new InProcessTransportBackend(bus, "alice.eth");
    expect(await a.whoami()).toBe("alice.eth");
  });
});
