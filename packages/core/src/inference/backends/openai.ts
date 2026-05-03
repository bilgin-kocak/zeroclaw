import OpenAI from "openai";
import type {
  InferenceBackend,
  InferenceRequest,
  InferenceResponse,
} from "../backend.js";

export interface OpenAIBackendConfig {
  apiKey: string;
  baseUrl?: string;
}

/**
 * Dev fallback only. The 0G Track A submission must demo against 0G Compute;
 * this backend exists so development isn't blocked by 0G availability.
 */
export class OpenAIInferenceBackend implements InferenceBackend {
  private client: OpenAI;

  constructor(cfg: OpenAIBackendConfig) {
    this.client = new OpenAI({
      apiKey: cfg.apiKey,
      ...(cfg.baseUrl ? { baseURL: cfg.baseUrl } : {}),
    });
  }

  async complete(req: InferenceRequest): Promise<InferenceResponse> {
    const messages: { role: "system" | "user" | "assistant"; content: string }[] =
      [];
    if (req.system) messages.push({ role: "system", content: req.system });
    for (const m of req.messages) messages.push({ role: m.role, content: m.content });

    const completion = await this.client.chat.completions.create({
      model: req.model,
      messages,
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      ...(req.responseFormat === "json"
        ? { response_format: { type: "json_object" } }
        : {}),
    });
    const content = completion.choices[0]?.message.content ?? "";
    return { content, model: completion.model };
  }
}
