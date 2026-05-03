import { describe, expect, it } from "vitest";
import { MockExecutionBackend } from "../../src/execution/backends/mock.js";

describe("MockExecutionBackend", () => {
  it("returns a deterministic fake tx hash for the same nonce", async () => {
    const a = new MockExecutionBackend();
    const b = new MockExecutionBackend();
    const req = {
      kind: "swap" as const,
      params: { tokenIn: "ETH", tokenOut: "USDC", amount: 5 },
      constraints: { slippageBps: 50 },
      nonce: "demo-1",
    };
    const r1 = await a.execute(req);
    const r2 = await b.execute(req);
    expect(r1.txHash).toBe(r2.txHash);
  });

  it("explorerUrl is shaped like an Etherscan link", async () => {
    const m = new MockExecutionBackend();
    const r = await m.execute({
      kind: "swap",
      params: {},
      constraints: {},
      nonce: "n1",
    });
    expect(r.explorerUrl).toMatch(/^https:\/\/.*etherscan\.io\/tx\/0x[0-9a-f]{64}$/);
  });

  it("simulateRetry surfaces the audit trail", async () => {
    const m = new MockExecutionBackend({ simulateRetry: true });
    const r = await m.execute({
      kind: "swap",
      params: {},
      constraints: {},
      nonce: "n2",
    });
    expect(r.attempts).toHaveLength(2);
    expect(r.attempts?.[0]?.revertReason).toMatch(/transient/);
  });
});
