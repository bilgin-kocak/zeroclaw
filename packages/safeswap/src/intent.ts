export interface ParsedIntent {
  amount: string;
  tokenIn: string;
  tokenOut: string;
  hint?: string;
}

const TOKEN_ALIASES: Record<string, { symbol: string; decimals: number }> = {
  ETH: { symbol: "ETH", decimals: 18 },
  WETH: { symbol: "WETH", decimals: 18 },
  USDC: { symbol: "USDC", decimals: 6 },
  USDT: { symbol: "USDT", decimals: 6 },
  DAI: { symbol: "DAI", decimals: 18 },
  WBTC: { symbol: "WBTC", decimals: 8 },
};

const SWAP_RE = /swap\s+([\d.]+)\s+([a-zA-Z]+)\s+(?:to|for|into)\s+([a-zA-Z]+)(?:[,\s]+(.+))?/i;

export const parseSwapIntent = (raw: string): ParsedIntent | null => {
  const m = raw.match(SWAP_RE);
  if (!m) return null;
  const [, amount, tokenInRaw, tokenOutRaw, hint] = m;
  if (!amount || !tokenInRaw || !tokenOutRaw) return null;
  const tokenIn = TOKEN_ALIASES[tokenInRaw.toUpperCase()];
  const tokenOut = TOKEN_ALIASES[tokenOutRaw.toUpperCase()];
  if (!tokenIn || !tokenOut) return null;
  return {
    amount,
    tokenIn: tokenIn.symbol,
    tokenOut: tokenOut.symbol,
    ...(hint ? { hint: hint.trim() } : {}),
  };
};

export const tokenDecimals = (symbol: string): number =>
  TOKEN_ALIASES[symbol.toUpperCase()]?.decimals ?? 18;

export const toBaseUnits = (amount: string, decimals: number): string => {
  const [whole, frac = ""] = amount.split(".");
  const padded = (frac + "0".repeat(decimals)).slice(0, decimals);
  const trimmed = (whole ?? "0").replace(/^0+(?=\d)/, "") || "0";
  return BigInt(trimmed + padded).toString();
};
