import { describe, expect, it } from "vitest";
import { ENSViemResolver } from "../../src/identity/ens-viem.js";

const enabled = process.env.RUN_ENS_TESTS === "1";

const buildResolver = (): ENSViemResolver =>
  new ENSViemResolver({
    rpcUrl: process.env.SEPOLIA_RPC_URL!,
    privateKey: process.env.DEPLOYER_PRIVATE_KEY as `0x${string}` | undefined,
  });

describe.skipIf(!enabled)("ENS viem resolver e2e (RUN_ENS_TESTS=1)", () => {
  it(
    "resolveProfile returns null for an unknown name",
    async () => {
      const r = buildResolver();
      const profile = await r.resolveProfile(`nope-${Date.now()}.eth`);
      expect(profile).toBeNull();
    },
    30_000,
  );

  it(
    "capability roundtrip on the configured ENS name",
    async () => {
      const r = buildResolver();
      const name = process.env.ENS_NAME!;
      const caps = ["test:roundtrip", `ts:${Date.now()}`];
      await r.setProfile(name, { capabilities: caps });
      const got = await r.resolveProfile(name);
      expect(got?.capabilities).toEqual(caps);
    },
    120_000,
  );

  it(
    "capability roundtrip on the proposer subname",
    async () => {
      const r = buildResolver();
      const name = process.env.ENS_PROPOSER_SUBNAME!;
      const caps = ["propose:swap", `ts:${Date.now()}`];
      await r.setProfile(name, {
        capabilities: caps,
        reputationPointer: `0x${"a".repeat(64)}`,
      });
      const got = await r.resolveProfile(name);
      expect(got?.capabilities).toEqual(caps);
      expect(got?.reputationPointer).toBe(`0x${"a".repeat(64)}`);
    },
    180_000,
  );
});
