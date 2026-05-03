import { describe, expect, it } from "vitest";
import { ZeroGComputeBackend } from "../../src/inference/backends/zerog-compute.js";

const enabled = process.env.RUN_ZEROG_TESTS === "1";

const buildBackend = (): ZeroGComputeBackend =>
  new ZeroGComputeBackend({
    rpcUrl: process.env.ZEROG_RPC_URL!,
    privateKey: process.env.ZEROG_PRIVATE_KEY!,
  });

describe.skipIf(!enabled)("0G Compute e2e (RUN_ZEROG_TESTS=1)", () => {
  it(
    "lists at least one inference service",
    async () => {
      const backend = buildBackend();
      const services = await backend.listServices();
      expect(services.length).toBeGreaterThan(0);
      console.log(
        "0G inference catalog:",
        services.map((s) => `${s.model} <- ${s.provider}`),
      );
    },
    60_000,
  );

  it(
    "complete() returns content for a model from the catalog",
    async () => {
      const backend = buildBackend();
      const services = await backend.listServices();
      const chosen = process.env.ZEROG_PROPOSER_MODEL ?? services[0]?.model;
      if (!chosen) throw new Error("no model available");
      const r = await backend.complete({
        model: chosen,
        messages: [{ role: "user", content: "Say 'ok'." }],
      });
      expect(r.content.length).toBeGreaterThan(0);
    },
    60_000,
  );
});
