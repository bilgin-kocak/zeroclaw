import { Role } from "./base.js";

export interface ActionDescriptor {
  kind: "swap" | "transfer" | "call";
  params: Record<string, unknown>;
}

export interface Plan {
  intent: string;
  action: ActionDescriptor;
  parameters: Record<string, number>;
  rationale: string;
}

export abstract class Proposer extends Role {
  readonly kind = "proposer" as const;
  abstract propose(intent: string): Promise<Plan>;
}
