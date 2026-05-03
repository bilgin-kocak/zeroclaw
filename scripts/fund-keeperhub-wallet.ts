/**
 * Fund the KeeperHub-managed wallet from the deployer wallet so KeeperHub
 * can pay gas when executing transactions on your behalf.
 *
 *   pnpm fund:keeperhub-wallet [chain=sepolia] [amountEth=0.02]
 *
 * For Unichain Sepolia, both wallets need faucet drips first since the
 * deployer is unlikely to have Unichain Sepolia ETH from a Sepolia-only
 * faucet run.
 */

import dotenvFlow from "dotenv-flow";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  type Hex,
} from "viem";
import { sepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

dotenvFlow.config();

const required = (k: string): string => {
  const v = process.env[k];
  if (!v) {
    console.error(`✗ ${k} not set in .env.local`);
    process.exit(1);
  }
  return v;
};

const KH_WALLET = "0xFd565A6c2a99Cd68c4ef224Fe24cCc758C6eEA4c" as const;

const CHAINS = {
  sepolia: { id: 11155111, viemChain: sepolia, rpcEnv: "SEPOLIA_RPC_URL" },
  "unichain-sepolia": {
    id: 1301,
    // Build a minimal chain object inline; viem doesn't ship Unichain Sepolia
    // out of the box for older versions.
    viemChain: {
      id: 1301,
      name: "Unichain Sepolia",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: {
        default: { http: ["https://sepolia.unichain.org"] },
        public: { http: ["https://sepolia.unichain.org"] },
      },
    } as const,
    rpcEnv: "UNICHAIN_SEPOLIA_RPC_URL",
  },
} as const;

async function main(): Promise<void> {
  const chainKey = (process.argv[2] ?? "sepolia") as keyof typeof CHAINS;
  const amountEth = process.argv[3] ?? "0.02";
  const conf = CHAINS[chainKey];
  if (!conf) {
    console.error(
      `unknown chain '${chainKey}'. options: ${Object.keys(CHAINS).join(", ")}`,
    );
    process.exit(1);
  }
  const rpcUrl = required(conf.rpcEnv);
  const privateKey = required("DEPLOYER_PRIVATE_KEY") as Hex;
  const account = privateKeyToAccount(privateKey);
  const publicClient = createPublicClient({
    chain: conf.viemChain,
    transport: http(rpcUrl),
  });
  const walletClient = createWalletClient({
    chain: conf.viemChain,
    account,
    transport: http(rpcUrl),
  });

  const deployerBal = await publicClient.getBalance({ address: account.address });
  const khBal = await publicClient.getBalance({ address: KH_WALLET });
  console.log(`chain: ${chainKey} (${conf.id})`);
  console.log(`  deployer ${account.address} = ${Number(deployerBal) / 1e18} ETH`);
  console.log(`  keeperhub ${KH_WALLET} = ${Number(khBal) / 1e18} ETH`);

  const amount = parseEther(amountEth);
  if (deployerBal < amount * 2n) {
    console.error(
      `\n✗ deployer balance too low to send ${amountEth} ETH safely.`,
    );
    console.error(
      `  → faucet ${conf.id === 11155111 ? "https://www.alchemy.com/faucets/ethereum-sepolia" : "https://faucet.unichain.org"} to ${account.address} first`,
    );
    process.exit(2);
  }

  console.log(`\n→ sending ${amountEth} ETH to ${KH_WALLET}…`);
  const txHash = await walletClient.sendTransaction({
    chain: conf.viemChain,
    account,
    to: KH_WALLET,
    value: amount,
  });
  console.log(`  tx ${txHash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  console.log(`  ✓ mined in block ${receipt.blockNumber}`);
  const newKh = await publicClient.getBalance({ address: KH_WALLET });
  console.log(`  keeperhub balance now: ${Number(newKh) / 1e18} ETH`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
