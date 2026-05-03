import { ethers } from "ethers";
import type {
  InferenceBackend,
  InferenceRequest,
  InferenceResponse,
} from "../backend.js";

export interface ZeroGComputeConfig {
  rpcUrl: string;
  privateKey: string;
  /** Optional override of the broker factory (for tests). */
  brokerFactory?: (wallet: ethers.Wallet) => Promise<ZeroGBroker>;
}

/**
 * Subset of the @0gfoundation/0g-compute-ts-sdk broker surface we use. Kept
 * narrow so the SDK can evolve without rippling here.
 */
export interface ZeroGBroker {
  inference: {
    listService(): Promise<ZeroGServiceMetadata[]>;
    getServiceMetadata(providerAddress: string): Promise<{
      endpoint: string;
      model: string;
    }>;
    getRequestHeaders(
      providerAddress: string,
      content?: string,
    ): Promise<Record<string, string>>;
  };
}

export interface ZeroGServiceMetadata {
  provider: string;
  model: string;
  endpoint?: string;
  serviceType?: string;
  verifiability?: "TeeML" | "OPML" | "ZKML";
}

const defaultBrokerFactory = async (
  wallet: ethers.Wallet,
): Promise<ZeroGBroker> => {
  // Imported lazily so the test path doesn't pull in the SDK.
  const mod = await import("@0gfoundation/0g-compute-ts-sdk");
  const factory =
    (mod as unknown as {
      createZGComputeNetworkBroker?: (w: ethers.Wallet) => Promise<ZeroGBroker>;
    }).createZGComputeNetworkBroker;
  if (!factory) {
    throw new Error(
      "0G Compute SDK does not expose createZGComputeNetworkBroker as expected",
    );
  }
  return factory(wallet);
};

export class ZeroGComputeBackend implements InferenceBackend {
  private broker: ZeroGBroker | null = null;
  private wallet: ethers.Wallet;
  /** Map: model id -> provider address. Filled lazily from listService(). */
  private providerForModel = new Map<string, string>();

  constructor(private cfg: ZeroGComputeConfig) {
    const provider = new ethers.JsonRpcProvider(cfg.rpcUrl);
    this.wallet = new ethers.Wallet(cfg.privateKey, provider);
  }

  /** Returns the live model catalog. Useful at boot to pick two distinct models. */
  async listServices(): Promise<ZeroGServiceMetadata[]> {
    const broker = await this.getBroker();
    return broker.inference.listService();
  }

  async complete(req: InferenceRequest): Promise<InferenceResponse> {
    const broker = await this.getBroker();
    const provider = await this.findProvider(req.model, broker);
    const { endpoint } = await broker.inference.getServiceMetadata(provider);

    const messages: { role: string; content: string }[] = [];
    if (req.system) messages.push({ role: "system", content: req.system });
    for (const m of req.messages) messages.push({ role: m.role, content: m.content });

    const body = {
      model: req.model,
      messages,
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      ...(req.responseFormat === "json"
        ? { response_format: { type: "json_object" } }
        : {}),
    };
    const headers = await broker.inference.getRequestHeaders(
      provider,
      JSON.stringify(body),
    );
    const res = await fetch(`${endpoint}/v1/proxy/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`0G Compute ${res.status}: ${await res.text()}`);
    }
    const json = (await res.json()) as Record<string, unknown>;
    const content = String(
      ((json.choices as { message?: { content?: string } }[] | undefined)?.[0]
        ?.message?.content) ?? "",
    );
    const verif = json.verifiability as
      | { kind?: string; proof?: string }
      | undefined;
    const out: InferenceResponse = { content, model: req.model };
    if (verif?.kind && verif?.proof) {
      out.verifiability = {
        kind: verif.kind as "TeeML" | "OPML" | "ZKML",
        proof: verif.proof,
      };
    }
    return out;
  }

  private async getBroker(): Promise<ZeroGBroker> {
    if (this.broker) return this.broker;
    const factory = this.cfg.brokerFactory ?? defaultBrokerFactory;
    this.broker = await factory(this.wallet);
    return this.broker;
  }

  private async findProvider(
    model: string,
    broker: ZeroGBroker,
  ): Promise<string> {
    const cached = this.providerForModel.get(model);
    if (cached) return cached;
    const services = await broker.inference.listService();
    const match = services.find((s) => s.model === model);
    if (!match) {
      throw new Error(
        `0G Compute: no provider for model ${model}. Available: ${services
          .map((s) => s.model)
          .join(", ")}`,
      );
    }
    this.providerForModel.set(model, match.provider);
    return match.provider;
  }
}
