# ZeroClaw

> A constitutional agent framework. Two roles, one mechanism, zero trust.

ZeroClaw is a TypeScript framework for building agents from two adversarial roles — a **Proposer** and a **Critic** — that resolve disagreements about numeric parameters through a **commit-reveal sealed-bid protocol** with a known truth-telling equilibrium. The framework persists deliberation memory to **0G Storage**, drives inference through **0G Compute**, executes approved actions via **KeeperHub**, and carries agent identity (capabilities, reputation pointer) on **ENS**.

The example agent **SafeSwap** uses ZeroClaw to perform Uniswap rebalances on Unichain Sepolia with visible Proposer-vs-Critic deliberation in a streaming web UI.

This project is the submission to the **ETHGlobal Open Agents** hackathon. Primary track: **0G Track A — Best Agent Framework**. Secondary tracks: **Uniswap (API)**, **ENS (Best Integration + Most Creative)**, **KeeperHub**.

---

## The mechanism, in one paragraph

A single LLM has no internal contradiction. A two-LLM "constitution" that argues in natural language has no equilibrium — just a chat log. ZeroClaw closes that gap by making numeric disagreements (slippage, position size, deadline) resolve through a **sealed-bid commit-reveal round** with median voting. By Moulin (1980), median voting with commitments is **strategy-proof** — reporting your true belief is weakly dominant. With reputation accumulated to ENS over repeated play (Miller-Resnick-Zeckhauser 2005), it becomes **strictly dominant**. Each role's score per round is a quadratic loss `-((x - x*)/σ)²` against the resolution `x* = median(x_proposer, x_critic, x_anchor)` where `x_anchor` is a live external oracle (e.g. a Uniswap quote midpoint).

> "Median voting with commitments is strategy-proof — Moulin 1980. We extend it to repeated play with reputation, which makes truth-telling strictly dominant."

---

## Architecture

```
                        ┌───────────────────────┐
                        │   Web UI (Fastify+SSE)│  ← live demo URL
                        └──────────┬────────────┘
                                   │ events
                                   ▼
   intent ──► Constitution.deliberate()
                ├─► Proposer  (0G Compute model A) ─┐
                ├─► Critic    (0G Compute model B) ─┤  EventBus transport
                ├─► CommitRevealRound (per param) ──┘
                │      anchor = Uniswap API quote
                ├─► Memory.log() ──► 0G Storage Log
                ├─► ENSResolver.setProfile() ──► capabilities + reputationPointer
                └─► Execution ──► KeeperHubExecutionBackend (MCP)
                                   └─► tx on Unichain Sepolia
```

The framework defines five interfaces — `MemoryBackend`, `InferenceBackend`, `ExecutionBackend`, `TransportBackend`, `ENSResolver` — each with a mock and a real implementation. The mocks are not just for tests; `MockExecutionBackend` is the **demo-day failsafe** (deterministic Etherscan-shaped tx hashes).

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for a deeper walkthrough.

---

## Quickstart

Requires **Node.js ≥ 20** and **pnpm ≥ 8**.

```bash
git clone <this repo>
cd zeroclaw
pnpm install

# Mock-mode demo — works offline, deterministic. Use this to validate the wiring.
pnpm demo:mock "swap 5 ETH to USDC, lowest slippage"
# → opens http://localhost:3000 with the two-column proposer-vs-critic stream
# → prints a fake-but-Etherscan-shaped tx hash on completion

# Real testnet demo — requires .env.local (see .env.example and SETUP.md)
pnpm demo:testnet "swap 5 ETH to USDC, lowest slippage"
```

`SETUP.md` walks through getting the API keys (0G, KeeperHub, Uniswap, ENS, Telegram).

### Building a two-role agent in <30 lines of user code

```ts
import {
  Constitution, Memory, InMemoryBackend,
  EventBus, InProcessTransportBackend,
  MockExecutionBackend, MockInferenceBackend,
} from "@zeroclaw/core";
import { SafeSwapProposer, SafeSwapCritic, UniswapClient } from "@zeroclaw/safeswap";

const bus = new EventBus();
const mem = new InMemoryBackend();
const ctx = (id: string) => ({
  id, memory: new Memory(mem, id),
  inference: new MockInferenceBackend(),
  transport: new InProcessTransportBackend(bus, id),
});

const uniswap = new UniswapClient({ apiUrl: "https://api.uniswap.org/v1" });
const proposer = new SafeSwapProposer(ctx("p.eth"), { uniswap, chainId: 1301, model: "qwen" });
const critic   = new SafeSwapCritic  (ctx("c.eth"), { uniswap, chainId: 1301, model: "glm"  });

const c = new Constitution({
  proposer, critic, execution: new MockExecutionBackend(),
  memory: new Memory(mem, "constitution"),
  mechanism: { normalization: 50, commitTimeoutMs: 5_000, revealTimeoutMs: 5_000 },
  contestable: ["expectedSlippage", "deadlineSeconds"],
});

const result = await c.deliberate("swap 5 ETH to USDC");
console.log(result.finalPlan, result.receipt?.explorerUrl);
```

---

## Tests

```bash
pnpm test                                  # 56 unit + integration tests, <3s
RUN_ZEROG_TESTS=1 pnpm test                # adds 0G Storage + Compute e2e
RUN_KEEPERHUB_TESTS=1 pnpm test            # adds KeeperHub MCP e2e
RUN_UNISWAP_TESTS=1 pnpm test              # adds Uniswap API e2e
RUN_ENS_TESTS=1 pnpm test                  # adds ENS write/read roundtrip
```

The mechanism module's 15 commit-reveal tests were written **failing first** per the spec's TDD discipline, then implemented (`packages/core/test/unit/commit-reveal.test.ts`). The intellectual core is locked in <200 lines.

---

## Sponsor integration map

| Track | What we use it for | Required artifacts |
|---|---|---|
| **0G Track A** | `MemoryBackend` ← 0G Storage KV + per-stream log; `InferenceBackend` ← 0G Compute (two distinct models for Proposer / Critic) | architecture diagram (above), demo video (≤3 min), live demo URL, contract addresses |
| **Uniswap** | `packages/safeswap/src/uniswap.ts` wraps `api.uniswap.org/v1` for quotes + routes; the live quote is the **anchor oracle** for commit-reveal | [`FEEDBACK.md`](FEEDBACK.md) at repo root |
| **ENS** | `ENSResolver.setProfile()` writes the agent's `capabilities` and **`reputationPointer`** (a 0G Storage CID) as text records on subnames `proposer.<name>.eth` and `critic.<name>.eth`. The reputation pointer is a non-cosmetic ENS use: it advertises *where the agent's mind lives*. | functional demo (no hardcoded values) |
| **KeeperHub** | `KeeperHubExecutionBackend` speaks JSON-RPC over MCP to KeeperHub for testnet swap execution; receipt includes audit trail of attempts | working demo + [`feedback/KEEPERHUB_FEEDBACK.md`](feedback/KEEPERHUB_FEEDBACK.md) (Feedback Bounty) |

We elected **not** to submit to the **Gensyn AXL** track. Time-budget call: with 5 effective days for a single dev, two-machine AXL setup risked the rest of the build. The transport layer is abstracted behind `TransportBackend` so swapping in an AXL HTTP bridge is a deployment problem, not a logic problem — see `packages/core/src/transport/backends/in-process.ts` for the production transport that ships today.

---

## Repo layout

```
packages/
  core/         @zeroclaw/core   — the framework (mechanism + interfaces + backends)
  safeswap/     @zeroclaw/safeswap — example agent (Uniswap rebalancer + web UI)
scripts/
  demo.ts       one-shot demo runner (mock and testnet modes)
docs/
  ARCHITECTURE.md
  DEMO.md       judge reproduction steps
feedback/
  UNISWAP_FEEDBACK.md   linked to /FEEDBACK.md at repo root
  KEEPERHUB_FEEDBACK.md
SETUP.md        external steps (API keys, ENS reg, faucets)
.env.example    env var contract
spec.md         original technical spec
```

---

## Submission checklist

See [`docs/SUBMISSION.md`](docs/SUBMISSION.md) (rendered before submission).

---

## License

MIT.
