import { Proposer } from "@zeroclaw/core";
import type { Plan, RoleContext } from "@zeroclaw/core";
import { UniswapClient } from "./uniswap.js";
import type { Quote } from "./uniswap.js";
import { parseSwapIntent, toBaseUnits, tokenDecimals } from "./intent.js";

export interface SafeSwapProposerConfig {
  uniswap: UniswapClient;
  /** Default chain for the swap (e.g. Unichain Sepolia 1301). */
  chainId: number;
  /** Default model id for inference. */
  model: string;
}

const SYSTEM_PROMPT = `You are the Proposer in the SafeSwap constitutional agent. Given a user swap intent and a live Uniswap quote, propose a Plan as JSON. You should pick numeric parameters optimistically: a tight slippage (50 bps unless the route is exotic), a deadline of 600 seconds. Return ONLY JSON of the form:
{"expectedSlippage": <bps>, "deadlineSeconds": <int>, "rationale": "<one short paragraph>"}`;

export class SafeSwapProposer extends Proposer {
  constructor(
    ctx: RoleContext,
    private cfg: SafeSwapProposerConfig,
  ) {
    super(ctx);
  }

  async propose(intent: string): Promise<Plan> {
    const parsed = parseSwapIntent(intent);
    if (!parsed) {
      throw new Error(`SafeSwapProposer: cannot parse intent '${intent}'`);
    }
    const decimals = tokenDecimals(parsed.tokenIn);
    const amountIn = toBaseUnits(parsed.amount, decimals);

    const quote = await this.cfg.uniswap.getQuote({
      tokenIn: parsed.tokenIn,
      tokenOut: parsed.tokenOut,
      amountIn,
      chainId: this.cfg.chainId,
      slippageTolerancePct: 0.5,
    });

    const inference = await this.ctx.inference.complete({
      model: this.cfg.model,
      system: SYSTEM_PROMPT,
      responseFormat: "json",
      temperature: 0.2,
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            intent,
            parsed,
            quote: { amountOut: quote.amountOut, route: quote.routePath },
          }),
        },
      ],
    });

    const parameters = parseProposerJson(inference.content);
    const plan: Plan = {
      intent,
      action: {
        kind: "swap",
        params: {
          tokenIn: parsed.tokenIn,
          tokenOut: parsed.tokenOut,
          amountIn,
          chainId: this.cfg.chainId,
          quote: { amountOut: quote.amountOut, route: quote.routePath },
        },
      },
      parameters: {
        expectedSlippage: parameters.expectedSlippage,
        deadlineSeconds: parameters.deadlineSeconds,
      },
      rationale: parameters.rationale,
    };
    return plan;
  }
}

interface ProposerOut {
  expectedSlippage: number;
  deadlineSeconds: number;
  rationale: string;
}

const parseProposerJson = (raw: string): ProposerOut => {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    // Fallback to defaults rather than crashing the demo.
    return {
      expectedSlippage: 50,
      deadlineSeconds: 600,
      rationale: raw.slice(0, 240),
    };
  }
  const o = obj as Record<string, unknown>;
  return {
    expectedSlippage: Number(o.expectedSlippage ?? 50),
    deadlineSeconds: Number(o.deadlineSeconds ?? 600),
    rationale: String(o.rationale ?? ""),
  };
};

export const safeSwapProposerSystemPrompt = SYSTEM_PROMPT;
