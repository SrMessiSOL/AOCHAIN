import { sha256 } from "@noble/hashes/sha256";
import { Buffer } from "buffer";
import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";

export const PROGRAM = new PublicKey(
  "FuHnshxKDZ5pPvGPPKko526eEWk6RCQCMRnVfCp8Y9pZ",
);
export const DELEGATION = new PublicKey(
  "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh",
);
export const VALIDATOR = new PublicKey(
  "mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev",
);
export const MAGIC = new PublicKey(
  "Magic11111111111111111111111111111111111111",
);
export const CONTEXT = new PublicKey(
  "MagicContext1111111111111111111111111111111",
);
export const discriminator = (namespace, name) =>
  Buffer.from(
    sha256(new TextEncoder().encode(`${namespace}:${name}`)),
  ).subarray(0, 8);
export function u64(value) {
  const data = Buffer.alloc(8);
  data.writeBigUInt64LE(BigInt(value));
  return data;
}
const meta = (pubkey, isSigner = false, isWritable = false) => ({
  pubkey,
  isSigner,
  isWritable,
});
const pda = (tag, account, program) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from(tag), account.toBuffer()],
    program,
  )[0];
export const arenaAddress = (owner, id) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("arena"), owner.toBuffer(), u64(id)],
    PROGRAM,
  )[0];
const instruction = (name, keys, ...args) =>
  new TransactionInstruction({
    programId: PROGRAM,
    keys,
    data: Buffer.concat([discriminator("global", name), ...args]),
  });
export function create(owner, opponent, session, id, validator = VALIDATOR) {
  return instruction(
    "create",
    [
      meta(owner, true, true),
      meta(arenaAddress(owner, id), false, true),
      meta(SystemProgram.programId),
    ],
    u64(id),
    opponent.toBuffer(),
    session.toBuffer(),
    validator.toBuffer(),
  );
}
export const join = (opponent, arena, session) =>
  instruction(
    "join",
    [meta(opponent, true), meta(arena, false, true)],
    session.toBuffer(),
  );
// #[delegate] inserts buffer/record/metadata BEFORE the delegated field.
export function delegate(owner, arena, id) {
  return instruction(
    "delegate",
    [
      meta(owner, true, true),
      meta(pda("buffer", arena, PROGRAM), false, true),
      meta(pda("delegation", arena, DELEGATION), false, true),
      meta(pda("delegation-metadata", arena, DELEGATION), false, true),
      meta(arena, false, true),
      meta(PROGRAM),
      meta(DELEGATION),
      meta(SystemProgram.programId),
    ],
    u64(id),
  );
}
export const act = (actor, arena, nonce, kind, value = 0) => {
  if (
    !Number.isInteger(kind) ||
    kind < 0 ||
    kind > 5 ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > 255
  )
    throw new Error("Invalid action");
  return instruction(
    "act",
    [meta(actor, true), meta(arena, false, true)],
    u64(nonce),
    Buffer.from([kind, value]),
  );
};
export const revoke = (owner, arena) =>
  instruction("revoke_session", [meta(owner, true), meta(arena, false, true)]);
export const settle = (payer, arena) =>
  instruction("settle", [
    meta(payer, true, true),
    meta(arena, false, true),
    meta(MAGIC),
    meta(CONTEXT, false, true),
  ]);

export function decodeArena(data) {
  data = Buffer.from(data);
  if (
    data.length < 302 ||
    !data.subarray(0, 8).equals(discriminator("account", "ArenaAccount"))
  )
    throw new Error("Invalid arena account");
  let offset = 8;
  const read = (size, fn) => {
    const value = fn(offset);
    offset += size;
    return value;
  };
  const byte = () => read(1, (i) => data.readUInt8(i));
  const bool = () => {
    const n = byte();
    if (n > 1) throw new Error("Invalid boolean");
    return Boolean(n);
  };
  const short = () => read(2, (i) => data.readUInt16LE(i));
  const long = () => read(8, (i) => data.readBigUInt64LE(i));
  const key = () => read(32, (i) => new PublicKey(data.subarray(i, i + 32)));
  const matchId = long(),
    owners = [key(), key()],
    sessions = [key(), key()];
  const sessionExpires = read(8, (i) => data.readBigInt64LE(i));
  const joined = bool(),
    delegated = bool(),
    settlementRequested = bool(),
    validator = key(),
    bump = byte();
  const fighter = () => ({
    x: byte(),
    y: byte(),
    heading: byte(),
    hp: short(),
    mana: short(),
    nonce: long(),
    moveAt: long(),
    meleeAt: long(),
    spellAt: long(),
  });
  const fighters = [fighter(), fighter()],
    ready = [bool(), bool()],
    phase = byte(),
    winner = byte();
  const startsAt = long(),
    expiresAt = long(),
    lastTick = long(),
    revision = long();
  if (phase > 2 || winner > 2) throw new Error("Invalid duel phase");
  return {
    matchId,
    owners,
    sessions,
    sessionExpires,
    joined,
    delegated,
    settlementRequested,
    validator,
    bump,
    fighters,
    ready,
    phase,
    winner,
    startsAt,
    expiresAt,
    lastTick,
    revision,
  };
}
export function settlementComplete(info, expected) {
  if (!info || !info.owner.equals(PROGRAM)) return false;
  const state = decodeArena(info.data);
  return (
    state.phase === 2 &&
    state.settlementRequested &&
    state.matchId === expected.matchId &&
    state.winner === expected.winner &&
    state.revision === expected.revision &&
    state.owners.every((owner, i) => owner.equals(expected.owners[i]))
  );
}
