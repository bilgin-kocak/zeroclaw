import { describe, expect, it } from "vitest";
import { ZeroGStorageBackend } from "../../src/memory/backends/zerog-storage.js";

const enabled = process.env.RUN_ZEROG_TESTS === "1";

const buildBackend = (): ZeroGStorageBackend =>
  new ZeroGStorageBackend({
    rpcUrl: process.env.ZEROG_RPC_URL!,
    privateKey: process.env.ZEROG_PRIVATE_KEY!,
    indexerRpc: process.env.ZEROG_STORAGE_INDEXER!,
    ...(process.env.ZEROG_FLOW_CONTRACT
      ? { flowContract: process.env.ZEROG_FLOW_CONTRACT }
      : {}),
  });

describe.skipIf(!enabled)("0G Storage e2e (RUN_ZEROG_TESTS=1)", () => {
  it(
    "set + get roundtrip via Indexer blob upload",
    async () => {
      const backend = buildBackend();
      const key = `test/${Date.now()}`;
      const value = { hello: "0g", n: 42 };
      await backend.set(key, value);
      const got = await backend.get(key);
      expect(got).toEqual(value);
    },
    180_000,
  );

  it(
    "append + read roundtrip on a stream",
    async () => {
      const backend = buildBackend();
      const stream = `s/${Date.now()}`;
      await backend.append(stream, { i: 1 });
      await backend.append(stream, { i: 2 });
      const log = await backend.read(stream);
      expect(log).toContainEqual({ i: 1 });
      expect(log).toContainEqual({ i: 2 });
      const tip = backend.latestRootForStream(stream);
      expect(tip).toMatch(/^0x[0-9a-fA-F]{64}$/);
    },
    300_000,
  );
});
