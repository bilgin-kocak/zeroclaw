import { createHash } from "node:crypto";
import type {
  ExecutionBackend,
  ExecutionReceipt,
  ExecutionRequest,
} from "../backend.js";

export interface MockExecutionConfig {
  /** Override the explorer base URL; default looks like Etherscan. */
  explorerBase?: string;
  /** Override the chain block number reported on the receipt. */
  blockNumber?: number;
  /** When true, attempts include a single failed-then-retried attempt. */
  simulateRetry?: boolean;
}

/**
 * Deterministic mock — the demo-day failsafe. Tx hashes derive from the request
 * nonce so the same request always yields the same fake hash, and the URL is
 * shaped like a real Etherscan link.
 */
export class MockExecutionBackend implements ExecutionBackend {
  private explorerBase: string;
  private blockNumber: number;
  private simulateRetry: boolean;
  public readonly calls: ExecutionRequest[] = [];

  constructor(cfg: MockExecutionConfig = {}) {
    this.explorerBase = cfg.explorerBase ?? "https://sepolia.etherscan.io/tx";
    this.blockNumber = cfg.blockNumber ?? 1_234_567;
    this.simulateRetry = cfg.simulateRetry ?? false;
  }

  async execute(req: ExecutionRequest): Promise<ExecutionReceipt> {
    this.calls.push(req);
    const txHash = `0x${createHash("sha256").update(req.nonce).digest("hex")}`;
    const attempts = this.simulateRetry
      ? [
          { txHash: `0x${"a".repeat(64)}`, revertReason: "transient: nonce" },
          { txHash },
        ]
      : undefined;
    return {
      txHash,
      blockNumber: this.blockNumber,
      status: "success",
      ...(attempts ? { attempts } : {}),
      explorerUrl: `${this.explorerBase}/${txHash}`,
    };
  }
}
