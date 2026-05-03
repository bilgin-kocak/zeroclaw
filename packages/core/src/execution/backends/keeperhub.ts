import type {
  ExecutionBackend,
  ExecutionReceipt,
  ExecutionRequest,
} from "../backend.js";

export interface KeeperHubConfig {
  apiKey: string;
  /** MCP HTTP endpoint. Production: https://app.keeperhub.com/mcp */
  mcpUrl: string;
  /** Override fetch (for unit tests). */
  fetch?: typeof fetch;
  /** Block explorer base for the target chain. */
  explorerBase?: string;
  /**
   * Operator wallet integration ID (from KeeperHub dashboard → Integrations).
   * Required for execute_* tools that send transactions.
   */
  walletIntegrationId?: string;
  /**
   * Tool name to invoke. Defaults to "execute_protocol_action" for SafeSwap.
   * Override to "execute_transfer" or "execute_contract_call" if needed.
   */
  toolName?: string;
  /**
   * Optional override for what arguments are sent to the tool. Receives the
   * ExecutionRequest plus the wallet integration id; returns the tool args.
   * Default builds a Uniswap V3 swap action.
   */
  buildToolArgs?: (
    req: ExecutionRequest,
    cfg: { walletIntegrationId?: string },
  ) => Record<string, unknown>;
}

/**
 * KeeperHub MCP-based execution backend.
 *
 * Speaks the streamable-HTTP MCP transport: an `initialize` handshake yields
 * an `mcp-session-id` header that subsequent calls must echo. We send a
 * `notifications/initialized` after init, then `tools/call` for the actual
 * execution.
 *
 * The default tool is `execute_protocol_action` which submits a DeFi action
 * (e.g. a Uniswap swap) using a pre-configured wallet integration. The wallet
 * integration ID comes from the KeeperHub dashboard.
 */
export class KeeperHubExecutionBackend implements ExecutionBackend {
  private fetchImpl: typeof fetch;
  private session: { id: string; expiresAt: number } | null = null;

  constructor(private cfg: KeeperHubConfig) {
    this.fetchImpl = cfg.fetch ?? fetch;
  }

  async execute(req: ExecutionRequest): Promise<ExecutionReceipt> {
    const sessionId = await this.ensureSession();
    const toolName = this.cfg.toolName ?? "execute_protocol_action";
    const buildArgs = this.cfg.buildToolArgs ?? defaultBuildToolArgs;
    const result = await this.rpc(sessionId, "tools/call", {
      name: toolName,
      arguments: buildArgs(req, {
        ...(this.cfg.walletIntegrationId
          ? { walletIntegrationId: this.cfg.walletIntegrationId }
          : {}),
      }),
    });
    return parseReceipt(result, this.cfg);
  }

  /** Lower-level: call any MCP tool by name. Used by callers that need to
   *  invoke `search_protocol_actions`, `list_action_schemas`, etc. */
  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const sessionId = await this.ensureSession();
    return this.rpc(sessionId, "tools/call", { name, arguments: args });
  }

  /** Useful for sanity probes. */
  async listTools(): Promise<{ name: string; description?: string }[]> {
    const sessionId = await this.ensureSession();
    const result = (await this.rpc(sessionId, "tools/list", {})) as {
      tools: { name: string; description?: string }[];
    };
    return result.tools;
  }

  // ---- internals ----

  private async ensureSession(): Promise<string> {
    if (this.session && this.session.expiresAt > Date.now()) {
      return this.session.id;
    }
    const id = await this.initialize();
    // Sessions on KeeperHub last ~24h; refresh after 12h to be safe.
    this.session = { id, expiresAt: Date.now() + 12 * 3600 * 1000 };
    await this.notifyInitialized(id);
    return id;
  }

  private async initialize(): Promise<string> {
    const res = await this.fetchImpl(this.cfg.mcpUrl, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: cryptoId(),
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "zeroclaw", version: "0.1" },
        },
      }),
    });
    if (!res.ok) {
      throw new Error(`KeeperHub initialize ${res.status}: ${await res.text()}`);
    }
    const sid = res.headers.get("mcp-session-id");
    if (!sid) {
      throw new Error(
        "KeeperHub initialize did not return mcp-session-id header",
      );
    }
    // Drain the body to free the connection.
    await res.text();
    return sid;
  }

  private async notifyInitialized(sessionId: string): Promise<void> {
    await this.fetchImpl(this.cfg.mcpUrl, {
      method: "POST",
      headers: { ...this.headers(), "mcp-session-id": sessionId },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      }),
    });
  }

  private async rpc(
    sessionId: string,
    method: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const res = await this.fetchImpl(this.cfg.mcpUrl, {
      method: "POST",
      headers: { ...this.headers(), "mcp-session-id": sessionId },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: cryptoId(),
        method,
        params,
      }),
    });
    if (!res.ok) {
      throw new Error(`KeeperHub ${res.status}: ${await res.text()}`);
    }
    const json = (await res.json()) as Record<string, unknown>;
    if (json.error) {
      throw new Error(
        `KeeperHub MCP error: ${JSON.stringify(json.error)}`,
      );
    }
    return (json.result ?? {}) as Record<string, unknown>;
  }

  private headers(): Record<string, string> {
    return {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${this.cfg.apiKey}`,
    };
  }
}

const defaultBuildToolArgs = (
  req: ExecutionRequest,
  cfg: { walletIntegrationId?: string },
): Record<string, unknown> => {
  if (req.kind === "swap") {
    const p = req.params as Record<string, unknown>;
    return {
      protocol: "uniswap",
      action: "swap",
      chainId: p.chainId,
      tokenIn: p.tokenIn,
      tokenOut: p.tokenOut,
      amountIn: p.amountIn,
      slippageBps: req.constraints.slippageBps ?? req.constraints.expectedSlippage ?? 50,
      ...(cfg.walletIntegrationId
        ? { walletIntegrationId: cfg.walletIntegrationId }
        : {}),
    };
  }
  return {
    ...req.params,
    constraints: req.constraints,
    ...(cfg.walletIntegrationId
      ? { walletIntegrationId: cfg.walletIntegrationId }
      : {}),
  };
};

const parseReceipt = (
  result: Record<string, unknown> | undefined,
  cfg: KeeperHubConfig,
): ExecutionReceipt => {
  // KeeperHub MCP wraps results in a `content` array of `{ type, text }`.
  // The actual structured payload is usually in the first text item as JSON.
  let payload: Record<string, unknown> = result ?? {};
  const content = (result?.content as { type: string; text: string }[] | undefined) ??
    undefined;
  if (content && content[0]?.text) {
    try {
      payload = JSON.parse(content[0].text);
    } catch {
      // leave payload as the raw result
    }
  }
  const txHash = String(
    payload.txHash ?? payload.hash ?? payload.transactionHash ?? "",
  );
  const status =
    (payload.status as ExecutionReceipt["status"]) ??
    (txHash ? "pending" : "failed");
  const blockNumber =
    payload.blockNumber !== undefined ? Number(payload.blockNumber) : undefined;
  const explorerBase = cfg.explorerBase ?? "https://sepolia.uniscan.xyz/tx";
  const attempts = Array.isArray(payload.attempts)
    ? (payload.attempts as { txHash: string; revertReason?: string }[])
    : undefined;
  return {
    txHash,
    ...(blockNumber !== undefined ? { blockNumber } : {}),
    status,
    ...(attempts ? { attempts } : {}),
    explorerUrl: txHash
      ? `${explorerBase}/${txHash}`
      : `${explorerBase}/-`,
  };
};

let _idCounter = 0;
const cryptoId = (): string => `${Date.now()}-${++_idCounter}`;
