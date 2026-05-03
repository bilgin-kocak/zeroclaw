# Architecture

## Why two roles + a mechanism, not a chat log

A single LLM agent confidently completes wrong actions. The constitutional pattern (Anthropic CAI, 2022) introduces a **critic** that re-evaluates a proposer's plan. But two LLMs that argue in natural language have no equilibrium — only a transcript. A judge thinking rigorously about mechanism design will spot that gap immediately.

ZeroClaw closes the gap by making **numeric** disagreements resolve through a sealed-bid commit-reveal protocol with a **known truth-telling equilibrium**.

When the Proposer and Critic disagree on a scalar `x` (slippage, position size, deadline):

1. **Commit phase.** Each role picks a value `x_i`, picks a random 32-byte salt `r_i`, and broadcasts `H(x_i || r_i)` over the transport layer. Neither side sees the other's commitment first.
2. **Reveal phase.** After both commitments are received, each role broadcasts `(x_i, r_i)`. The other side verifies the hash matches.
3. **Resolution.** `x* = median(x_proposer, x_critic, x_anchor)` where `x_anchor` is an external oracle value (e.g. the Uniswap quote midpoint), or the arithmetic mean of the two reveals if no anchor is available.
4. **Reward.** Each role's score is `-((x_i - x*) / σ)²` — a quadratic loss against the resolution. Scores accumulate to ENS-tracked reputation across rounds.

By Moulin (1980), **median voting with commitments is strategy-proof** — truth-telling is weakly dominant for one-shot games. With reputation across repeated play (Miller-Resnick-Zeckhauser 2005), it becomes **strictly dominant**: deviating from your true belief in any single round costs reputation that compounds.

## Module boundaries

```
@zeroclaw/core
├── mechanism/        the commit-reveal round + types — bulletproof, ~200 LOC
├── roles/            abstract Proposer + Critic + Role base
├── memory/           MemoryBackend interface + InMemory + 0G Storage backends
├── inference/        InferenceBackend interface + Mock + 0G Compute + OpenAI backends
├── execution/        ExecutionBackend interface + Mock + KeeperHub backends
├── transport/        TransportBackend interface + InProcessTransport (production)
├── identity/         ENSResolver interface + viem-backed implementation
└── constitution.ts   the orchestrator: intent → propose → critique → mechanism → execute

@zeroclaw/safeswap
├── uniswap.ts        api.uniswap.org/v1 client (quotes + routes; injectable fetch)
├── intent.ts         pure parser: "swap 5 ETH to USDC" → { amount, tokenIn, tokenOut }
├── proposer.ts       SafeSwapProposer — uses Uniswap quote + 0G Compute model A
├── critic.ts         SafeSwapCritic — re-quotes independently + 0G Compute model B
├── event-stream.ts   pub-sub bus that decouples Constitution from any UI surface
└── web.ts            Fastify + SSE single-page UI (≈150 lines vanilla HTML/JS)
```

Each interface has at minimum two implementations: a deterministic mock used in tests (and as the demo-day failsafe), and one real SDK-backed implementation. This keeps the framework testable and decouples the deployment concern from the protocol.

## Data flow per deliberation

```
1. user submits intent ────────────────────────────────────► Constitution.deliberate()
2. Proposer.propose(intent)
   ├── parses intent (intent.ts)
   ├── calls UniswapClient.getQuote(...)
   └── calls InferenceBackend.complete(...)  ← 0G Compute model A
3. Critic.critique(plan)
   ├── re-quotes via UniswapClient (independent quote)
   └── calls InferenceBackend.complete(...)  ← 0G Compute model B
4. for each contested parameter where the two disagree:
     CommitRevealRound runs:
       commit_received × 2  →  reveal_received × 2  →  resolved (or aborted)
     anchor = UniswapClient.getQuote().midPriceOut
5. plan parameters replaced with mechanism resolutions
6. ExecutionBackend.execute(...)  ← KeeperHub MCP → tx on Unichain Sepolia
7. Memory.log("deliberations", transcript) ← 0G Storage Log
8. ENSResolver.setProfile(proposer/critic, { reputationPointer: storageRoot })
```

All seven steps emit `ConstitutionEvent`s into a shared `EventBus`. The web UI subscribes via SSE; a Telegram adapter (deferred work) would subscribe the same way. **No UI ever queries the framework directly** — they observe events.

## Why the test discipline matters here

The mechanism file (`packages/core/src/mechanism/commit-reveal.ts`) is the only module where elegance matters more than speed. Its 15 tests were written **failing first** per the spec, then made green. Every later test (mechanism-over-transport integration, Constitution end-to-end, KeeperHub backend, Uniswap client) is built on the assumption that the mechanism is correct. **A regression here invalidates the protocol claim**, so the file is deliberately kept small (single switch over `RoundState.phase`, no state-machine library) and the tests cover commit determinism, salt-hiding, score quadratic-ness, all five state transitions, both abort paths, and event ordering.

## Sponsor SDK choices

- **0G Storage TS SDK** (`@0gfoundation/0g-storage-ts-sdk`) — wraps an `Indexer + Batcher + KvClient` triple over `ethers`. We expose KV `get/set` and a per-stream append-only log via a counter key (`${stream}/__count`) plus indexed entries (`${stream}/0`, `${stream}/1`, …).
- **0G Compute TS SDK** (`@0gfoundation/0g-compute-ts-sdk`) — `createZGComputeNetworkBroker(wallet)` exposes a service catalog. We **query the catalog at runtime** (`broker.inference.listService()`) and pick two distinct models — Proposer and Critic must be structurally different inferences, not random samples of the same model. The 0G docs explicitly say the catalog is dynamic so we don't hardcode model IDs.
- **KeeperHub MCP** — speaks JSON-RPC over HTTP. We call the `swap.execute` tool with constraints (slippage cap, deadline) and a nonce; the receipt surfaces the audit trail (every attempt with `revertReason`).
- **viem** for ENS reads/writes — `getEnsText(name, key)` for capability + reputation records, plus a direct `setText(node, key, value)` write through PublicResolver for setProfile.
- **Uniswap API v1** for quotes and swap calldata. The live quote midpoint is the commit-reveal **anchor**, which is what makes the mechanism's median-of-three robust against either side gaming.

## What we cut and why

| Spec module | Status | Reason |
|---|---|---|
| `transport/backends/axl.ts` (Gensyn) | dropped | Two-machine AXL setup risked the build; transport layer is still abstracted, so swap-in is a deployment task |
| `scripts/spawn-proposer.ts` / `spawn-critic.ts` | dropped | Single-process deployment |
| Hetzner VPS, two-AXL-node integration test | dropped | Same |
| Telegram bot | deferred | Web UI alone covers the 0G "live demo link" requirement |
| Hardcoded `qwen3.6-plus` / `GLM-5-FP8` model IDs | replaced | Runtime query of `broker.inference.listService()` per 0G docs |

The architecture is the same as the spec's. The cuts are about scope, not principle.
