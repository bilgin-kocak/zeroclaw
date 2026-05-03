# KeeperHub — Builder Feedback (Bounty submission)

Project: ZeroClaw (Open Agents hackathon, May 2026).
Author: Bilgin / movezone lab.
Integration surface: `packages/core/src/execution/backends/keeperhub.ts` — implements the `ExecutionBackend` interface for KeeperHub MCP.

Per the Builder Feedback Bounty rules, each item below names **a category, a specific reproduction, and an actionable suggestion**. Generic praise or vague criticism is excluded.

---

## UX / UI friction

### 1. `execute_transfer` returns `executionId`, but `get_direct_execution_status` requires `execution_id`
- **Category:** API consistency.
- **Repro:**
  ```ts
  const r = await callTool("execute_transfer", { network, recipient_address, amount });
  // r.content[0].text → JSON containing { "executionId": "...", "status": "..." }
  await callTool("get_direct_execution_status", { executionId: r.executionId });
  // → MCP error -32602: Input validation error: expected string, received undefined for execution_id
  await callTool("get_direct_execution_status", { execution_id: r.executionId });  // works
  ```
- **Observed:** Tool A returns camelCase, tool B requires snake_case.
- **Why it matters:** Cost a debug round-trip. An LLM agent stitching these calls together using the schema will trip the same gap.
- **Suggestion:** Pick one casing convention (camelCase is more JS-native) and apply it across `execute_*` and `get_direct_execution_status`.

### 2. `tools/list` claims `execute_protocol_action` is the swap entry point but its `inputSchema.params` is `additionalProperties: {}`
- **Category:** Documentation.
- **Repro:** Look at the `inputSchema` returned by `tools/list` for `execute_protocol_action`. The `params` object has no specific fields documented; the description says "Use search_protocol_actions to discover required params."
- **Why it matters:** An LLM agent must do TWO MCP calls before it can invoke a swap (search_protocol_actions, then execute_protocol_action). Worse, search_protocol_actions caps results at 25 (we hit this when searching "swap" — Uniswap actions were past the cap).
- **Suggestion:** (a) embed action schemas as `oneOf` discriminated by `actionType` in the input schema; (b) raise the search cap to ~100 or paginate.

### 3. Wallet integration ID is what `list_integrations` calls `id`, but the field name varies in payloads
- **Category:** API consistency.
- **Repro:** `list_integrations` returns `{ id: "...", type: "web3", name: "0xFd56..." }`. Other places refer to the same value as `integrationId` or `walletIntegrationId`. The `type` field for a wallet integration is `web3`, not `wallet` (we filtered for `type === "wallet"` and missed it).
- **Suggestion:** Document `type === "web3"` as the wallet category, and standardize on a single key name (`id`) across endpoints.

### 4. KeeperHub-managed wallet starts empty; first `execute_*` call fails silently with `status: "failed"` and no error message
- **Category:** Onboarding UX.
- **Repro:** Add a Web3 integration in the KeeperHub UI. Without funding the resulting wallet, call `execute_transfer { network, recipient, amount }`. Response: `{ executionId, status: "failed" }` immediately.
- **Why it matters:** No hint that "the managed wallet has 0 ETH on this chain." A new developer assumes their MCP call shape is wrong.
- **Suggestion:** Either pre-flight a balance check and surface `error: "INSUFFICIENT_BALANCE for chain X"`, or include an `error` string on the failure receipt explaining why the execution was marked failed.

## Reproducible bugs

None blocking. The MCP transport, session-id handshake, and notification routing all behaved exactly as the spec describes.

## Documentation gaps

- The `streamable-HTTP` transport details (initialize → mcp-session-id → notifications/initialized → tools/call) are not on the `docs.keeperhub.com/ai-tools` setup page; we discovered the protocol by reading the error response. A 30-line "if you're writing a custom MCP client, here's the handshake" section would save every backend integrator a debugging round.
- `get_direct_execution_status` is not linked from the `execute_*` tool descriptions; the natural next call is invisible.

## Feature requests

- [ ] **Streaming receipts via MCP.** Right now `tools/call` returns a single receipt; for slow chains it would be more agent-friendly to stream progress events (`accepted`, `included`, `confirmed`) over a single MCP message.
- [ ] **Constraint-aware quotes.** Pass slippageBps + deadline into the quote tool and have it return whether the route satisfies them — saves a roundtrip for our commit-reveal anchor.

## Reproduction environment

- Node 22.20.0
- `@modelcontextprotocol/sdk` (latest)
- Chain: Unichain Sepolia (chainId 1301) — TODO confirm KeeperHub coverage
- KeeperHub MCP server: (URL from KEEPERHUB_MCP_URL env var, redacted)
