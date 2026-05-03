import { CommitRevealRound } from "./mechanism/commit-reveal.js";
import type {
  ParticipantId,
  RoundEvent,
} from "./mechanism/types.js";
import type { Plan } from "./roles/proposer.js";
import type { Proposer } from "./roles/proposer.js";
import type { Critic, Critique } from "./roles/critic.js";
import type {
  ExecutionBackend,
  ExecutionReceipt,
} from "./execution/backend.js";
import type { Memory } from "./memory/memory.js";

export interface ConstitutionConfig {
  proposer: Proposer;
  critic: Critic;
  execution: ExecutionBackend;
  memory: Memory;
  mechanism: {
    normalization: number;
    commitTimeoutMs: number;
    revealTimeoutMs: number;
  };
  /** Numeric parameters in a Plan that are subject to commit-reveal. */
  contestable: string[];
  /**
   * Optional: build an anchor function for a given parameter (e.g. live
   * Uniswap quote midpoint for the slippage parameter).
   */
  anchorFor?: (parameter: string, plan: Plan) => () => Promise<number>;
  /** Hooks for UI streaming. */
  onEvent?: (event: ConstitutionEvent) => void;
}

export type ConstitutionEvent =
  | { type: "proposed"; plan: Plan }
  | { type: "critiqued"; critique: Critique }
  | { type: "round_event"; parameter: string; event: RoundEvent }
  | { type: "round_resolved"; parameter: string; resolution: number }
  | { type: "executed"; receipt: ExecutionReceipt }
  | { type: "aborted"; reason: string };

export interface DeliberationRound {
  parameter: string;
  resolution: number;
  scores: Map<ParticipantId, number>;
}

export interface DeliberationResult {
  finalPlan: Plan;
  rounds: DeliberationRound[];
  receipt?: ExecutionReceipt;
  aborted?: { reason: string };
}

export class Constitution {
  constructor(private cfg: ConstitutionConfig) {}

  async deliberate(intent: string): Promise<DeliberationResult> {
    const transcript: unknown[] = [];

    let plan = await this.cfg.proposer.propose(intent);
    transcript.push({ stage: "propose", plan });
    this.cfg.onEvent?.({ type: "proposed", plan });

    let critique = await this.cfg.critic.critique(plan);
    transcript.push({ stage: "critique-1", critique });
    this.cfg.onEvent?.({ type: "critiqued", critique });

    // 'revise' loops back to the proposer once with the critique attached.
    if (critique.verdict === "revise") {
      const reviseIntent = `${intent}\n\n[critique]\n${critique.concerns.join("\n")}`;
      plan = await this.cfg.proposer.propose(reviseIntent);
      transcript.push({ stage: "propose-2", plan });
      this.cfg.onEvent?.({ type: "proposed", plan });
      critique = await this.cfg.critic.critique(plan);
      transcript.push({ stage: "critique-2", critique });
      this.cfg.onEvent?.({ type: "critiqued", critique });
    }

    if (critique.verdict === "reject") {
      const result: DeliberationResult = {
        finalPlan: plan,
        rounds: [],
        aborted: { reason: "critic_rejected" },
      };
      this.cfg.onEvent?.({ type: "aborted", reason: "critic_rejected" });
      await this.persist(transcript, result);
      return result;
    }

    const rounds: DeliberationRound[] = [];

    if (critique.verdict !== "accept") {
      // Run a commit-reveal round per contested parameter where the two
      // sides actually disagree (epsilon equality).
      for (const parameter of this.cfg.contestable) {
        const proposerValue = plan.parameters[parameter];
        const criticValue = critique.counterParameters[parameter];
        if (proposerValue === undefined || criticValue === undefined) continue;
        if (Math.abs(proposerValue - criticValue) < 1e-12) continue;

        const proposerId = this.cfg.proposer.id;
        const criticId = this.cfg.critic.id;
        const round = new CommitRevealRound({
          participants: [proposerId, criticId],
          commitTimeoutMs: this.cfg.mechanism.commitTimeoutMs,
          revealTimeoutMs: this.cfg.mechanism.revealTimeoutMs,
          normalization: this.cfg.mechanism.normalization,
          ...(this.cfg.anchorFor
            ? { anchor: this.cfg.anchorFor(parameter, plan) }
            : {}),
        });

        const promise = round.run(async (event) => {
          this.cfg.onEvent?.({ type: "round_event", parameter, event });
        });

        const proposerSalt = CommitRevealRound.randomSalt();
        const criticSalt = CommitRevealRound.randomSalt();

        round.ingestCommit(
          proposerId,
          CommitRevealRound.commit(proposerValue, proposerSalt),
        );
        round.ingestCommit(
          criticId,
          CommitRevealRound.commit(criticValue, criticSalt),
        );

        // Yield once so the state machine sees both commits before reveals.
        await Promise.resolve();
        round.ingestReveal(proposerId, proposerValue, proposerSalt);
        round.ingestReveal(criticId, criticValue, criticSalt);

        const final = await promise;
        if (final.phase === "aborted") {
          const result: DeliberationResult = {
            finalPlan: plan,
            rounds,
            aborted: { reason: `round_aborted:${final.reason}` },
          };
          this.cfg.onEvent?.({
            type: "aborted",
            reason: `round_aborted:${final.reason}`,
          });
          transcript.push({ stage: "round-aborted", parameter, final });
          await this.persist(transcript, result);
          return result;
        }
        if (final.phase !== "resolved") {
          // Defensive: a round must terminate either resolved or aborted.
          continue;
        }
        rounds.push({
          parameter,
          resolution: final.resolution,
          scores: final.scores,
        });
        this.cfg.onEvent?.({
          type: "round_resolved",
          parameter,
          resolution: final.resolution,
        });
        transcript.push({
          stage: "round-resolved",
          parameter,
          resolution: final.resolution,
        });
        // Apply the mechanism resolution back to the plan.
        plan = {
          ...plan,
          parameters: { ...plan.parameters, [parameter]: final.resolution },
        };
      }
    }

    // Execute.
    const receipt = await this.cfg.execution.execute({
      kind: plan.action.kind,
      params: plan.action.params,
      constraints: plan.parameters,
      nonce: `${this.cfg.proposer.id}:${this.cfg.critic.id}:${Date.now()}`,
    });
    this.cfg.onEvent?.({ type: "executed", receipt });
    transcript.push({ stage: "executed", receipt });

    const result: DeliberationResult = { finalPlan: plan, rounds, receipt };
    await this.persist(transcript, result);
    return result;
  }

  private async persist(
    transcript: unknown[],
    result: DeliberationResult,
  ): Promise<void> {
    await this.cfg.memory.log("deliberations", {
      transcript,
      finalPlan: result.finalPlan,
      rounds: result.rounds.map((r) => ({
        parameter: r.parameter,
        resolution: r.resolution,
        scores: Object.fromEntries(r.scores),
      })),
      ...(result.receipt ? { receipt: result.receipt } : {}),
      ...(result.aborted ? { aborted: result.aborted } : {}),
    });
  }
}
