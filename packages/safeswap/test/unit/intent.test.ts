import { describe, expect, it } from "vitest";
import {
  parseSwapIntent,
  toBaseUnits,
  tokenDecimals,
} from "../../src/intent.js";

describe("parseSwapIntent", () => {
  it("parses simple swap with 'to'", () => {
    expect(parseSwapIntent("swap 5 ETH to USDC")).toEqual({
      amount: "5",
      tokenIn: "ETH",
      tokenOut: "USDC",
    });
  });

  it("parses fractional amounts and 'into'", () => {
    expect(parseSwapIntent("swap 0.25 WETH into DAI")).toEqual({
      amount: "0.25",
      tokenIn: "WETH",
      tokenOut: "DAI",
    });
  });

  it("captures trailing hint after the swap clause", () => {
    expect(
      parseSwapIntent("swap 1 ETH to USDC, lowest slippage"),
    ).toMatchObject({
      hint: "lowest slippage",
    });
  });

  it("returns null for unknown tokens", () => {
    expect(parseSwapIntent("swap 5 FOO to BAR")).toBeNull();
  });

  it("returns null for non-swap text", () => {
    expect(parseSwapIntent("hello bot")).toBeNull();
  });
});

describe("toBaseUnits", () => {
  it("converts whole amounts to wei (18 decimals)", () => {
    expect(toBaseUnits("5", 18)).toBe("5000000000000000000");
  });

  it("converts fractional amounts to base units (6 decimals)", () => {
    expect(toBaseUnits("1.5", 6)).toBe("1500000");
  });

  it("truncates excess decimals beyond the token precision", () => {
    expect(toBaseUnits("0.0000001", 6)).toBe("0");
  });

  it("tokenDecimals knows common tokens", () => {
    expect(tokenDecimals("USDC")).toBe(6);
    expect(tokenDecimals("ETH")).toBe(18);
    expect(tokenDecimals("WBTC")).toBe(8);
  });
});
