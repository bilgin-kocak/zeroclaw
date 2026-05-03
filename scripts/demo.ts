/**
 * One-shot demo runner.
 *
 *   pnpm demo:mock       — full deliberation in mock mode (offline failsafe)
 *   pnpm demo:testnet    — full deliberation against real testnets
 *
 * Mode is selected via env vars (EXECUTION_BACKEND, INFERENCE_BACKEND). Boots
 * a Fastify+SSE web UI on WEB_PORT (default 3000) and accepts an intent from
 * argv or from the form in the browser.
 */

import dotenvFlow from "dotenv-flow";
dotenvFlow.config();
import {
  Constitution,
  EventBus,
  InProcessTransportBackend,
  InMemoryBackend,
  KeeperHubExecutionBackend,
  Memory,
  MockExecutionBackend,
  MockInferenceBackend,
  OpenAIInferenceBackend,
  ZeroGComputeBackend,
  ZeroGStorageBackend,
  ENSViemResolver,
} from "@zeroclaw/core";
import type {
  ConstitutionEvent,
  ExecutionBackend,
  InferenceBackend,
  MemoryBackend,
  Plan,
  RoleContext,
} from "@zeroclaw/core";
import {
  ConstitutionEventStream,
  SafeSwapCritic,
  SafeSwapProposer,
  UniswapClient,
  buildWebServer,
} from "@zeroclaw/safeswap";

const env = (key: string, fallback?: string): string => {
  const v = process.env[key];
  if (v && v.length > 0) return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`${key} required`);
};

const optionalEnv = (key: string): string | undefined => {
  const v = process.env[key];
  return v && v.length > 0 ? v : undefined;
};

const executionMode = env("EXECUTION_BACKEND", "mock");
const inferenceMode = env("INFERENCE_BACKEND", "mock");
const port = Number(env("WEB_PORT", "3000"));
const chainId = Number(env("UNICHAIN_CHAIN_ID", "1301"));

console.log(
  `[demo] starting :: execution=${executionMode} inference=${inferenceMode} port=${port}`,
);

const buildExecution = (): ExecutionBackend => {
  if (executionMode === "mock") {
    return new MockExecutionBackend({
      explorerBase: "https://sepolia.uniscan.xyz/tx",
    });
  }
  if (executionMode === "keeperhub") {
    return new KeeperHubExecutionBackend({
      apiKey: env("KEEPERHUB_API_KEY"),
      mcpUrl: env("KEEPERHUB_MCP_URL"),
      explorerBase: "https://sepolia.uniscan.xyz/tx",
      ...(optionalEnv("KEEPERHUB_OPERATOR")
        ? { operator: env("KEEPERHUB_OPERATOR") }
        : {}),
    });
  }
  throw new Error(`unknown EXECUTION_BACKEND: ${executionMode}`);
};

const buildInference = (
  proposerCanned?: object,
  criticCanned?: object,
): { proposer: InferenceBackend; critic: InferenceBackend } => {
  if (inferenceMode === "mock") {
    const proposer = new MockInferenceBackend({
      fallback: JSON.stringify(
        proposerCanned ?? {
          expectedSlippage: 50,
          deadlineSeconds: 600,
          rationale:
            "ETH/USDC is the deepest pool on Unichain; 50bps is comfortable for a 5 ETH input. Deadline at 10 minutes.",
        },
      ),
    });
    const critic = new MockInferenceBackend({
      fallback: JSON.stringify(
        criticCanned ?? {
          verdict: "revise",
          expectedSlippage: 90,
          deadlineSeconds: 480,
          concerns: [
            "Volatility on Unichain Sepolia can spike; 50bps is too tight.",
            "8-minute deadline reduces inclusion-time MEV.",
          ],
          rationale:
            "I re-quoted independently. The route is fine but the slippage envelope doesn't leave headroom for adversarial reorgs.",
        },
      ),
    });
    return { proposer, critic };
  }
  if (inferenceMode === "openai") {
    const apiKey = env("OPENAI_API_KEY");
    return {
      proposer: new OpenAIInferenceBackend({ apiKey }),
      critic: new OpenAIInferenceBackend({ apiKey }),
    };
  }
  if (inferenceMode === "zerog") {
    const rpcUrl = env("ZEROG_RPC_URL");
    const privateKey = env("ZEROG_PRIVATE_KEY");
    const proposer = new ZeroGComputeBackend({ rpcUrl, privateKey });
    const critic = new ZeroGComputeBackend({ rpcUrl, privateKey });
    return { proposer, critic };
  }
  throw new Error(`unknown INFERENCE_BACKEND: ${inferenceMode}`);
};

const buildMemory = (): MemoryBackend => {
  // 0G Storage memory is only used when both modes are real.
  if (
    optionalEnv("MEMORY_BACKEND") === "zerog" ||
    inferenceMode === "zerog"
  ) {
    try {
      return new ZeroGStorageBackend({
        rpcUrl: env("ZEROG_RPC_URL"),
        privateKey: env("ZEROG_PRIVATE_KEY"),
        indexerRpc: env("ZEROG_STORAGE_INDEXER"),
        kvEndpoint: env("ZEROG_KV_ENDPOINT"),
        flowContract: env("ZEROG_FLOW_CONTRACT"),
        streamId: env("ZEROG_STREAM_ID", "0x" + "11".repeat(32)),
      });
    } catch (err) {
      console.warn(`[demo] 0G Storage init failed (${err}); using in-memory.`);
    }
  }
  return new InMemoryBackend();
};

const buildUniswap = (): UniswapClient => {
  if (executionMode === "mock") {
    return new UniswapClient({
      fetch: (async () =>
        new Response(
          JSON.stringify({
            quote: "12000000000",
            midPriceOut: 2400,
            route: ["WETH/USDC 0.05%"],
            gasUseEstimate: "150000",
            tx: { to: "0xrouter", data: "0xdeadbeef", value: "0" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        )) as unknown as typeof fetch,
    });
  }
  return new UniswapClient({
    apiUrl: env("UNISWAP_API_URL", "https://api.uniswap.org/v1"),
    apiKey: optionalEnv("UNISWAP_API_KEY") ?? "",
  });
};

async function maybeRefreshENS(
  proposerId: string,
  criticId: string,
  capabilities: { proposer: string[]; critic: string[] },
  reputationPointer?: string,
): Promise<void> {
  if (
    !optionalEnv("SEPOLIA_RPC_URL") ||
    !optionalEnv("DEPLOYER_PRIVATE_KEY")
  ) {
    return;
  }
  try {
    const resolver = new ENSViemResolver({
      rpcUrl: env("SEPOLIA_RPC_URL"),
      privateKey: env("DEPLOYER_PRIVATE_KEY") as `0x${string}`,
    });
    await resolver.setProfile(proposerId, {
      capabilities: capabilities.proposer,
      ...(reputationPointer ? { reputationPointer } : {}),
    });
    await resolver.setProfile(criticId, {
      capabilities: capabilities.critic,
      ...(reputationPointer ? { reputationPointer } : {}),
    });
  } catch (err) {
    console.warn(`[demo] ENS refresh skipped: ${err}`);
  }
}

async function main(): Promise<void> {
  const bus = new EventBus();
  const memBackend = buildMemory();

  const proposerId = env("ENS_PROPOSER_SUBNAME", "proposer.zeroclaw.eth");
  const criticId = env("ENS_CRITIC_SUBNAME", "critic.zeroclaw.eth");

  const { proposer: proposerInf, critic: criticInf } = buildInference();

  const proposerCtx: RoleContext = {
    id: proposerId,
    memory: new Memory(memBackend, "proposer"),
    inference: proposerInf,
    transport: new InProcessTransportBackend(bus, proposerId),
  };
  const criticCtx: RoleContext = {
    id: criticId,
    memory: new Memory(memBackend, "critic"),
    inference: criticInf,
    transport: new InProcessTransportBackend(bus, criticId),
  };

  const uniswap = buildUniswap();
  const proposer = new SafeSwapProposer(proposerCtx, {
    uniswap,
    chainId,
    model: env("ZEROG_PROPOSER_MODEL", "qwen-mock"),
  });
  const critic = new SafeSwapCritic(criticCtx, {
    uniswap,
    chainId,
    model: env("ZEROG_CRITIC_MODEL", "glm-mock"),
  });

  const stream = new ConstitutionEventStream();
  const constitution = new Constitution({
    proposer,
    critic,
    execution: buildExecution(),
    memory: new Memory(memBackend, "constitution"),
    mechanism: {
      normalization: 50,
      commitTimeoutMs: 5_000,
      revealTimeoutMs: 5_000,
    },
    contestable: ["expectedSlippage", "deadlineSeconds"],
    anchorFor: (parameter, plan: Plan) => async () => {
      if (parameter === "expectedSlippage") return 75;
      if (parameter === "deadlineSeconds") return 540;
      const v = plan.parameters[parameter];
      return v ?? 0;
    },
    onEvent: (event: ConstitutionEvent) => {
      stream.publish(event);
      console.log(`[deliberation] ${event.type}`);
    },
  });

  const onIntent = async (intent: string) => {
    const result = await constitution.deliberate(intent);
    console.log("\n=== final plan ===");
    console.log(JSON.stringify(result.finalPlan.parameters, null, 2));
    if (result.receipt) {
      console.log(`\n→ tx: ${result.receipt.explorerUrl}`);
      // ENS Most Creative angle: refresh capability + reputationPointer.
      await maybeRefreshENS(
        proposerId,
        criticId,
        {
          proposer: ["propose:swap"],
          critic: ["critique:swap"],
        },
        result.receipt.txHash, // placeholder; in 0G-mode this is the storage CID
      );
    } else if (result.aborted) {
      console.log(`\n⛔ aborted: ${result.aborted.reason}`);
    }
  };

  buildWebServer({ stream, port, onIntent });
  console.log(`[demo] web UI at http://localhost:${port}`);

  const argvIntent = process.argv.slice(2).join(" ").trim();
  if (argvIntent) {
    console.log(`[demo] argv intent: ${argvIntent}`);
    await onIntent(argvIntent);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
