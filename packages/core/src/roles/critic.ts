import { Role } from "./base.js";
import type { Plan } from "./proposer.js";

export interface Critique {
  verdict: "accept" | "reject" | "revise";
  concerns: string[];
  counterParameters: Record<string, number>;
  rationale: string;
}

export abstract class Critic extends Role {
  readonly kind = "critic" as const;
  abstract critique(plan: Plan): Promise<Critique>;
}
