# KeeperHub — Builder Feedback (Bounty submission)

Project: ZeroClaw (Open Agents hackathon, May 2026).
Author: Bilgin / movezone lab.
Integration surface: `packages/core/src/execution/backends/keeperhub.ts` — implements the `ExecutionBackend` interface for KeeperHub MCP.

Per the Builder Feedback Bounty rules, each item below names **a category, a specific reproduction, and an actionable suggestion**. Generic praise or vague criticism is excluded.

---

## UX / UI friction

(Fill in during integration as we hit issues.)

### 1. (placeholder)
- **Category:** UX friction.
- **Repro:**
- **Observed:**
- **Why it matters:**
- **Suggestion:**

## Reproducible bugs

(Fill in during integration. The audit-trail-with-attempts feature is the most likely place we'll find behaviour worth reporting on.)

## Documentation gaps

(Fill in during integration. Tracker for the things we wished were in `docs.keeperhub.com/ai-tools` while we were wiring up the MCP client.)

## Feature requests

- [ ] **Streaming receipts via MCP.** Right now `tools/call` returns a single receipt; for slow chains it would be more agent-friendly to stream progress events (`accepted`, `included`, `confirmed`) over a single MCP message.
- [ ] **Constraint-aware quotes.** Pass slippageBps + deadline into the quote tool and have it return whether the route satisfies them — saves a roundtrip for our commit-reveal anchor.

## Reproduction environment

- Node 22.20.0
- `@modelcontextprotocol/sdk` (latest)
- Chain: Unichain Sepolia (chainId 1301) — TODO confirm KeeperHub coverage
- KeeperHub MCP server: (URL from KEEPERHUB_MCP_URL env var, redacted)
