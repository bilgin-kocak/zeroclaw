/**
 * Thin wrapper around the Uniswap Trading API.
 *
 * Production base URL: https://trade-api.gateway.uniswap.org/v1
 * Auth header:        x-api-key: <key from hub.uniswap.org>
 *
 * Notes captured during integration (see feedback/UNISWAP_FEEDBACK.md):
 *  - api.uniswap.org/v1 returns ACCESS_DENIED for external API keys; use the
 *    `trade-api.gateway.uniswap.org` host instead.
 *  - slippageTolerance MUST be a JSON number, not a string.
 *  - tokenIn/tokenOut MUST be addresses, not symbols.
 *  - The body uses tokenInChainId / tokenOutChainId, not a single chainId.
 */

export interface QuoteRequest {
  /** ERC20 address. Use a registry like TOKENS_BY_CHAIN to translate symbols. */
  tokenIn: string;
  tokenOut: string;
  /** Amount in the smallest unit of tokenIn, as a decimal string. */
  amountIn: string;
  /** Source chain. Currently same as tokenOut chain. */
  chainId: number;
  /** Optional, only used for the swap endpoint. */
  recipient?: string;
  /** Slippage as a percentage number (0.5 = 0.5%). */
  slippageTolerancePct?: number;
}

export interface Quote {
  amountOut: string;
  midPriceOut: number;
  routePath: string[];
  estimatedGas: string;
  raw: unknown;
}

export interface SwapCalldata {
  to: string;
  data: string;
  value: string;
}

export interface UniswapConfig {
  apiUrl?: string;
  apiKey?: string;
  fetch?: typeof fetch;
}

export class UniswapApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body: unknown,
  ) {
    super(message);
  }
}

/**
 * Token registry per chain. Used by the SafeSwap roles to translate intents
 * like "swap 5 ETH to USDC" into addresses Uniswap expects. This is a small,
 * curated registry — for unknown tokens, callers should pass addresses.
 *
 * On Uniswap's API, *native ETH* is represented as the WETH address (the
 * trading API auto-wraps); the value field of the returned tx covers the
 * native amount.
 */
export const TOKENS_BY_CHAIN: Record<number, Record<string, string>> = {
  1: {
    ETH: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    WETH: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    DAI: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
  },
  // Unichain mainnet
  130: {
    ETH: "0x4200000000000000000000000000000000000006",
    WETH: "0x4200000000000000000000000000000000000006",
    USDC: "0x078D782b760474a361dDA0AF3839290b0EF57AD6",
  },
  // Unichain Sepolia
  1301: {
    ETH: "0x4200000000000000000000000000000000000006",
    WETH: "0x4200000000000000000000000000000000000006",
    USDC: "0x31d0220469e10c4E71834a79b1f276d740d3768F",
  },
};

export const resolveTokenAddress = (
  symbolOrAddress: string,
  chainId: number,
): string => {
  if (symbolOrAddress.startsWith("0x")) return symbolOrAddress;
  const key = symbolOrAddress.toUpperCase();
  const addr = TOKENS_BY_CHAIN[chainId]?.[key];
  if (!addr) {
    throw new Error(
      `UniswapClient: no address known for ${symbolOrAddress} on chain ${chainId}`,
    );
  }
  return addr;
};

const DEFAULT_SWAPPER = "0x0000000000000000000000000000000000000001";

export class UniswapClient {
  private apiUrl: string;
  private apiKey: string | undefined;
  private fetchImpl: typeof fetch;

  constructor(cfg: UniswapConfig = {}) {
    this.apiUrl = cfg.apiUrl ?? "https://trade-api.gateway.uniswap.org/v1";
    this.apiKey = cfg.apiKey;
    this.fetchImpl = cfg.fetch ?? fetch;
  }

  async getQuote(req: QuoteRequest): Promise<Quote> {
    const tokenIn = resolveTokenAddress(req.tokenIn, req.chainId);
    const tokenOut = resolveTokenAddress(req.tokenOut, req.chainId);
    const body = {
      tokenInChainId: req.chainId,
      tokenOutChainId: req.chainId,
      tokenIn,
      tokenOut,
      amount: req.amountIn,
      type: "EXACT_INPUT",
      swapper: req.recipient ?? DEFAULT_SWAPPER,
      slippageTolerance: req.slippageTolerancePct ?? 0.5,
    };
    const res = await this.fetchImpl(`${this.apiUrl}/quote`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new UniswapApiError(res.status, `quote failed: ${res.status}`, text);
    }
    const json = (await res.json()) as Record<string, unknown>;
    return parseQuote(json);
  }

  async getSwap(
    req: QuoteRequest & { recipient: string },
  ): Promise<{ quote: Quote; tx: SwapCalldata }> {
    const tokenIn = resolveTokenAddress(req.tokenIn, req.chainId);
    const tokenOut = resolveTokenAddress(req.tokenOut, req.chainId);
    const body = {
      tokenInChainId: req.chainId,
      tokenOutChainId: req.chainId,
      tokenIn,
      tokenOut,
      amount: req.amountIn,
      type: "EXACT_INPUT",
      swapper: req.recipient,
      slippageTolerance: req.slippageTolerancePct ?? 0.5,
    };
    const res = await this.fetchImpl(`${this.apiUrl}/swap`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new UniswapApiError(res.status, `swap failed: ${res.status}`, text);
    }
    const json = (await res.json()) as Record<string, unknown>;
    const quote = parseQuote(json);
    const tx = parseSwapCalldata(json);
    return { quote, tx };
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json",
    };
    if (this.apiKey) h["x-api-key"] = this.apiKey;
    return h;
  }
}

const parseQuote = (json: Record<string, unknown>): Quote => {
  // The Trading API wraps the actual quote under an object `quote: {...}`.
  // Legacy shapes use a string `quote: "1234..."` at the top level. Detect
  // and unwrap accordingly.
  const nested =
    typeof json.quote === "object" && json.quote !== null
      ? (json.quote as Record<string, unknown>)
      : null;
  const top = json;

  const amountOut = String(
    (nested?.output as Record<string, unknown> | undefined)?.amount ??
      nested?.amount ??
      // Legacy: top-level `quote` is a string amountOut.
      (typeof top.quote === "string" ? top.quote : undefined) ??
      top.amountOut ??
      "0",
  );
  const midPriceOut = Number(
    nested?.midPriceOut ?? top.midPriceOut ?? top.midPrice ?? 0,
  );
  const route = (nested?.route ??
    top.route ??
    top.routePath ??
    []) as unknown;
  const routePath = Array.isArray(route)
    ? route.map((r) => (typeof r === "string" ? r : JSON.stringify(r)))
    : [];
  const estimatedGas = String(
    nested?.gasUseEstimate ??
      nested?.gasEstimate ??
      top.gasUseEstimate ??
      top.gasEstimate ??
      "0",
  );
  return { amountOut, midPriceOut, routePath, estimatedGas, raw: json };
};

const parseSwapCalldata = (json: Record<string, unknown>): SwapCalldata => {
  const tx = (json.swap ??
    json.tx ??
    json.methodParameters ??
    {}) as Record<string, unknown>;
  return {
    to: String(tx.to ?? ""),
    data: String(tx.data ?? tx.calldata ?? ""),
    value: String(tx.value ?? "0"),
  };
};
