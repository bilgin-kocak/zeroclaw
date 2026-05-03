# SETUP — external steps the human has to do

These are the things I (Claude) cannot do for you. Knock them out in parallel with my Day 2 mechanism work; nothing here blocks the Day 2 build, but everything here blocks Day 3.

Order is roughly fastest → slowest.

## 1. Create a fresh hackathon wallet (5 min)

Use a brand new private key for this project; do not reuse a personal wallet. You'll fund it on three networks.

```
# Generate one quickly
node -e "import('crypto').then(c => console.log('0x' + c.randomBytes(32).toString('hex')))"
# Or via cast:
cast wallet new
```

Save the private key as `DEPLOYER_PRIVATE_KEY` and (the same key works fine) `ZEROG_PRIVATE_KEY` in `.env.local`.

## 2. 0G testnet funds (5 min)

- Faucet: https://faucet.0g.ai (or whatever the current URL is — check https://docs.0g.ai)
- RPC default in `.env.example`: `https://evmrpc-testnet.0g.ai`
- You need 0G testnet tokens for both Storage uploads and Compute payments.

After funding, also visit https://compute-marketplace.0g.ai/inference (or run `npx 0g-compute-cli inference list-providers`) and note **two distinct model IDs from the live catalog** — Proposer will use one, Critic the other. Paste them into `.env.local` as `ZEROG_PROPOSER_MODEL` and `ZEROG_CRITIC_MODEL` (I'll add those vars to my code on Day 3).

## 3. Sepolia ETH (10 min)

Two faucets to hit because Sepolia is rate-limited per faucet:
- https://www.alchemy.com/faucets/ethereum-sepolia
- https://sepoliafaucet.com (or any QuikNode / Infura faucet)

You need ~0.05 Sepolia ETH for ENS registration + a few text-record writes.

## 4. Register an ENS name on Sepolia (15 min)

- App: https://app.ens.domains
- Switch network to Sepolia.
- Search and register `zeroclaw.eth` (or the closest available — pick something short you can speak in the demo video).
- After registration, the name owner = the wallet from step 1. We'll create subnames `proposer.<name>.eth` and `critic.<name>.eth` programmatically on Day 3.
- Update `ENS_NAME`, `ENS_PROPOSER_SUBNAME`, `ENS_CRITIC_SUBNAME` in `.env.local`.

## 5. Unichain Sepolia ETH (10 min)

For the actual swap demo:
- RPC: `https://sepolia.unichain.org`
- Faucet: https://faucet.unichain.org (verify the URL on https://docs.unichain.org)
- Get ~0.05 ETH so we have headroom for a few demo runs.

## 6. KeeperHub API key (15 min, partly async)

- Sign up at **https://app.keeperhub.com**.
- In the dashboard, go to **Settings → API Keys** and create a new key. It will have the prefix `kh_`.
- Fill in `.env.local`:
  ```
  KEEPERHUB_MCP_URL=https://app.keeperhub.com/mcp
  KEEPERHUB_API_KEY=kh_your_key_here
  ```
  (The MCP URL is shared — every user hits the same endpoint; auth is per-key.)
- **Verify they support Unichain Sepolia** in your dashboard's chain settings. If not, tell me — I'll switch the swap to Sepolia and pick a Sepolia-deployed Uniswap V3 pool instead.
- Read https://docs.keeperhub.com/ai-tools/mcp-server end-to-end and note any friction; that's the seed of `feedback/KEEPERHUB_FEEDBACK.md`.

> **Heads-up on transport.** The current `KeeperHubExecutionBackend` speaks raw JSON-RPC over HTTP. KeeperHub's MCP HTTP transport may require the streamable-HTTP MCP handshake (`@modelcontextprotocol/sdk`'s `StreamableHTTPClientTransport`, already installed). Run `RUN_KEEPERHUB_TESTS=1 pnpm test` once you have the key — if it fails with a transport error, ping me and I'll swap to the SDK transport.

## 7. Uniswap API key (5 min)

- Get one at https://hub.uniswap.org/ (the API console).
- Save as `UNISWAP_API_KEY`.
- Default rate limit is 6 RPS — we'll serialize requests; document any 429s in `feedback/UNISWAP_FEEDBACK.md`.

## 8. (Optional, Day 4 stretch) Telegram bot (10 min)

- DM `@BotFather` on Telegram → `/newbot` → save `TELEGRAM_BOT_TOKEN`.
- Skip if you don't want a Telegram demo; the web UI is the primary surface.

## 9. (Day 5) Railway account (10 min)

For the live demo URL:
- Sign up at https://railway.app (free tier is enough).
- Connect a GitHub repo (we'll push to GitHub on Day 5).

---

## Done? Sanity-check the env

```bash
cd /Users/bilginkocak/hackathon/zeroclaw
cp .env.example .env.local
# fill in .env.local with your values
node -e "import('dotenv-flow').then(d => { d.config(); console.log({ZEROG: !!process.env.ZEROG_PRIVATE_KEY, KEEPERHUB: !!process.env.KEEPERHUB_API_KEY, UNISWAP: !!process.env.UNISWAP_API_KEY, ENS: process.env.ENS_NAME})})"
```

Should print all `true` (or your ENS name). Once that's clean, ping me and I can wire the real backends with high confidence.
