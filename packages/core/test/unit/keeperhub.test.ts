import { describe, expect, it, vi } from "vitest";
import { KeeperHubExecutionBackend } from "../../src/execution/backends/keeperhub.js";

/**
 * Build a fetch that walks the KeeperHub MCP session lifecycle:
 * 1) initialize  → returns mcp-session-id header
 * 2) notifications/initialized → 202 no-content
 * 3) tools/call → returns the canned result
 */
const makeSessionFetch = (
  finalResult: unknown,
  sessionId = "session-xyz",
): typeof fetch => {
  let stage = 0;
  return vi.fn(async (_url, init) => {
    const body = JSON.parse((init?.body as string) ?? "{}");
    if (body.method === "initialize") {
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "x" } }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
            "mcp-session-id": sessionId,
          },
        },
      );
    }
    if (body.method === "notifications/initialized") {
      return new Response(null, { status: 202 });
    }
    stage++;
    return new Response(
      JSON.stringify({ jsonrpc: "2.0", id: body.id, result: finalResult }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as unknown as typeof fetch;
};

describe("KeeperHubExecutionBackend (mock fetch)", () => {
  it("initializes a session, then parses an MCP-wrapped receipt", async () => {
    const k = new KeeperHubExecutionBackend({
      apiKey: "k",
      mcpUrl: "https://mcp.example/keeperhub",
      explorerBase: "https://sepolia.uniscan.xyz/tx",
      fetch: makeSessionFetch({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              txHash: "0x" + "ab".repeat(32),
              status: "success",
              blockNumber: 42,
            }),
          },
        ],
      }),
    });
    const r = await k.execute({
      kind: "swap",
      params: { tokenIn: "ETH", tokenOut: "USDC" },
      constraints: { slippageBps: 50 },
      nonce: "n1",
    });
    expect(r.status).toBe("success");
    expect(r.blockNumber).toBe(42);
    expect(r.explorerUrl).toContain("sepolia.uniscan.xyz/tx/0x");
  });

  it("surfaces attempts (audit trail) when the tool returns them", async () => {
    const k = new KeeperHubExecutionBackend({
      apiKey: "k",
      mcpUrl: "https://mcp.example/keeperhub",
      fetch: makeSessionFetch({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              txHash: "0xfeed",
              status: "success",
              attempts: [
                { txHash: "0xfail", revertReason: "transient" },
                { txHash: "0xfeed" },
              ],
            }),
          },
        ],
      }),
    });
    const r = await k.execute({
      kind: "swap",
      params: {},
      constraints: {},
      nonce: "n2",
    });
    expect(r.attempts).toHaveLength(2);
    expect(r.attempts?.[0]?.revertReason).toBe("transient");
  });

  it("listTools surfaces the tool catalog", async () => {
    const k = new KeeperHubExecutionBackend({
      apiKey: "k",
      mcpUrl: "https://mcp.example/keeperhub",
      fetch: makeSessionFetch({
        tools: [
          { name: "execute_protocol_action", description: "Execute a DeFi action" },
          { name: "list_workflows", description: "List workflows" },
        ],
      }),
    });
    const tools = await k.listTools();
    expect(tools.map((t) => t.name)).toContain("execute_protocol_action");
  });

  it("throws on JSON-RPC error", async () => {
    const errFetch: typeof fetch = vi.fn(async (_url, init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      if (body.method === "initialize") {
        return new Response(
          JSON.stringify({ jsonrpc: "2.0", id: body.id, result: {} }),
          {
            status: 200,
            headers: { "mcp-session-id": "s1", "content-type": "application/json" },
          },
        );
      }
      if (body.method === "notifications/initialized") {
        return new Response(null, { status: 202 });
      }
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          error: { code: -32000, message: "boom" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;
    const k = new KeeperHubExecutionBackend({
      apiKey: "k",
      mcpUrl: "https://mcp.example/keeperhub",
      fetch: errFetch,
    });
    await expect(
      k.execute({
        kind: "swap",
        params: {},
        constraints: {},
        nonce: "n3",
      }),
    ).rejects.toThrow(/MCP error/);
  });
});
