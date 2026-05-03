import { describe, expect, it } from "vitest";
import { Constitution } from "../../src/constitution.js";
import type { ConstitutionEvent } from "../../src/constitution.js";
import { Proposer } from "../../src/roles/proposer.js";
import type { Plan } from "../../src/roles/proposer.js";
import { Critic } from "../../src/roles/critic.js";
import type { Critique } from "../../src/roles/critic.js";
import type { RoleContext } from "../../src/roles/base.js";
import { Memory } from "../../src/memory/memory.js";
import { InMemoryBackend } from "../../src/memory/backends/in-memory.js";
import { MockInferenceBackend } from "../../src/inference/backends/mock.js";
import { MockExecutionBackend } from "../../src/execution/backends/mock.js";
import {
  EventBus,
  InProcessTransportBackend,
} from "../../src/transport/backends/in-process.js";

class StubProposer extends Proposer {
  public propositions = 0;
  constructor(
    ctx: RoleContext,
    private impl: (intent: string, n: number) => Plan,
  ) {
    super(ctx);
  }
  async propose(intent: string): Promise<Plan> {
    this.propositions += 1;
    return this.impl(intent, this.propositions);
  }
}

class StubCritic extends Critic {
  public reviews = 0;
  constructor(
    ctx: RoleContext,
    private impl: (plan: Plan, n: number) => Critique,
  ) {
    super(ctx);
  }
  async critique(plan: Plan): Promise<Critique> {
    this.reviews += 1;
    return this.impl(plan, this.reviews);
  }
}

const makeRoles = (
  proposerImpl: (intent: string, n: number) => Plan,
  criticImpl: (plan: Plan, n: number) => Critique,
) => {
  const bus = new EventBus();
  const memBackend = new InMemoryBackend();
  const proposerCtx: RoleContext = {
    id: "proposer.test.eth",
    memory: new Memory(memBackend, "proposer"),
    inference: new MockInferenceBackend(),
    transport: new InProcessTransportBackend(bus, "proposer.test.eth"),
  };
  const criticCtx: RoleContext = {
    id: "critic.test.eth",
    memory: new Memory(memBackend, "critic"),
    inference: new MockInferenceBackend(),
    transport: new InProcessTransportBackend(bus, "critic.test.eth"),
  };
  return {
    proposer: new StubProposer(proposerCtx, proposerImpl),
    critic: new StubCritic(criticCtx, criticImpl),
    sharedMemory: new Memory(memBackend, "constitution"),
    bus,
  };
};

const baseMechanism = {
  normalization: 1,
  commitTimeoutMs: 1_000,
  revealTimeoutMs: 1_000,
};

const examplePlan = (parameters: Record<string, number> = {}): Plan => ({
  intent: "swap 5 ETH to USDC",
  action: { kind: "swap", params: { tokenIn: "ETH", tokenOut: "USDC" } },
  parameters: { expectedSlippage: 50, deadlineSeconds: 600, ...parameters },
  rationale: "stub",
});

describe("Constitution.deliberate", () => {
  it("1. with full agreement, skips the mechanism entirely", async () => {
    const { proposer, critic, sharedMemory } = makeRoles(
      () => examplePlan(),
      () => ({
        verdict: "accept",
        concerns: [],
        counterParameters: {},
        rationale: "lgtm",
      }),
    );
    const exec = new MockExecutionBackend();
    const c = new Constitution({
      proposer,
      critic,
      execution: exec,
      memory: sharedMemory,
      mechanism: baseMechanism,
      contestable: ["expectedSlippage"],
    });
    const result = await c.deliberate("swap 5 ETH to USDC");
    expect(result.rounds).toHaveLength(0);
    expect(result.receipt).toBeDefined();
    expect(exec.calls).toHaveLength(1);
  });

  it("2. with disagreement, runs one round per contested parameter that differs", async () => {
    const { proposer, critic, sharedMemory } = makeRoles(
      () => examplePlan({ expectedSlippage: 50, deadlineSeconds: 600 }),
      () => ({
        verdict: "revise",
        concerns: ["slippage too tight, deadline too long"],
        counterParameters: { expectedSlippage: 80, deadlineSeconds: 600 },
        rationale: "be safer",
      }),
    );
    const exec = new MockExecutionBackend();
    const c = new Constitution({
      proposer,
      critic,
      execution: exec,
      memory: sharedMemory,
      mechanism: baseMechanism,
      contestable: ["expectedSlippage", "deadlineSeconds"],
    });
    const result = await c.deliberate("swap 5 ETH to USDC");
    // Only expectedSlippage actually differs (50 vs 80).
    // 'revise' triggers a second propose/critique loop, which returns the same
    // values, so still one differing param.
    expect(result.rounds.map((r) => r.parameter)).toEqual([
      "expectedSlippage",
    ]);
  });

  it("3. with verdict 'reject', aborts before execution", async () => {
    const { proposer, critic, sharedMemory } = makeRoles(
      () => examplePlan(),
      () => ({
        verdict: "reject",
        concerns: ["unsafe"],
        counterParameters: {},
        rationale: "no",
      }),
    );
    const exec = new MockExecutionBackend();
    const c = new Constitution({
      proposer,
      critic,
      execution: exec,
      memory: sharedMemory,
      mechanism: baseMechanism,
      contestable: ["expectedSlippage"],
    });
    const result = await c.deliberate("swap 5 ETH to USDC");
    expect(result.aborted?.reason).toBe("critic_rejected");
    expect(result.receipt).toBeUndefined();
    expect(exec.calls).toHaveLength(0);
  });

  it("4. with verdict 'revise', loops back to proposer once with critique attached", async () => {
    const seenIntents: string[] = [];
    const { proposer, critic, sharedMemory } = makeRoles(
      (intent) => {
        seenIntents.push(intent);
        return examplePlan();
      },
      (_plan, n): Critique =>
        n === 1
          ? {
              verdict: "revise",
              concerns: ["adjust slippage"],
              counterParameters: { expectedSlippage: 80 },
              rationale: "tweak",
            }
          : {
              verdict: "accept",
              concerns: [],
              counterParameters: {},
              rationale: "ok",
            },
    );
    const c = new Constitution({
      proposer,
      critic,
      execution: new MockExecutionBackend(),
      memory: sharedMemory,
      mechanism: baseMechanism,
      contestable: [],
    });
    await c.deliberate("swap 5 ETH to USDC");
    expect(proposer.propositions).toBe(2);
    expect(critic.reviews).toBe(2);
    expect(seenIntents[1]).toContain("adjust slippage");
  });

  it("5. persists the full deliberation transcript to memory", async () => {
    const { proposer, critic, sharedMemory } = makeRoles(
      () => examplePlan(),
      () => ({
        verdict: "accept",
        concerns: [],
        counterParameters: {},
        rationale: "ok",
      }),
    );
    const c = new Constitution({
      proposer,
      critic,
      execution: new MockExecutionBackend(),
      memory: sharedMemory,
      mechanism: baseMechanism,
      contestable: [],
    });
    await c.deliberate("swap 5 ETH to USDC");
    const history = await sharedMemory.history<{ transcript: unknown[] }>(
      "deliberations",
    );
    expect(history).toHaveLength(1);
    expect(history[0]?.transcript).toBeDefined();
    expect(Array.isArray(history[0]?.transcript)).toBe(true);
  });

  it("6. returns the final plan with mechanism-resolved parameters", async () => {
    const { proposer, critic, sharedMemory } = makeRoles(
      () => examplePlan({ expectedSlippage: 50 }),
      () => ({
        verdict: "revise",
        concerns: ["raise slippage"],
        counterParameters: { expectedSlippage: 100 },
        rationale: "buffer",
      }),
    );
    const c = new Constitution({
      proposer,
      critic,
      execution: new MockExecutionBackend(),
      memory: sharedMemory,
      mechanism: baseMechanism,
      contestable: ["expectedSlippage"],
      // Anchor returns 90; median(50, 100, 90) = 90.
      anchorFor: () => async () => 90,
    });
    const result = await c.deliberate("swap 5 ETH to USDC");
    expect(result.finalPlan.parameters.expectedSlippage).toBe(90);
  });

  it("7. does not call execution if a round aborts", async () => {
    const { proposer, critic, sharedMemory } = makeRoles(
      () => examplePlan({ expectedSlippage: 50 }),
      () => ({
        verdict: "revise",
        concerns: ["raise slippage"],
        counterParameters: { expectedSlippage: 100 },
        rationale: "buffer",
      }),
    );
    const exec = new MockExecutionBackend();
    const events: ConstitutionEvent[] = [];
    const c = new Constitution({
      proposer,
      critic,
      execution: exec,
      memory: sharedMemory,
      mechanism: { ...baseMechanism, commitTimeoutMs: 5 },
      contestable: ["expectedSlippage"],
      // Anchor that throws -> round aborts.
      anchorFor: () => async () => {
        throw new Error("oracle down");
      },
      onEvent: (e) => events.push(e),
    });
    const result = await c.deliberate("swap 5 ETH to USDC");
    expect(result.aborted?.reason).toMatch(/round_aborted/);
    expect(result.receipt).toBeUndefined();
    expect(exec.calls).toHaveLength(0);
  });
});
