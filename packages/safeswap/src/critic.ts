import { Critic } from "@zeroclaw/core";
import type { Critique, Plan, RoleContext } from "@zeroclaw/core";
import { UniswapClient } from "./uniswap.js";

export interface SafeSwapCriticConfig {
  uniswap: UniswapClient;
  chainId: number;
  model: string;
}

const SYSTEM_PROMPT = `You are the Critic in the SafeSwap constitutional agent. Adversarially reconsider every numeric parameter the Proposer chose. Re-quote independently. Slippage that looks tight today (50bps) is often unsafe under volatility — push it up unless the route is deep. Return ONLY JSON of the form:
{"verdict": "accept"|"reject"|"revise", "expectedSlippage": <bps>, "deadlineSeconds": <int>, "concerns": ["..."], "rationale": "<one short paragraph>"}`;

export class SafeSwapCritic extends Critic {
  constructor(
    ctx: RoleContext,
    private cfg: SafeSwapCriticConfig,
  ) {
    super(ctx);
  }

  async critique(plan: Plan): Promise<Critique> {
    // Re-quote independently using the same swap params.
    const params = plan.action.params as Record<string, unknown>;
    const tokenIn = String(params.tokenIn);
    const tokenOut = String(params.tokenOut);
    const amountIn = String(params.amountIn);
    const independentQuote = await this.cfg.uniswap.getQuote({
      tokenIn,
      tokenOut,
      amountIn,
      chainId: this.cfg.chainId,
    });

    const inference = await this.ctx.inference.complete({
      model: this.cfg.model,
      system: SYSTEM_PROMPT,
      responseFormat: "json",
      temperature: 0.4,
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            plan: {
              intent: plan.intent,
              parameters: plan.parameters,
              rationale: plan.rationale,
              proposerQuote: (params.quote as Record<string, unknown>) ?? null,
            },
            independentQuote: {
              amountOut: independentQuote.amountOut,
              route: independentQuote.routePath,
            },
          }),
        },
      ],
    });

    return parseCriticJson(inference.content, plan);
  }
}

const parseCriticJson = (raw: string, plan: Plan): Critique => {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return {
      verdict: "revise",
      concerns: ["could not parse critic response"],
      counterParameters: {
        expectedSlippage: (plan.parameters.expectedSlippage ?? 50) + 50,
        deadlineSeconds: plan.parameters.deadlineSeconds ?? 600,
      },
      rationale: raw.slice(0, 240),
    };
  }
  const o = obj as Record<string, unknown>;
  const verdictRaw = String(o.verdict ?? "revise");
  const verdict: Critique["verdict"] =
    verdictRaw === "accept" || verdictRaw === "reject"
      ? verdictRaw
      : "revise";
  const concerns = Array.isArray(o.concerns)
    ? (o.concerns as unknown[]).map(String)
    : [];
  const counterParameters: Record<string, number> = {};
  if (o.expectedSlippage !== undefined) {
    counterParameters.expectedSlippage = Number(o.expectedSlippage);
  }
  if (o.deadlineSeconds !== undefined) {
    counterParameters.deadlineSeconds = Number(o.deadlineSeconds);
  }
  return {
    verdict,
    concerns,
    counterParameters,
    rationale: String(o.rationale ?? ""),
  };
};

export const safeSwapCriticSystemPrompt = SYSTEM_PROMPT;
