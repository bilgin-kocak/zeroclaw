import { createHash } from "node:crypto";
import type {
  InferenceBackend,
  InferenceRequest,
  InferenceResponse,
} from "../backend.js";

type CannedResponse =
  | string
  | object
  | ((req: InferenceRequest) => string | object);

export interface MockInferenceConfig {
  /**
   * Map: fingerprint -> canned response.
   * Fingerprint = sha256(req.system ?? "" + last user message).
   */
  responses?: Map<string, CannedResponse>;
  /** Default response when no fingerprint matches. */
  fallback?: CannedResponse;
}

const fingerprint = (req: InferenceRequest): string => {
  const lastUser =
    req.messages.filter((m) => m.role === "user").at(-1)?.content ?? "";
  const sys = req.system ?? "";
  return createHash("sha256").update(`${sys}::${lastUser}`).digest("hex");
};

export class MockInferenceBackend implements InferenceBackend {
  private responses: Map<string, CannedResponse>;
  private fallback: CannedResponse;
  /** Calls made; useful for assertions in tests. */
  public readonly calls: InferenceRequest[] = [];

  constructor(cfg: MockInferenceConfig = {}) {
    this.responses = cfg.responses ?? new Map();
    this.fallback = cfg.fallback ?? "";
  }

  /**
   * Register a canned response keyed by the system+lastUser fingerprint of an
   * example request. Matches future requests with the same fingerprint.
   */
  cannedFor(req: InferenceRequest, response: CannedResponse): void {
    this.responses.set(fingerprint(req), response);
  }

  setFallback(response: CannedResponse): void {
    this.fallback = response;
  }

  async complete(req: InferenceRequest): Promise<InferenceResponse> {
    this.calls.push(req);
    const fp = fingerprint(req);
    const raw = this.responses.get(fp) ?? this.fallback;
    const resolved = typeof raw === "function" ? raw(req) : raw;
    const content =
      typeof resolved === "string" ? resolved : JSON.stringify(resolved);
    return { content, model: req.model };
  }
}
