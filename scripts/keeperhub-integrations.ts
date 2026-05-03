/**
 * Probe KeeperHub for existing wallet integrations and print their IDs so
 * you can paste one into .env.local as KEEPERHUB_WALLET_INTEGRATION_ID.
 *
 *   pnpm keeperhub:integrations
 *
 * If no wallet integration exists yet:
 *   - Open https://app.keeperhub.com
 *   - Integrations → Add → Wallet → connect a wallet on the chain you want
 *     (Unichain Sepolia, chainId 1301)
 *   - Re-run this script to confirm the ID
 */

import dotenvFlow from "dotenv-flow";
import { KeeperHubExecutionBackend } from "@zeroclaw/core";

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
  const k = new KeeperHubExecutionBackend({
    apiKey: required("KEEPERHUB_API_KEY"),
    mcpUrl: required("KEEPERHUB_MCP_URL"),
  });

  console.log("Listing all integrations…");
  const all = await k.callTool("list_integrations", {});
  printAsList(all, "all integrations");

  console.log("\nWallet-only integrations…");
  // Some KeeperHub installations support a filter; fall back to client-side
  // filtering if the server returns the full list.
  const walletsOnly = await k.callTool("list_integrations", {
    type: "wallet",
  });
  printAsList(walletsOnly, "wallet integrations");

  // Surface a recommendation. The MCP wraps results in content[0].text JSON.
  const items = extractItems(walletsOnly) ?? extractItems(all) ?? [];
  const wallets = items.filter((i: Record<string, unknown>) => {
    const type = String(i.type ?? "").toLowerCase();
    return (
      type.includes("wallet") ||
      type === "web3" ||
      type === "evm" ||
      Boolean(i.address) ||
      String(i.name ?? "").startsWith("0x")
    );
  });
  if (wallets.length === 0) {
    console.log("\nNo wallet integrations found.");
    console.log(
      "→ Open https://app.keeperhub.com → Integrations → Add → Wallet,",
    );
    console.log(
      "  connect a wallet on Unichain Sepolia (chainId 1301), then re-run this.",
    );
    return;
  }
  console.log("\nRecommended .env.local entries:");
  for (const w of wallets.slice(0, 3)) {
    const id = w.id ?? w.integrationId ?? w.uuid;
    console.log(`  KEEPERHUB_WALLET_INTEGRATION_ID=${id}    # ${describe(w)}`);
  }
}

const printAsList = (result: unknown, label: string): void => {
  const items = extractItems(result);
  if (!items) {
    console.log(`(${label}: unparseable)\n`, JSON.stringify(result, null, 2).slice(0, 400));
    return;
  }
  console.log(`(${label}: ${items.length} item(s))`);
  for (const it of items.slice(0, 20)) {
    console.log("  -", describe(it));
  }
};

const extractItems = (
  result: unknown,
): Record<string, unknown>[] | null => {
  const r = result as { content?: { text?: string }[] } | undefined;
  if (r?.content?.[0]?.text) {
    try {
      const parsed = JSON.parse(r.content[0].text);
      if (Array.isArray(parsed)) return parsed;
      if (Array.isArray((parsed as { integrations?: unknown[] }).integrations))
        return (parsed as { integrations: Record<string, unknown>[] })
          .integrations;
      if (Array.isArray((parsed as { items?: unknown[] }).items))
        return (parsed as { items: Record<string, unknown>[] }).items;
    } catch {
      return null;
    }
  }
  return null;
};

const describe = (item: Record<string, unknown>): string => {
  const id = item.id ?? item.integrationId ?? item.uuid;
  const name = item.name ?? item.label;
  const type = item.type ?? item.kind;
  const chain = item.chainId ?? item.chain;
  const addr = item.address;
  return [id && `id=${id}`, name && `name=${name}`, type && `type=${type}`,
    chain && `chain=${chain}`, addr && `addr=${addr}`]
    .filter(Boolean).join("  ");
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
