// Local only: generated throwaway signers, no imported wallet or live network.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import {
  Connection,
  Keypair,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  PROGRAM,
  DELEGATION,
  arenaAddress,
  create,
  join,
  delegate,
  act,
  revoke,
  settle,
  decodeArena,
  settlementComplete,
} from "./client.mjs";

const base = new Connection("http://127.0.0.1:8899", "confirmed");
const rollup = new Connection("http://127.0.0.1:7799", "confirmed");
const owners = [Keypair.generate(), Keypair.generate()];
const sessions = [Keypair.generate(), Keypair.generate()];
const outsider = Keypair.generate();
const id = BigInt(Date.now());
const arena = arenaAddress(owners[0].publicKey, id);
const receipts = [];
async function send(connection, signer, ix) {
  const signature = await sendAndConfirmTransaction(
    connection,
    new Transaction().add(ix),
    [signer],
    { commitment: "confirmed" },
  );
  receipts.push({
    network: connection === base ? "local-base" : "local-rollup",
    signature,
  });
  return signature;
}
async function waitFor(label, predicate, seconds = 60) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    const result = await predicate();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `Timed out: ${label}; reconcile existing account before retrying`,
  );
}
async function state() {
  const info = await rollup.getAccountInfo(arena);
  if (!info) throw new Error("Arena missing on rollup");
  return decodeArena(info.data);
}
async function reject(connection, signer, ix) {
  const before = await connection.getAccountInfo(arena);
  await assert.rejects(() => send(connection, signer, ix));
  const after = await connection.getAccountInfo(arena);
  assert.deepEqual(after.data, before.data, "Rejected action changed state");
}

await base.getVersion();
await rollup.getVersion();
assert(
  (await base.getAccountInfo(PROGRAM))?.executable,
  "Deploy the program on the local base validator first",
);
assert(
  (await base.getAccountInfo(DELEGATION))?.executable,
  "Use mb-test-validator with delegation program installed",
);
for (const signer of [...owners, ...sessions, outsider]) {
  const signature = await base.requestAirdrop(signer.publicKey, 2_000_000_000);
  await base.confirmTransaction(signature, "confirmed");
}
await send(
  base,
  owners[0],
  create(owners[0].publicKey, owners[1].publicKey, sessions[0].publicKey, id),
);
await reject(
  base,
  outsider,
  join(outsider.publicKey, arena, outsider.publicKey),
);
await send(
  base,
  owners[1],
  join(owners[1].publicKey, arena, sessions[1].publicKey),
);
await send(base, owners[0], delegate(owners[0].publicKey, arena, id));
await waitFor("delegation owner", async () =>
  (await base.getAccountInfo(arena))?.owner.equals(DELEGATION),
);
await waitFor("rollup arena", () => rollup.getAccountInfo(arena));
await reject(rollup, owners[0], settle(owners[0].publicKey, arena));
await send(rollup, sessions[0], act(sessions[0].publicKey, arena, 1n, 0));
await send(rollup, sessions[1], act(sessions[1].publicKey, arena, 1n, 0));
await reject(rollup, outsider, act(outsider.publicKey, arena, 2n, 1, 2));
await reject(rollup, sessions[0], act(sessions[0].publicKey, arena, 1n, 0));
const started = await state();
await waitFor(
  "countdown",
  async () => BigInt(await rollup.getSlot()) >= started.startsAt,
);
await send(rollup, sessions[0], act(sessions[0].publicKey, arena, 2n, 1, 2));
await send(rollup, sessions[0], act(sessions[0].publicKey, arena, 3n, 3, 1));
assert.equal((await state()).fighters[1].hp, 94);
// Reconnect: a fresh RPC client recovers authoritative nonce; never reset it locally.
const recovered = decodeArena(
  (await new Connection(rollup.rpcEndpoint, "confirmed").getAccountInfo(arena))
    .data,
);
assert.equal(recovered.fighters[0].nonce, 3n);
await send(rollup, owners[0], revoke(owners[0].publicKey, arena));
await reject(rollup, sessions[0], act(sessions[0].publicKey, arena, 4n, 4));
await send(rollup, owners[0], act(owners[0].publicKey, arena, 4n, 4));
const ended = await state();
assert.equal(ended.phase, 2);
assert.equal(ended.winner, 1);
await reject(rollup, sessions[1], act(sessions[1].publicKey, arena, 2n, 1, 4));
await send(rollup, owners[0], settle(owners[0].publicKey, arena));
await waitFor(
  "base-chain result and undelegation",
  async () => settlementComplete(await base.getAccountInfo(arena), ended),
  90,
);
const report = JSON.stringify(
  {
    result: "passed",
    environment: "local-only",
    arena: arena.toBase58(),
    checks: [
      "opponent consent",
      "delegation",
      "premature settlement rejection",
      "session combat",
      "unauthorized and replay rejection",
      "RPC reconnect",
      "revocation and owner recovery",
      "finished-state rejection",
      "base ownership and result settlement",
    ],
    receipts,
  },
  null,
  2,
);
await mkdir(new URL("../work/", import.meta.url), { recursive: true });
await writeFile(
  new URL("../work/local-lifecycle-receipt.json", import.meta.url),
  report + "\n",
);
// web3 confirmation opens sockets; this standalone test has completed all checks.
await new Promise((resolve) => process.stdout.write(report + "\n", resolve));
process.exit(0);
