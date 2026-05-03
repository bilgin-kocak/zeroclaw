import { describe, expect, it, vi } from "vitest";
import {
  EventBus,
  InProcessTransportBackend,
  InMemoryBackend,
  Memory,
  MockInferenceBackend,
} from "@zeroclaw/core";
import { UniswapClient } from "../../src/uniswap.js";
import { SafeSwapProposer } from "../../src/proposer.js";
import { SafeSwapCritic } from "../../src/critic.js";

const fakeQuoteFetch: typeof fetch = vi.fn(async () =>
  new Response(
    JSON.stringify({
      quote: "12000000000",
      route: ["0xpool"],
      gasUseEstimate: "150000",
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  ),
) as unknown as typeof fetch;

const ctxFor = (id: string) => {
  const bus = new EventBus();
  return {
    id,
    memory: new Memory(new InMemoryBackend(), id),
    inference: new MockInferenceBackend(),
    transport: new InProcessTransportBackend(bus, id),
  };
};

describe("SafeSwapProposer", () => {
  it("produces a Plan with parsed quote and inference-derived parameters", async () => {
    const ctx = ctxFor("proposer.safeswap.test");
    const inference = ctx.inference as MockInferenceBackend;
    inference.cannedFor(
      {
        model: "test-model",
        system:
          "You are the Proposer in the SafeSwap constitutional agent. Given a user swap intent and a live Uniswap quote, propose a Plan as JSON. You should pick numeric parameters optimistically: a tight slippage (50 bps unless the route is exotic), a deadline of 600 seconds. Return ONLY JSON of the form:\n{\"expectedSlippage\": <bps>, \"deadlineSeconds\": <int>, \"rationale\": \"<one short paragraph>\"}",
        messages: [{ role: "user", content: "" }],
      },
      "{}",
    );
    inference.setFallback(
      JSON.stringify({
        expectedSlippage: 50,
        deadlineSeconds: 600,
        rationale: "tight slippage on a deep ETH/USDC pool.",
      }),
    );

    const proposer = new SafeSwapProposer(ctx, {
      uniswap: new UniswapClient({ fetch: fakeQuoteFetch }),
      chainId: 1301,
      model: "test-model",
    });
    const plan = await proposer.propose("swap 5 ETH to USDC");
    expect(plan.action.kind).toBe("swap");
    expect(plan.action.params).toMatchObject({
      tokenIn: "ETH",
      tokenOut: "USDC",
      chainId: 1301,
    });
    expect(plan.parameters.expectedSlippage).toBe(50);
    expect(plan.parameters.deadlineSeconds).toBe(600);
  });

  it("rejects unparseable intents", async () => {
    const ctx = ctxFor("proposer.safeswap.test");
    const proposer = new SafeSwapProposer(ctx, {
      uniswap: new UniswapClient({ fetch: fakeQuoteFetch }),
      chainId: 1301,
      model: "test-model",
    });
    await expect(proposer.propose("hello bot")).rejects.toThrow(/cannot parse/);
  });
});

describe("SafeSwapCritic", () => {
  it("returns a Critique with verdict + counterParameters", async () => {
    const ctx = ctxFor("critic.safeswap.test");
    const inference = ctx.inference as MockInferenceBackend;
    inference.setFallback(
      JSON.stringify({
        verdict: "revise",
        expectedSlippage: 100,
        deadlineSeconds: 480,
        concerns: ["slippage too tight under volatility"],
        rationale: "be safer.",
      }),
    );
    const critic = new SafeSwapCritic(ctx, {
      uniswap: new UniswapClient({ fetch: fakeQuoteFetch }),
      chainId: 1301,
      model: "test-model",
    });
    const critique = await critic.critique({
      intent: "swap 5 ETH to USDC",
      action: {
        kind: "swap",
        params: { tokenIn: "ETH", tokenOut: "USDC", amountIn: "5000000000000000000", chainId: 1301 },
      },
      parameters: { expectedSlippage: 50, deadlineSeconds: 600 },
      rationale: "looks fine",
    });
    expect(critique.verdict).toBe("revise");
    expect(critique.counterParameters.expectedSlippage).toBe(100);
    expect(critique.counterParameters.deadlineSeconds).toBe(480);
  });
});
