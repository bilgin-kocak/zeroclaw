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

    // Real Sepolia native transfer through the KeeperHub-managed wallet.
    // Proves: session → tools/call → executionId → polling → final tx hash.
    // Requires the KeeperHub-managed wallet to have ~0.001 Sepolia ETH for
    // gas; run `pnpm fund:keeperhub-wallet sepolia 0.02` first.
    it.skipIf(!process.env.RUN_KEEPERHUB_SWAP_TEST)(
      "real native transfer on Sepolia returns a tx hash",
      async () => {
        const k = buildBackend();
        const r = await k.execute({
          kind: "transfer",
          params: {
            chainId: 11155111,
            recipient: "0xFd565A6c2a99Cd68c4ef224Fe24cCc758C6eEA4c",
            amount: "0.001",
          },
          constraints: {},
          nonce: `e2e-transfer-${Date.now()}`,
        });
        expect(r.txHash).toMatch(/^0x[0-9a-fA-F]{64}$/);
        expect(r.status).toBe("success");
        expect(r.explorerUrl).toContain(r.txHash);
      },
      120_000,
    );
  },
);
