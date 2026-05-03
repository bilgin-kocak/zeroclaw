export interface AgentProfile {
  ensName: string;
  axlPublicKey?: string;
  capabilities: string[];
  reputationPointer?: string;
  ownerAddress: string;
}

export interface ENSResolver {
  resolveProfile(name: string): Promise<AgentProfile | null>;
  setProfile(name: string, profile: Partial<AgentProfile>): Promise<void>;
}
