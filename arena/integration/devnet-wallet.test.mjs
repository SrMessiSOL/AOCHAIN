import test from "node:test";
import assert from "node:assert/strict";
import {
  compatible,
  connectWallet,
  inspectDevnet,
  DEVNET_GENESIS,
} from "./devnet-wallet.mjs";
test("devnet inspection rejects another genesis before reading program", async () => {
  await assert.rejects(
    inspectDevnet({
      getGenesisHash: async () => "mainnet",
      getAccountInfo: () => assert.fail("must not read wrong chain"),
    }),
    /Wrong network/,
  );
  assert.deepEqual(
    await inspectDevnet({
      getGenesisHash: async () => DEVNET_GENESIS,
      getAccountInfo: async () => null,
    }),
    { deployed: false },
  );
  assert.deepEqual(
    await inspectDevnet({
      getGenesisHash: async () => DEVNET_GENESIS,
      getAccountInfo: async () => ({ executable: true }),
    }),
    { deployed: true },
  );
});
test("wallet connection filters devnet capability and refuses incompatible accounts", async () => {
  const account = {
    address: "public-test-address",
    chains: ["solana:devnet"],
    features: ["solana:signTransaction"],
  };
  const wallet = {
    chains: ["solana:devnet"],
    features: {
      "standard:connect": { connect: async () => ({ accounts: [account] }) },
      "solana:signTransaction": {
        signTransaction: () => assert.fail("connection must not sign"),
      },
    },
  };
  assert.equal(compatible(wallet), true);
  assert.equal(await connectWallet(wallet), account);
  assert.equal(compatible({ ...wallet, chains: ["solana:mainnet"] }), false);
  wallet.features["standard:connect"].connect = async () => ({
    accounts: [{ ...account, chains: ["solana:mainnet"] }],
  });
  await assert.rejects(connectWallet(wallet), /No compatible/);
});
