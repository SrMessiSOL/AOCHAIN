// Explicit devnet test only. Uses the dedicated funded deployment payer.
import { readFile, writeFile } from "node:fs/promises";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { inspectDevnet, DEVNET_RPC } from "./devnet-wallet.mjs";
import {
  PROGRAM,
  DELEGATION,
  arenaAddress,
  create,
  join,
  delegate,
  act,
  settle,
  decodeArena,
  settlementComplete,
} from "./client.mjs";
const base = new Connection(DEVNET_RPC, "confirmed");
const er = new Connection("https://devnet-us.magicblock.app", {
  commitment: "confirmed",
  wsEndpoint: "wss://devnet-us.magicblock.app",
});
const validator = new PublicKey("MUS3hc9TCw4cGC12vHNoYcCGzJG1txjgQLZWVoeNHNd");
if (!(await inspectDevnet(base)).deployed)
  throw Error("Arena is not deployed on devnet");
const payer = Keypair.fromSecretKey(
  Uint8Array.from(
    JSON.parse(
      await readFile(
        new URL("../work/devnet-deployer.json", import.meta.url),
        "utf8",
      ),
    ),
  ),
);
if (
  payer.publicKey.toBase58() !== "DB5fZRbpbzsar78cEEpWmy55rU7zqaxiDgHmsYCXQ2T2"
)
  throw Error("Wrong disposable test payer");
const resume = process.argv.includes("--resume");
const previous = resume
  ? JSON.parse(
      await readFile(
        new URL("../work/devnet-smoke.json", import.meta.url),
        "utf8",
      ),
    )
  : undefined;
const savedKeys = resume
  ? JSON.parse(
      await readFile(
        new URL("../work/devnet-smoke-keys.json", import.meta.url),
        "utf8",
      ),
    ).map((k) => Keypair.fromSecretKey(Uint8Array.from(k)))
  : undefined;
const owners = savedKeys
    ? savedKeys.slice(0, 2)
    : [Keypair.generate(), Keypair.generate()],
  sessions = savedKeys
    ? savedKeys.slice(2, 4)
    : [Keypair.generate(), Keypair.generate()];
const id = previous ? BigInt(previous.matchId) : BigInt(Date.now()),
  arena = arenaAddress(owners[0].publicKey, id);
const report = previous || {
  network: "devnet",
  program: PROGRAM.toBase58(),
  arena: arena.toBase58(),
  matchId: String(id),
  validator: validator.toBase58(),
  signatures: [],
  complete: false,
};
if (resume && report.arena !== arena.toBase58())
  throw Error("Recovery keys do not match the arena");
if (!resume)
  await writeFile(
    new URL("../work/devnet-smoke-keys.json", import.meta.url),
    JSON.stringify([...owners, ...sessions].map((k) => [...k.secretKey])),
    { mode: 0o600 },
  );
async function save() {
  await writeFile(
    new URL("../work/devnet-smoke.json", import.meta.url),
    JSON.stringify(report, null, 2),
  );
}
async function send(connection, signer, ...ix) {
  const block = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: signer.publicKey, ...block }).add(
    ...ix,
  );
  tx.sign(signer);
  const signature = await connection.sendRawTransaction(tx.serialize(), {
    maxRetries: 3,
  });
  report.signatures.push({
    network: connection === base ? "solana-devnet" : "magicblock-devnet-us",
    signature,
  });
  await save();
  await wait("transaction confirmation", async () => {
    const status = (await connection.getSignatureStatuses([signature]))
      .value[0];
    if (status?.err)
      throw Error("Transaction rejected: " + JSON.stringify(status.err));
    return (
      status && ["confirmed", "finalized"].includes(status.confirmationStatus)
    );
  });
  return signature;
}
async function wait(label, predicate) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    const result = await predicate();
    if (result) return result;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw Error(`Timeout: ${label}. Inspect the existing arena before retrying.`);
}
await save();
try {
  if (!resume) {
    await send(
      base,
      payer,
      ...[...owners, ...sessions].map((k) =>
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: k.publicKey,
          lamports: 20_000_000,
        }),
      ),
    );
    await send(
      base,
      owners[0],
      create(
        owners[0].publicKey,
        owners[1].publicKey,
        sessions[0].publicKey,
        id,
        validator,
      ),
    );
    await send(
      base,
      owners[1],
      join(owners[1].publicKey, arena, sessions[1].publicKey),
    );
    await send(base, owners[0], delegate(owners[0].publicKey, arena, id));
    await wait("delegation", async () =>
      (await base.getAccountInfo(arena))?.owner.equals(DELEGATION),
    );
    await wait("ER account", () => er.getAccountInfo(arena));
    await send(er, sessions[0], act(sessions[0].publicKey, arena, 1n, 0));
    await send(er, sessions[1], act(sessions[1].publicKey, arena, 1n, 0));
  }
  const live = decodeArena((await er.getAccountInfo(arena)).data);
  if (live.phase !== 2 && BigInt(await er.getSlot()) >= live.expiresAt) {
    await send(
      er,
      sessions[0],
      act(sessions[0].publicKey, arena, live.fighters[0].nonce + 1n, 5),
    );
    report.recoveredByTimeout = true;
  } else if (live.phase !== 2) {
    await wait(
      "countdown",
      async () => BigInt(await er.getSlot()) >= live.startsAt,
    );
    await send(er, sessions[0], act(sessions[0].publicKey, arena, 2n, 1, 2));
    await send(er, sessions[0], act(sessions[0].publicKey, arena, 3n, 3, 1));
    const combat = decodeArena((await er.getAccountInfo(arena)).data);
    if (combat.fighters[1].hp !== 94 || combat.fighters[0].mana !== 80)
      throw Error("Unexpected combat result");
    report.combat = { opponentHp: 94, casterMana: 80 };
    await save();
    await send(er, sessions[0], act(sessions[0].publicKey, arena, 4n, 4));
  }
  const finished = decodeArena((await er.getAccountInfo(arena)).data);
  if (finished.phase !== 2) throw Error("Match did not finish");
  if (!finished.settlementRequested)
    await send(er, owners[0], settle(owners[0].publicKey, arena));
  await wait("base-chain settlement", async () =>
    settlementComplete(await base.getAccountInfo(arena), finished),
  );
  report.complete = true;
  delete report.error;
  report.winner = finished.winner;
  await save();
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.error = error.message;
  await save();
  console.error(error.message);
  process.exitCode = 1;
}
setTimeout(() => process.exit(process.exitCode || 0), 1000);
