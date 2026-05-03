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
    const toolName =
      this.cfg.toolName ??
      (req.kind === "transfer" ? "execute_transfer" : "execute_protocol_action");
    const buildArgs = this.cfg.buildToolArgs ?? defaultBuildToolArgs;
    const result = await this.rpc(sessionId, "tools/call", {
      name: toolName,
      arguments: buildArgs(req, {
        ...(this.cfg.walletIntegrationId
          ? { walletIntegrationId: this.cfg.walletIntegrationId }
          : {}),
      }),
    });
    let receipt = parseReceipt(result, this.cfg);
    // KeeperHub returns an executionId synchronously; the tx hash arrives
    // when the execution finalizes. Poll get_direct_execution_status until
    // we have a hash or a hard failure.
    const executionId = extractExecutionId(result);
    if (!receipt.txHash && executionId) {
      receipt = await this.pollExecution(sessionId, executionId, receipt);
    }
    return receipt;
  }

  private async pollExecution(
    sessionId: string,
    executionId: string,
    fallback: ExecutionReceipt,
  ): Promise<ExecutionReceipt> {
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 3_000));
      // NOTE: get_direct_execution_status uses snake_case `execution_id`
      // even though execute_transfer / execute_protocol_action return
      // camelCase `executionId`. Captured in feedback/KEEPERHUB_FEEDBACK.md.
      const result = await this.rpc(sessionId, "tools/call", {
        name: "get_direct_execution_status",
        arguments: { execution_id: executionId },
      });
      const next = parseReceipt(result, this.cfg);
      if (next.status === "success" || next.status === "failed") return next;
      if (next.txHash) return next;
    }
    return fallback;
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
  _cfg: { walletIntegrationId?: string },
): Record<string, unknown> => {
  // KeeperHub's execute_protocol_action expects:
  //   { actionType: "<protocol>/<action-slug>", params: { ... } }
  // Use search_protocol_actions for the requiredFields per action.
  if (req.kind === "swap") {
    const p = req.params as Record<string, unknown>;
    return {
      actionType: "uniswap/swap-exact-input",
      params: {
        network: String(p.chainId),
        tokenIn: String(p.tokenIn),
        tokenOut: String(p.tokenOut),
        amountIn: String(p.amountIn),
        slippageBps: String(
          req.constraints.slippageBps ?? req.constraints.expectedSlippage ?? 50,
        ),
        deadline: String(
          Math.floor(Date.now() / 1000) +
            (req.constraints.deadlineSeconds ?? 600),
        ),
      },
    };
  }
  if (req.kind === "transfer") {
    const p = req.params as Record<string, unknown>;
    return {
      network: String(p.chainId ?? p.network ?? "11155111"),
      recipient_address: String(p.recipient ?? p.to),
      amount: String(p.amount),
      ...(p.tokenAddress ? { token_address: String(p.tokenAddress) } : {}),
    };
  }
  return {
    ...req.params,
    constraints: req.constraints,
  };
};

const extractExecutionId = (
  result: Record<string, unknown> | undefined,
): string | null => {
  if (!result) return null;
  const direct =
    (result.executionId as string | undefined) ??
    (result.execution_id as string | undefined);
  if (direct) return direct;
  const content = result.content as { type: string; text: string }[] | undefined;
  if (content?.[0]?.text) {
    try {
      const parsed = JSON.parse(content[0].text) as Record<string, unknown>;
      return (
        (parsed.executionId as string | undefined) ??
        (parsed.execution_id as string | undefined) ??
        null
      );
    } catch {
      return null;
    }
  }
  return null;
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
  // KeeperHub uses "completed" / "failed" / "running" — normalize to our
  // ExecutionReceipt vocabulary (success / failed / pending).
  const rawStatus = String(payload.status ?? "").toLowerCase();
  const status: ExecutionReceipt["status"] =
    rawStatus === "completed" || rawStatus === "success"
      ? "success"
      : rawStatus === "failed" || rawStatus === "error"
        ? "failed"
        : txHash
          ? "pending"
          : rawStatus === ""
            ? "pending"
            : "pending";
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
