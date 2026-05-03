import { describe, expect, it } from "vitest";
import { Memory } from "../../src/memory/memory.js";
import { InMemoryBackend } from "../../src/memory/backends/in-memory.js";

describe("Memory", () => {
  it("recall returns null for an unknown key", async () => {
    const m = new Memory(new InMemoryBackend());
    expect(await m.recall("missing")).toBeNull();
  });

  it("remember + recall roundtrip", async () => {
    const m = new Memory(new InMemoryBackend());
    await m.remember("k", { v: 1 });
    expect(await m.recall("k")).toEqual({ v: 1 });
  });

  it("namespacing isolates keys across namespaces on the same backend", async () => {
    const backend = new InMemoryBackend();
    const a = new Memory(backend, "agent-a");
    const b = new Memory(backend, "agent-b");
    await a.remember("k", "from-a");
    await b.remember("k", "from-b");
    expect(await a.recall("k")).toBe("from-a");
    expect(await b.recall("k")).toBe("from-b");
  });

  it("log + history is append-only with timestamps unwrapped", async () => {
    let t = 0;
    const m = new Memory(new InMemoryBackend(), "default", () => ++t);
    await m.log("events", { a: 1 });
    await m.log("events", { a: 2 });
    expect(await m.history("events")).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("history limit returns the last N entries", async () => {
    const m = new Memory(new InMemoryBackend());
    for (let i = 0; i < 5; i++) await m.log("x", i);
    expect(await m.history("x", 2)).toEqual([3, 4]);
  });
});
