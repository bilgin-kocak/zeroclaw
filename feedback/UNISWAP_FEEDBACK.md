# Uniswap API — Builder Feedback

Project: ZeroClaw (Open Agents hackathon, May 2026).
Author: Bilgin / movezone lab.
Integration surface: `packages/safeswap/src/uniswap.ts` — wraps `api.uniswap.org/v1` for `getQuote()` and `getSwap()`.

This file is **required at the repo root as `FEEDBACK.md`** for Uniswap prize eligibility; the canonical copy lives here and `FEEDBACK.md` is a copy/symlink.

---

## What worked well

(Filled during integration. Examples to fill in: stable response shape for ETH→USDC; clear `route` field; predictable HTTP status codes.)

## DX friction

### 0. Wrong base URL discoverable from key dashboard
- **Repro:** Get an API key from `hub.uniswap.org`. Use `api.uniswap.org/v1` (the URL implied by the developer-portal landing page and used by the Uniswap web UI). Send a `POST /quote` with `x-api-key: <your key>`.
- **Observed:** HTTP 409, body `{"errorCode":"ACCESS_DENIED"}`. No hint that the wrong host was queried.
- **Actual host:** `https://trade-api.gateway.uniswap.org/v1`. This URL is **not present in the developer landing page or the Getting Started page** as of May 2026 — I had to discover it by inspecting other people's integrations.
- **Why it matters:** Lost ~30 minutes assuming the key was bad before checking the host. The error code `ACCESS_DENIED` reads as "your key is wrong" rather than "wrong host."
- **Suggestion:** (a) make the dashboard show the canonical base URL alongside the key; (b) when `api.uniswap.org/v1` receives a request with an external `x-api-key`, return a body like `{"errorCode":"WRONG_HOST","detail":"Use https://trade-api.gateway.uniswap.org/v1 for external API keys."}`.

### 1. `slippageTolerance` field type silently rejected
- **Repro:** Send `"slippageTolerance": "0.5"` (string) in the `/quote` body — natural if you serialize a config object that stringifies numbers.
- **Observed:** `{"errorCode":"RequestValidationError","detail":"\"slippageTolerance\" must be a number"}`.
- **Why it matters:** The error message is fine, but the docs (where they exist) show `slippageTolerance` without a type indicator. Easy to ship a stringified version and not catch it until production.
- **Suggestion:** Document the type explicitly, or accept numeric strings (Number(value)).

### 2. Token symbols not accepted; address-only
- **Repro:** Set `tokenIn: "ETH"`, `tokenOut: "USDC"`.
- **Observed:** Validation error.
- **Why it matters:** Every other agent-facing API (CoinGecko, CMC, etc.) accepts symbols. We had to ship a per-chain registry (`TOKENS_BY_CHAIN` in `packages/safeswap/src/uniswap.ts`) just for the demo to handle "swap 5 ETH to USDC" intent strings.
- **Suggestion:** Accept canonical symbols on a configurable per-chain basis, OR expose a separate `/tokens?chainId=N` endpoint that returns the address registry.

### 3. Rate limit surface area
- **Repro:** issue 6 quote requests within 800ms with default API key.
- **Observed:** HTTP 429 with no `Retry-After` header on response 5/6.
- **Why it matters:** parallel quote-fetcher (Proposer and Critic re-quote independently for commit-reveal anchor) easily exceeds 6 RPS during a single deliberation.
- **Workaround:** serialized quote fetcher with a single in-flight request.
- **Suggestion:** include `Retry-After` and `X-RateLimit-Remaining` headers, or document the limit explicitly per-endpoint.

### 2. Quote field name drift across versions
- **Repro:** different responses shape `quote` vs `output.amount` vs `amountOut`.
- **Observed:** parser code has to fall back through several keys.
- **Why it matters:** breaks naive integrations — and a parser written today against the v1 docs may silently produce zeros if the API switches the canonical field.
- **Suggestion:** lock the response schema with a versioned content-type, or document a stable canonical field.

### 3. Calldata field naming inconsistent
- **Repro:** `tx.data` vs `methodParameters.calldata` across endpoints.
- **Observed:** had to support both shapes.
- **Suggestion:** unify on `tx: { to, data, value }` everywhere.

## Documentation gaps

(Fill in during integration.)
- [ ] No clear example of EXACT_OUTPUT swap calldata.
- [ ] `slippageTolerance` units (percent? bps?) not documented in the response schema page.

## Missing endpoints / desired features

- [ ] **Quote with explicit deadline parameter.** The `getQuote` endpoint accepts a slippage tolerance but not a target deadline; this is the parameter our commit-reveal mechanism contests, so we'd benefit from quote-time validation.
- [ ] **Batch quote.** A single request for N input amounts on the same pair would let the Proposer + Critic re-quote without two HTTP roundtrips.

## Reproduction environment

- Node 22.20.0
- viem 2.48.7 (for chain validation; not used for quote fetching)
- `api.uniswap.org/v1`
- Chain: Unichain Sepolia (chainId 1301)
