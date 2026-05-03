import { describe, expect, it, vi } from "vitest";
import { UniswapClient, UniswapApiError } from "../../src/uniswap.js";

const mockFetch = (
  body: unknown,
  ok = true,
  status = ok ? 200 : 500,
): typeof fetch =>
  vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  ) as unknown as typeof fetch;

describe("UniswapClient", () => {
  it("getQuote returns parsed amountOut and routePath", async () => {
    const c = new UniswapClient({
      apiKey: "k",
      fetch: mockFetch({
        quote: "1234567890",
        midPriceOut: 2400,
        route: ["0xpool1", "0xpool2"],
        gasUseEstimate: "150000",
      }),
    });
    const q = await c.getQuote({
      tokenIn: "ETH",
      tokenOut: "USDC",
      amountIn: "1000000000000000000",
      chainId: 1301,
    });
    expect(q.amountOut).toBe("1234567890");
    expect(q.routePath).toEqual(["0xpool1", "0xpool2"]);
    expect(q.midPriceOut).toBe(2400);
  });

  it("throws UniswapApiError on non-2xx", async () => {
    const c = new UniswapClient({
      fetch: mockFetch({ error: "rate limited" }, false, 429),
    });
    await expect(
      c.getQuote({
        tokenIn: "ETH",
        tokenOut: "USDC",
        amountIn: "1",
        chainId: 1301,
      }),
    ).rejects.toBeInstanceOf(UniswapApiError);
  });

  it("getSwap returns calldata", async () => {
    const c = new UniswapClient({
      fetch: mockFetch({
        quote: "100",
        route: [],
        tx: { to: "0xrouter", data: "0xdeadbeef", value: "0" },
      }),
    });
    const r = await c.getSwap({
      tokenIn: "ETH",
      tokenOut: "USDC",
      amountIn: "1",
      chainId: 1301,
      recipient: "0xuser",
    });
    expect(r.tx.to).toBe("0xrouter");
    expect(r.tx.data).toBe("0xdeadbeef");
  });
});
