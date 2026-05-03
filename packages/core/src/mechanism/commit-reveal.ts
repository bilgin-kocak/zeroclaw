import { createHash, randomBytes } from "node:crypto";
import type {
  ParticipantId,
  RoundConfig,
  RoundEvent,
  RoundState,
} from "./types.js";

type SubmitFn = (event: RoundEvent) => Promise<void>;

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

const defer = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

const median3 = (a: number, b: number, c: number): number => {
  const sorted = [a, b, c].sort((x, y) => x - y);
  // sort with strict NaN-free numeric inputs is fine here
  return sorted[1]!;
};

const mean2 = (a: number, b: number): number => (a + b) / 2;

export class CommitRevealRound<T extends number = number> {
  private state: RoundState = { phase: "idle" };
  private commits = new Map<ParticipantId, string>();
  private reveals = new Map<ParticipantId, { value: number; salt: string }>();
  private submit: SubmitFn | null = null;
  private deferred: Deferred<RoundState> | null = null;
  private commitTimer: NodeJS.Timeout | null = null;
  private revealTimer: NodeJS.Timeout | null = null;

  constructor(private cfg: RoundConfig<T>) {}

  /**
   * Salt suitable for use with commit(). 32 bytes hex.
   */
  static randomSalt(): string {
    return randomBytes(32).toString("hex");
  }

  /**
   * SHA-256 of `${value}|${salt}`. Spec §3.2.
   */
  static commit(value: number, salt: string): string {
    return createHash("sha256").update(`${value}|${salt}`).digest("hex");
  }

  /**
   * Quadratic loss: `-((value - resolution) / σ) ** 2`. Spec §3.2.
   */
  static score(
    value: number,
    resolution: number,
    normalization: number,
  ): number {
    const d = (value - resolution) / normalization;
    return d === 0 ? 0 : -(d * d);
  }

  peek(): RoundState {
    return this.state;
  }

  /**
   * Drive the state machine. Returns the terminal state once reached.
   */
  async run(submit: SubmitFn): Promise<RoundState> {
    if (this.deferred) {
      throw new Error("CommitRevealRound: run() may only be called once");
    }
    this.submit = submit;
    this.deferred = defer<RoundState>();
    this.state = { phase: "idle" };
    this.scheduleCommitTimeout();
    return this.deferred.promise;
  }

  ingestCommit(from: ParticipantId, hash: string): void {
    if (!this.deferred) {
      throw new Error("CommitRevealRound: call run() before ingestCommit()");
    }
    if (!this.isParticipant(from)) {
      throw new Error(`CommitRevealRound: ${from} is not a participant`);
    }
    if (this.state.phase !== "idle" && this.state.phase !== "committing") {
      throw new Error(
        `CommitRevealRound: cannot ingest commit in phase ${this.state.phase}`,
      );
    }
    if (this.commits.has(from)) {
      throw new Error(`CommitRevealRound: duplicate commit from ${from}`);
    }
    this.commits.set(from, hash);
    this.state = { phase: "committing", commits: new Map(this.commits) };
    this.emit({ type: "commit_received", participant: from, hash });
    if (this.commits.size === this.cfg.participants.length) {
      this.clearCommitTimeout();
      this.state = {
        phase: "revealing",
        commits: new Map(this.commits),
        reveals: new Map(this.reveals),
      };
      this.scheduleRevealTimeout();
    }
  }

  ingestReveal(from: ParticipantId, value: number, salt: string): void {
    if (!this.deferred) {
      throw new Error("CommitRevealRound: call run() before ingestReveal()");
    }
    if (!this.isParticipant(from)) {
      throw new Error(`CommitRevealRound: ${from} is not a participant`);
    }
    if (this.state.phase !== "revealing") {
      throw new Error(
        `CommitRevealRound: cannot ingest reveal in phase ${this.state.phase}`,
      );
    }
    const expected = this.commits.get(from);
    if (!expected) {
      throw new Error(`CommitRevealRound: no commit recorded for ${from}`);
    }
    const actual = CommitRevealRound.commit(value, salt);
    if (actual !== expected) {
      this.abort("invalid_reveal");
      return;
    }
    if (this.reveals.has(from)) {
      throw new Error(`CommitRevealRound: duplicate reveal from ${from}`);
    }
    this.reveals.set(from, { value, salt });
    this.state = {
      phase: "revealing",
      commits: new Map(this.commits),
      reveals: new Map(this.reveals),
    };
    this.emit({ type: "reveal_received", participant: from, value, salt });
    if (this.reveals.size === this.cfg.participants.length) {
      this.clearRevealTimeout();
      void this.resolve();
    }
  }

  // ---- internals ----

  private isParticipant(id: ParticipantId): boolean {
    return this.cfg.participants.includes(id);
  }

  private scheduleCommitTimeout(): void {
    this.commitTimer = setTimeout(() => {
      if (this.state.phase === "idle" || this.state.phase === "committing") {
        this.abort("timeout");
      }
    }, this.cfg.commitTimeoutMs);
  }

  private clearCommitTimeout(): void {
    if (this.commitTimer) {
      clearTimeout(this.commitTimer);
      this.commitTimer = null;
    }
  }

  private scheduleRevealTimeout(): void {
    this.revealTimer = setTimeout(() => {
      if (this.state.phase === "revealing") {
        this.abort("timeout");
      }
    }, this.cfg.revealTimeoutMs);
  }

  private clearRevealTimeout(): void {
    if (this.revealTimer) {
      clearTimeout(this.revealTimer);
      this.revealTimer = null;
    }
  }

  private abort(reason: "timeout" | "invalid_reveal"): void {
    this.clearCommitTimeout();
    this.clearRevealTimeout();
    this.state = { phase: "aborted", reason };
    this.emit({ type: "aborted", reason });
    this.deferred?.resolve(this.state);
  }

  private async resolve(): Promise<void> {
    try {
      const reveals = [...this.reveals.values()].map((r) => r.value);
      let resolution: number;
      if (this.cfg.anchor) {
        const anchorValue = await this.cfg.anchor();
        resolution = median3(reveals[0]!, reveals[1]!, anchorValue);
      } else {
        resolution = mean2(reveals[0]!, reveals[1]!);
      }
      const scores = new Map<ParticipantId, number>();
      for (const [pid, { value }] of this.reveals.entries()) {
        scores.set(
          pid,
          CommitRevealRound.score(value, resolution, this.cfg.normalization),
        );
      }
      this.state = { phase: "resolved", resolution, scores: new Map(scores) };
      this.emit({ type: "resolved", resolution, scores: new Map(scores) });
      this.deferred?.resolve(this.state);
    } catch {
      // Anchor failure: per the RoundState contract we only have two abort
      // reasons; map oracle failure to "timeout" since semantically the round
      // could not settle in the available window.
      this.abort("timeout");
    }
  }

  private emit(event: RoundEvent): void {
    if (this.submit) {
      void this.submit(event);
    }
  }
}
