/**
 * One-time ledger bootstrap for 0G Compute. Run this once after funding the
 * wallet from the 0G faucet, then `pnpm test:e2e` and `pnpm demo:testnet`
 * will work without "Sub-account not found" errors.
 *
 *   pnpm zerog:fund [ledgerBalance] [perProviderAmount]
 */

import dotenvFlow from "dotenv-flow";
import { ethers } from "ethers";

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
  const sdk = await import("@0gfoundation/0g-compute-ts-sdk");
  const provider = new ethers.JsonRpcProvider(required("ZEROG_RPC_URL"));
  const wallet = new ethers.Wallet(required("ZEROG_PRIVATE_KEY"), provider);
  const balance = await provider.getBalance(wallet.address);
  console.log(
    `wallet ${wallet.address} balance: ${ethers.formatEther(balance)} OG`,
  );

  const broker = await sdk.createZGComputeNetworkBroker(wallet);

  // 0G enforces a minimum ledger balance of 3 OG.
  const ledgerInit = Number(process.argv[2] ?? "3");
  const perProvider = BigInt(
    Math.floor(Number(process.argv[3] ?? "0.5") * 1e18),
  );
  if (Number(ethers.formatEther(balance)) < ledgerInit + 0.01) {
    console.error(
      `\n✗ Insufficient balance. Need ≥${ledgerInit + 0.01} OG to fund the ledger; have ${ethers.formatEther(balance)}.`,
    );
    console.error(
      "  → Hit https://faucet.0g.ai multiple times (default drip is ~0.1 OG)",
    );
    console.error(
      "  → Or request more in the 0G Discord faucet channel.\n",
    );
    process.exit(2);
  }

  console.log(`ensuring ledger (initial balance ${ledgerInit} OG)…`);
  try {
    const led = await broker.ledger.getLedger();
    console.log(`  ledger exists: balance=${led.totalBalance ?? led.balance}`);
  } catch {
    console.log(`  no ledger; calling addLedger(${ledgerInit})…`);
    await broker.ledger.addLedger(ledgerInit);
    console.log(`  ✓ ledger created`);
  }

  const services = await broker.inference.listService();
  console.log(`provider catalog has ${services.length} services`);

  const targetModels = [
    process.env.ZEROG_PROPOSER_MODEL,
    process.env.ZEROG_CRITIC_MODEL,
  ].filter((m): m is string => Boolean(m));
  if (targetModels.length === 0) {
    console.log(
      "no ZEROG_PROPOSER_MODEL or ZEROG_CRITIC_MODEL set; using first chatbot service",
    );
    const fallback = services.find(
      (s: { serviceType?: string }) => s.serviceType === "chatbot",
    );
    if (fallback) targetModels.push(fallback.model);
  }

  const seenProviders = new Set<string>();
  for (const model of targetModels) {
    const svc = services.find((s: { model: string }) => s.model === model);
    if (!svc) {
      console.log(`  ✗ no provider for model "${model}" — skipping`);
      continue;
    }
    if (seenProviders.has(svc.provider)) continue;
    seenProviders.add(svc.provider);
    console.log(
      `  funding sub-account for provider ${svc.provider} (model ${model}, +${ethers.formatEther(perProvider)} OG)…`,
    );
    await broker.ledger.transferFund(svc.provider, "inference", perProvider);
    console.log(`  ✓ provider funded`);
  }

  console.log("done. you can now run RUN_ZEROG_TESTS=1 pnpm test.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
