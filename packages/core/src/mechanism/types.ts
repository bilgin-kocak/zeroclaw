export type ParticipantId = string;

export interface RoundConfig<T extends number = number> {
  participants: [ParticipantId, ParticipantId];
  anchor?: () => Promise<T>;
  commitTimeoutMs: number;
  revealTimeoutMs: number;
  normalization: number;
}

export type RoundEvent =
  | { type: "commit_received"; participant: ParticipantId; hash: string }
  | {
      type: "reveal_received";
      participant: ParticipantId;
      value: number;
      salt: string;
    }
  | {
      type: "resolved";
      resolution: number;
      scores: Map<ParticipantId, number>;
    }
  | { type: "aborted"; reason: "timeout" | "invalid_reveal" };

export type RoundState =
  | { phase: "idle" }
  | { phase: "committing"; commits: Map<ParticipantId, string> }
  | {
      phase: "revealing";
      commits: Map<ParticipantId, string>;
      reveals: Map<ParticipantId, { value: number; salt: string }>;
    }
  | {
      phase: "resolved";
      resolution: number;
      scores: Map<ParticipantId, number>;
    }
  | { phase: "aborted"; reason: "timeout" | "invalid_reveal" };
