export interface ExecutionRequest {
  kind: "swap" | "transfer" | "call";
  params: Record<string, unknown>;
  constraints: Record<string, number>;
  nonce: string;
}

// "transfer" is included in the union above for KeeperHubExecutionBackend's
// smoke-test path; the SafeSwap demo path always uses kind="swap".

export interface ExecutionAttempt {
  txHash: string;
  revertReason?: string;
}

export interface ExecutionReceipt {
  txHash: string;
  blockNumber?: number;
  status: "success" | "failed" | "pending";
  attempts?: ExecutionAttempt[];
  explorerUrl: string;
}

export interface ExecutionBackend {
  execute(req: ExecutionRequest): Promise<ExecutionReceipt>;
}
