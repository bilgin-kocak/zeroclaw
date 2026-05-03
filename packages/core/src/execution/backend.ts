export interface ExecutionRequest {
  kind: "swap" | "transfer" | "call";
  params: Record<string, unknown>;
  constraints: Record<string, number>;
  nonce: string;
}

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
