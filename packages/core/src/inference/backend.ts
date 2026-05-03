export interface InferenceMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface InferenceRequest {
  model: string;
  system?: string;
  messages: InferenceMessage[];
  responseFormat?: "text" | "json";
  temperature?: number;
}

export interface VerifiabilityProof {
  kind: "TeeML" | "OPML" | "ZKML";
  proof: string;
}

export interface InferenceResponse {
  content: string;
  model: string;
  verifiability?: VerifiabilityProof;
}

export interface InferenceBackend {
  complete(req: InferenceRequest): Promise<InferenceResponse>;
}
