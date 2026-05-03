import { describe, expect, it } from "vitest";
import { UniswapClient } from "../../src/uniswap.js";

const enabled = process.env.RUN_UNISWAP_TESTS === "1";

describe.skipIf(!enabled)(
  "Uniswap API e2e (RUN_UNISWAP_TESTS=1)",
  () => {
    const c = new UniswapClient({
      apiUrl: process.env.UNISWAP_API_URL ?? "https://api.uniswap.org/v1",
      apiKey: process.env.UNISWAP_API_KEY ?? "",
    });

    it(
      "getQuote(ETH->USDC, 1 ETH) returns a non-zero amountOut",
      async () => {
        const r = await c.getQuote({
          tokenIn: "ETH",
          tokenOut: "USDC",
          amountIn: "1000000000000000000",
          chainId: Number(process.env.UNICHAIN_CHAIN_ID ?? "1301"),
        });
        expect(r.amountOut).not.toBe("0");
      },
      60_000,
    );
  },
);
