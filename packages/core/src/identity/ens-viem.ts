import { createPublicClient, createWalletClient, http } from "viem";
import { sepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { normalize } from "viem/ens";
import type { Account, Address, Hex, PublicClient, WalletClient } from "viem";
import type { AgentProfile, ENSResolver } from "./ens.js";

export interface ENSViemConfig {
  rpcUrl: string;
  /** Required for setProfile; reads work without it. */
  privateKey?: Hex;
  /** Capability text record key. */
  capabilitiesKey?: string;
  /** Reputation pointer text record key (0G Storage CID/root hash). */
  reputationKey?: string;
}

const DEFAULT_CAPABILITIES_KEY = "zeroclaw.capabilities";
const DEFAULT_REPUTATION_KEY = "zeroclaw.reputation";

/**
 * viem-backed ENS resolver. Capability discovery: reads `zeroclaw.capabilities`
 * text record (JSON array). Reputation pointer: reads `zeroclaw.reputation`
 * text record (a 0G Storage root hash) — this is the ENS Most Creative angle:
 * an ENS name that points to where its mind lives.
 */
export class ENSViemResolver implements ENSResolver {
  private publicClient: PublicClient;
  private walletClient: WalletClient | null = null;
  private account: Account | null = null;
  private capabilitiesKey: string;
  private reputationKey: string;

  constructor(cfg: ENSViemConfig) {
    this.publicClient = createPublicClient({
      chain: sepolia,
      transport: http(cfg.rpcUrl),
    });
    if (cfg.privateKey) {
      this.account = privateKeyToAccount(cfg.privateKey);
      this.walletClient = createWalletClient({
        account: this.account,
        chain: sepolia,
        transport: http(cfg.rpcUrl),
      });
    }
    this.capabilitiesKey = cfg.capabilitiesKey ?? DEFAULT_CAPABILITIES_KEY;
    this.reputationKey = cfg.reputationKey ?? DEFAULT_REPUTATION_KEY;
  }

  async resolveProfile(name: string): Promise<AgentProfile | null> {
    const normalized = normalize(name);
    const owner = await this.publicClient.getEnsAddress({ name: normalized });
    if (!owner) return null;

    const [capsRaw, repPtr] = await Promise.all([
      this.publicClient.getEnsText({ name: normalized, key: this.capabilitiesKey }),
      this.publicClient.getEnsText({ name: normalized, key: this.reputationKey }),
    ]);

    const capabilities = parseCapabilities(capsRaw);

    return {
      ensName: normalized,
      capabilities,
      ownerAddress: owner,
      ...(repPtr ? { reputationPointer: repPtr } : {}),
    };
  }

  async setProfile(
    name: string,
    profile: Partial<AgentProfile>,
  ): Promise<void> {
    if (!this.walletClient || !this.account) {
      throw new Error("ENSViemResolver: setProfile requires a privateKey");
    }
    // viem doesn't ship an ENS-write helper directly; we call
    // PublicResolver.setText(node, key, value) directly. The caller must have
    // pointed the name's resolver at a PublicResolver via app.ens.domains.
    const normalized = normalize(name);
    const nameNode = namehash(normalized);
    const resolverAddress = (await this.publicClient.readContract({
      address: ENS_REGISTRY,
      abi: ENS_REGISTRY_ABI,
      functionName: "resolver",
      args: [nameNode],
    })) as Address;
    if (
      !resolverAddress ||
      resolverAddress === "0x0000000000000000000000000000000000000000"
    ) {
      throw new Error(
        `ENSViemResolver: no resolver set for ${normalized}; configure PublicResolver via app.ens.domains first`,
      );
    }

    const sendSetText = async (key: string, value: string): Promise<void> => {
      const txHash = await this.walletClient!.writeContract({
        chain: sepolia,
        account: this.account!,
        address: resolverAddress,
        abi: PUBLIC_RESOLVER_ABI,
        functionName: "setText",
        args: [nameNode, key, value],
      });
      // Wait for inclusion so subsequent reads observe the new state.
      const receipt = await this.publicClient.waitForTransactionReceipt({
        hash: txHash,
      });
      if (receipt.status !== "success") {
        throw new Error(
          `ENSViemResolver: setText(${key}) reverted (tx ${txHash})`,
        );
      }
    };

    if (profile.capabilities) {
      await sendSetText(
        this.capabilitiesKey,
        JSON.stringify(profile.capabilities),
      );
    }
    if (profile.reputationPointer !== undefined) {
      await sendSetText(this.reputationKey, profile.reputationPointer);
    }
  }
}

const parseCapabilities = (raw: string | null | undefined): string[] => {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return raw.split(",").map((s) => s.trim()).filter(Boolean);
  }
};

const ENS_REGISTRY = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e" as const;
const ENS_REGISTRY_ABI = [
  {
    inputs: [{ type: "bytes32", name: "node" }],
    name: "resolver",
    outputs: [{ type: "address" }],
    stateMutability: "view",
    type: "function",
  },
] as const;
const PUBLIC_RESOLVER_ABI = [
  {
    inputs: [
      { type: "bytes32", name: "node" },
      { type: "string", name: "key" },
      { type: "string", name: "value" },
    ],
    name: "setText",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

// Minimal namehash; viem exports keccak256 + utils. We avoid pulling another
// dep by computing locally.
import { keccak256, stringToBytes } from "viem";
const namehash = (name: string): Hex => {
  let node: Hex =
    "0x0000000000000000000000000000000000000000000000000000000000000000";
  if (name) {
    const labels = name.split(".").reverse();
    for (const label of labels) {
      const labelHash = keccak256(stringToBytes(label));
      node = keccak256(`0x${node.slice(2)}${labelHash.slice(2)}` as Hex);
    }
  }
  return node;
};
