import test from "node:test";
import assert from "node:assert/strict";
import { Keypair, Transaction, SystemProgram } from "@solana/web3.js";
import { signDevnetTransaction } from "./wallet-signing.mjs";
import { lifecycleStep } from "./devnet-transport.mjs";
import { PROGRAM, DELEGATION } from "./client.mjs";
function fixture() {
  const user = Keypair.generate(),
    recipient = Keypair.generate();
  const account = {
    address: user.publicKey.toBase58(),
    chains: ["solana:devnet"],
    features: ["solana:signTransaction"],
  };
  const tx = new Transaction({
    feePayer: user.publicKey,
    recentBlockhash: Keypair.generate().publicKey.toBase58(),
  }).add(
    SystemProgram.transfer({
      fromPubkey: user.publicKey,
      toPubkey: recipient.publicKey,
      lamports: 1,
    }),
  );
  const wallet = {
    accounts: [account],
    features: {
      "solana:signTransaction": {
        signTransaction: async (input) => {
          assert.equal(input.chain, "solana:devnet");
          const signed = Transaction.from(input.transaction);
          signed.sign(user);
          return [{ signedTransaction: signed.serialize() }];
        },
      },
    },
  };
  return { user, account, tx, wallet };
}
test("devnet wallet signing preserves the exact transaction and verifies its signature", async () => {
  const f = fixture();
  const raw = await signDevnetTransaction(f.wallet, f.account, f.tx);
  assert(Transaction.from(raw).verifySignatures());
});
test("account changes and wallet message mutations cannot be submitted", async () => {
  const f = fixture();
  f.wallet.accounts = [];
  await assert.rejects(
    signDevnetTransaction(f.wallet, f.account, f.tx),
    /account changed/,
  );
  const g = fixture();
  g.wallet.features["solana:signTransaction"].signTransaction = async (
    input,
  ) => {
    const tx = Transaction.from(input.transaction);
    tx.instructions[0].data[4] ^= 1;
    tx.sign(g.user);
    return [{ signedTransaction: tx.serialize() }];
  };
  await assert.rejects(
    signDevnetTransaction(g.wallet, g.account, g.tx),
    /different transaction/,
  );
  const h = fixture();
  const sign = h.wallet.features["solana:signTransaction"].signTransaction;
  h.wallet.features["solana:signTransaction"].signTransaction = async (
    input,
  ) => {
    const result = await sign(input);
    h.wallet.accounts = [];
    return result;
  };
  await assert.rejects(
    signDevnetTransaction(h.wallet, h.account, h.tx),
    /during approval/,
  );
});
test("lifecycle offers owner approvals only to the corresponding participant", () => {
  const p = { seat: 0, players: [{}, {}] };
  assert.equal(lifecycleStep(p, null), "create");
  assert.equal(lifecycleStep({ ...p, seat: 1 }, null), "waiting-create");
  assert.equal(
    lifecycleStep(p, { owner: PROGRAM }, { phase: 0, joined: false }),
    "waiting-join",
  );
  assert.equal(
    lifecycleStep(
      { ...p, seat: 1 },
      { owner: PROGRAM },
      { phase: 0, joined: false },
    ),
    "join",
  );
  assert.equal(
    lifecycleStep(
      p,
      { owner: PROGRAM },
      { phase: 0, joined: true, delegated: false },
    ),
    "delegate",
  );
  assert.equal(lifecycleStep(p, { owner: DELEGATION }, { phase: 1 }), "active");
  assert.equal(lifecycleStep(p, { owner: PROGRAM }, { phase: 2 }), "finished");
  assert.throws(
    () =>
      lifecycleStep(p, { owner: Keypair.generate().publicKey }, { phase: 0 }),
    /Unexpected/,
  );
});
