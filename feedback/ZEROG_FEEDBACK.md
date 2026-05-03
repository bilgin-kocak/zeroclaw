# 0G — Builder Feedback

Project: ZeroClaw (Open Agents hackathon, May 2026).
Author: Bilgin / movezone lab.
Integration surface:
- `packages/core/src/memory/backends/zerog-storage.ts` — `MemoryBackend` over `@0gfoundation/0g-storage-ts-sdk`
- `packages/core/src/inference/backends/zerog-compute.ts` — `InferenceBackend` over `@0gfoundation/0g-compute-ts-sdk`

---

## Documentation gaps

### 1. KV public node `http://3.101.147.150:6789` is offline
- **Repro:** `curl -m 10 http://3.101.147.150:6789` → connection timeout. The same URL appears in the SDK README (`https://github.com/0gfoundation/0g-storage-ts-sdk` README example) AND in the developer docs at `docs.0g.ai/developer-hub/building-on-0g/storage/sdk` as the canonical KV endpoint.
- **Why it matters:** Following the official example produces an immediately broken backend. Teams will either give up or work around (we worked around — see suggestion).
- **Suggestion:** (a) update the SDK README + docs to point at a live KV node; (b) gate the example on a config fetch from `https://docs.0g.ai/network.json` so endpoints can rotate without doc churn; (c) document the alternative path (`Indexer.upload + downloadToBlob`) as the primary KV-equivalent for in-process workloads.
- **Workaround we shipped:** rewrote our `MemoryBackend` to use `Indexer.upload` (write) and `Indexer.downloadToBlob` (read) with an in-process root-hash index. Works through the alive Turbo indexer (`https://indexer-storage-testnet-turbo.0g.ai`).

### 2. `Indexer.downloadToBlob` returns a Web `Blob`, but docs imply a `Uint8Array`
- **Repro:** Following the docs snippet, `const [blob, err] = await indexer.downloadToBlob(rootHash)`, then `new TextDecoder().decode(blob)`.
- **Observed:** `TypeError: The "list" argument must be an instance of SharedArrayBuffer, ArrayBuffer or ArrayBufferView` — because `blob` is a Web standard `Blob`, not a `Uint8Array`.
- **Suggestion:** Either change the SDK to return a `Uint8Array` (less surprising; matches `MemData` symmetry on upload) OR document explicitly that callers must `await blob.text()` / `await blob.arrayBuffer()`.

### 3. KV SDK key-encoding mismatch between docs and code
- **Repro:** The docs example does `kvClient.getValue(streamId, ethers.encodeBase64(keyBytes))`. The current SDK calls `arrayify(key)` internally and re-encodes — passing a base64 string crashes with `invalid arrayify value`.
- **Suggestion:** Pass raw bytes / hex per the SDK code; update the docs to match.

## DX friction

### 4. Compute "Sub-account not found" error has poor onboarding signposting
- **Repro:** Fund wallet from faucet (~0.1 OG), call `broker.inference.complete(...)` directly.
- **Observed:** `Error: Sub-account not found. Initialize it by transferring funds via "transfer-fund" (Address: 0x...your_wallet, Address: 0x...provider)`.
- **Why it matters:** First-time users follow the Quickstart and hit this immediately. The error message says "use transfer-fund" but doesn't say `broker.ledger.transferFund(...)` is the call.
- **Suggestion:** Either make `complete()` lazily fund the sub-account on first use (with a configurable max), or include the exact code line in the error: `broker.ledger.transferFund("<provider>", "inference", <amount>)`.

### 5. `addLedger` minimum balance is 3 OG, but faucet drips ~0.1 OG
- **Repro:** Fund wallet from `https://faucet.0g.ai`, call `broker.ledger.addLedger(0.02)`.
- **Observed:** `Minimum balance to create a ledger is 3 0G, but got 0.02 0G. Please use: broker.ledger.addLedger(3)`.
- **Why it matters:** A new developer needs to hit the faucet ~30 times (or find a bigger tap in Discord) BEFORE they can run the simplest inference example. This is a 30-minute integration tax for what should be a 60-second tutorial.
- **Suggestion:** Either raise the faucet drip to 5 OG (enough for a ledger + a few inference calls), or expose a separate "developer onboarding" flow that grants the minimum directly.

### 6. Compute provider catalog is currently very thin
- **Repro:** `await broker.inference.listService()` on May 2026.
- **Observed:** 2 services total. Only 1 is `serviceType: "chatbot"` (`qwen/qwen-2.5-7b-instruct`). The other is image editing.
- **Why it matters:** Frameworks like ours intentionally use *different* models for the Proposer and Critic to ensure structural disagreement. A single chatbot model means we have to fall back to "same model, different system prompts," weakening the design.
- **Suggestion:** Onboard at least one structurally-different chat model (e.g., a Llama or DeepSeek variant). It does not need to be production-grade — for development, a small fast model would suffice.

## Reproduction environment

- Node 22.20.0
- ethers 6.13.1
- `@0gfoundation/0g-storage-ts-sdk` 1.2.8
- `@0gfoundation/0g-compute-ts-sdk` 0.8.0
- 0G Galileo testnet (chainId 16602)
- Wallet: 0x48D185bc646534597E25199dd4d73692ebD98BAc
