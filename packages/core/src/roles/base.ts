import type { InferenceBackend } from "../inference/backend.js";
import type { Memory } from "../memory/memory.js";
import type { RoleId, TransportBackend } from "../transport/backend.js";

export type { RoleId };

export interface RoleContext {
  id: RoleId;
  memory: Memory;
  inference: InferenceBackend;
  transport: TransportBackend;
}

export abstract class Role {
  constructor(protected ctx: RoleContext) {}
  abstract readonly kind: "proposer" | "critic";
  get id(): RoleId {
    return this.ctx.id;
  }
}
