/**
 * Print the live 0G Compute inference catalog so you can pick two distinct
 * models for `ZEROG_PROPOSER_MODEL` and `ZEROG_CRITIC_MODEL`.
 *
 *   pnpm zerog:list
 */

import dotenvFlow from "dotenv-flow";
import { ZeroGComputeBackend } from "@zeroclaw/core";

dotenvFlow.config();

const required = (k: string): string => {
  const v = process.env[k];
  if (!v) {
    console.error(`✗ ${k} not set in .env.local`);
    process.exit(1);
  }
  return v;
};

async function main(): Promise<void> {
  const backend = new ZeroGComputeBackend({
    rpcUrl: required("ZEROG_RPC_URL"),
    privateKey: required("ZEROG_PRIVATE_KEY"),
  });
  const services = await backend.listServices();
  if (services.length === 0) {
    console.log("Empty catalog — try again in a few minutes.");
    return;
  }
  console.log(`Found ${services.length} services:\n`);
  for (const s of services) {
    const fields = [
      `model=${s.model}`,
      `provider=${s.provider}`,
      s.serviceType ? `type=${s.serviceType}` : null,
      s.verifiability ? `verif=${s.verifiability}` : null,
    ].filter(Boolean);
    console.log("  - " + fields.join("  "));
  }
  console.log("\nPick two distinct models. Example:");
  const a = services[0]?.model;
  const b = services.find((s) => s.model !== a)?.model ?? services[0]?.model;
  console.log(`  ZEROG_PROPOSER_MODEL=${a}`);
  console.log(`  ZEROG_CRITIC_MODEL=${b}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
