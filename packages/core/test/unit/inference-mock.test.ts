import { describe, expect, it } from "vitest";
import { MockInferenceBackend } from "../../src/inference/backends/mock.js";

describe("MockInferenceBackend", () => {
  it("returns the fallback when no fingerprint matches", async () => {
    const m = new MockInferenceBackend({ fallback: "default" });
    const r = await m.complete({
      model: "test",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(r.content).toBe("default");
    expect(r.model).toBe("test");
  });

  it("matches by (system, last user message) fingerprint", async () => {
    const m = new MockInferenceBackend();
    const exemplar = {
      model: "x",
      system: "you are a critic",
      messages: [{ role: "user" as const, content: "is 5% slippage ok?" }],
    };
    m.cannedFor(exemplar, { verdict: "reject" });
    const r = await m.complete(exemplar);
    expect(JSON.parse(r.content)).toEqual({ verdict: "reject" });
  });

  it("records calls for assertion", async () => {
    const m = new MockInferenceBackend({ fallback: "ok" });
    await m.complete({
      model: "x",
      messages: [{ role: "user", content: "a" }],
    });
    expect(m.calls).toHaveLength(1);
  });
});
