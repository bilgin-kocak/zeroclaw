import { describe, expect, it } from "vitest";
import { KeeperHubExecutionBackend } from "../../src/execution/backends/keeperhub.js";

const enabled = process.env.RUN_KEEPERHUB_TESTS === "1";

const buildBackend = (): KeeperHubExecutionBackend =>
  new KeeperHubExecutionBackend({
    apiKey: process.env.KEEPERHUB_API_KEY!,
    mcpUrl: process.env.KEEPERHUB_MCP_URL!,
    explorerBase: "https://sepolia.uniscan.xyz/tx",
    ...(process.env.KEEPERHUB_WALLET_INTEGRATION_ID
      ? { walletIntegrationId: process.env.KEEPERHUB_WALLET_INTEGRATION_ID }
      : {}),
  });

describe.skipIf(!enabled)(
  "KeeperHub MCP e2e (RUN_KEEPERHUB_TESTS=1)",
  () => {
    it(
      "MCP session establishes and tools list contains execute_protocol_action",
      async () => {
        const k = buildBackend();
        const tools = await k.listTools();
        const names = tools.map((t) => t.name);
        expect(names).toContain("execute_protocol_action");
        expect(names.length).toBeGreaterThan(5);
      },
      30_000,
    );

    it(
      "search_protocol_actions returns at least one Uniswap action",
      async () => {
        const k = buildBackend();
        const result = await k.callTool("search_protocol_actions", {
          query: "uniswap",
        });
        const text = JSON.stringify(result);
        expect(text.toLowerCase()).toContain("uniswap");
      },
      60_000,
    );

    // The actual swap path requires a wallet integration to be configured in
    // the KeeperHub dashboard. Gated by a separate flag so the connectivity
    // tests above can pass before the wallet is wired.
    it.skipIf(!process.env.RUN_KEEPERHUB_SWAP_TEST)(
      "small ETH->USDC swap returns a tx hash (requires wallet integration)",
      async () => {
        const k = buildBackend();
        const r = await k.execute({
          kind: "swap",
          params: {
            tokenIn: "ETH",
            tokenOut: "USDC",
            amountIn: "1000000000000000",
            chainId: Number(process.env.UNICHAIN_CHAIN_ID ?? "1301"),
          },
          constraints: { slippageBps: 100 },
          nonce: `e2e-${Date.now()}`,
        });
        expect(r.txHash).toMatch(/^0x[0-9a-fA-F]+$/);
      },
      120_000,
    );
  },
);
