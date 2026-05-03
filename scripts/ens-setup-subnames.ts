/**
 * Create proposer.<ENS_NAME> and critic.<ENS_NAME> subnames on Sepolia
 * (or whichever name is in ENS_NAME) and point their resolver at the same
 * PublicResolver as the parent.
 *
 *   pnpm ens:subnames
 */

import dotenvFlow from "dotenv-flow";
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  stringToBytes,
  type Address,
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

const ENS_REGISTRY = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e" as const;

const ENS_REGISTRY_ABI = [
  {
    inputs: [{ type: "bytes32", name: "node" }],
    name: "resolver",
    outputs: [{ type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ type: "bytes32", name: "node" }],
    name: "owner",
    outputs: [{ type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { type: "bytes32", name: "node" },
      { type: "bytes32", name: "label" },
      { type: "address", name: "owner" },
      { type: "address", name: "resolver" },
      { type: "uint64", name: "ttl" },
    ],
    name: "setSubnodeRecord",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

const PUBLIC_RESOLVER_ABI = [
  {
    inputs: [
      { type: "bytes32", name: "node" },
      { type: "address", name: "addr" },
    ],
    name: "setAddr",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ type: "bytes32", name: "node" }],
    name: "addr",
    outputs: [{ type: "address" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

const namehash = (name: string): Hex => {
  let node: Hex =
    "0x0000000000000000000000000000000000000000000000000000000000000000";
  if (name) {
    const labels = name.split(".").reverse();
    for (const label of labels) {
      const labelHash = keccak256(stringToBytes(label));
      node = keccak256(`0x${node.slice(2)}${labelHash.slice(2)}` as Hex);
    }
  }
  return node;
};

async function main(): Promise<void> {
  const rpcUrl = required("SEPOLIA_RPC_URL");
  const privateKey = required("DEPLOYER_PRIVATE_KEY") as Hex;
  const parentName = required("ENS_NAME").toLowerCase();
  const proposerSubname =
    required("ENS_PROPOSER_SUBNAME").toLowerCase();
  const criticSubname = required("ENS_CRITIC_SUBNAME").toLowerCase();

  const account = privateKeyToAccount(privateKey);
  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(rpcUrl),
  });
  const walletClient = createWalletClient({
    chain: sepolia,
    account,
    transport: http(rpcUrl),
  });

  const parentNode = namehash(parentName);
  const parentOwner = await publicClient.readContract({
    address: ENS_REGISTRY,
    abi: ENS_REGISTRY_ABI,
    functionName: "owner",
    args: [parentNode],
  });
  const parentResolver = await publicClient.readContract({
    address: ENS_REGISTRY,
    abi: ENS_REGISTRY_ABI,
    functionName: "resolver",
    args: [parentNode],
  });

  console.log(`Parent ${parentName}`);
  console.log(`  owner    ${parentOwner}`);
  console.log(`  resolver ${parentResolver}`);
  console.log(`  caller   ${account.address}`);
  if (parentOwner.toLowerCase() !== account.address.toLowerCase()) {
    // ENSv2 uses NameWrapper which can hold the name on behalf of the user;
    // setSubnodeRecord on the registry then fails. Detect and tell the user.
    console.error(
      `\n✗ Parent name is owned by ${parentOwner}, not your wallet ${account.address}.`,
    );
    console.error(
      "  This usually means the name is held by the ENS NameWrapper.",
    );
    console.error(
      "  Open https://app.ens.domains, switch to Sepolia, find the name's",
    );
    console.error(
      "  Subnames tab, and add 'proposer' and 'critic' from the UI.",
    );
    console.error(
      "  Setting the standard PublicResolver on each will let setProfile work.\n",
    );
    process.exit(2);
  }
  if (
    !parentResolver ||
    parentResolver === "0x0000000000000000000000000000000000000000"
  ) {
    console.error(
      `\n✗ Parent name has no resolver set. Configure PublicResolver on ${parentName} in app.ens.domains first.\n`,
    );
    process.exit(2);
  }

  for (const sub of [proposerSubname, criticSubname]) {
    if (!sub.endsWith(`.${parentName}`)) {
      console.error(
        `✗ ${sub} is not a child of ${parentName}; check ENS_*_SUBNAME values`,
      );
      continue;
    }
    const label = sub.slice(0, sub.length - parentName.length - 1);
    const labelHash = keccak256(stringToBytes(label));
    const subNode = namehash(sub);
    const existingResolver = await publicClient.readContract({
      address: ENS_REGISTRY,
      abi: ENS_REGISTRY_ABI,
      functionName: "resolver",
      args: [subNode],
    });
    let resolverForSub = existingResolver as Address;
    if (
      !resolverForSub ||
      resolverForSub === "0x0000000000000000000000000000000000000000"
    ) {
      console.log(
        `→ creating ${sub} (label=${label}) with resolver ${parentResolver}…`,
      );
      const txHash = await walletClient.writeContract({
        chain: sepolia,
        account,
        address: ENS_REGISTRY,
        abi: ENS_REGISTRY_ABI,
        functionName: "setSubnodeRecord",
        args: [
          parentNode,
          labelHash,
          account.address,
          parentResolver as Address,
          0n,
        ],
      });
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: txHash,
      });
      if (receipt.status !== "success") {
        console.error(`✗ ${sub} setSubnodeRecord reverted (tx ${txHash})`);
        continue;
      }
      console.log(`  ✓ subnode tx ${txHash} mined`);
      resolverForSub = parentResolver as Address;
    } else {
      console.log(`✓ ${sub} already has resolver ${resolverForSub}`);
    }

    // Ensure an addr record so getEnsAddress returns the owner.
    const currentAddr = await publicClient.readContract({
      address: resolverForSub,
      abi: PUBLIC_RESOLVER_ABI,
      functionName: "addr",
      args: [subNode],
    });
    if (
      !currentAddr ||
      currentAddr === "0x0000000000000000000000000000000000000000"
    ) {
      console.log(`  → setting addr record on ${sub} → ${account.address}…`);
      const txHash = await walletClient.writeContract({
        chain: sepolia,
        account,
        address: resolverForSub,
        abi: PUBLIC_RESOLVER_ABI,
        functionName: "setAddr",
        args: [subNode, account.address],
      });
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      console.log(`  ✓ addr tx ${txHash} mined`);
    } else {
      console.log(`  ✓ addr already set: ${currentAddr}`);
    }
  }

  console.log("\nDone. You can now run RUN_ENS_TESTS=1 pnpm test.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
