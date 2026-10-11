import test from "node:test";
import assert from "node:assert/strict";
import { PublicKey } from "@solana/web3.js";
import {
  PROGRAM,
  DELEGATION,
  arenaAddress,
  delegate,
  act,
  settle,
  decodeArena,
  discriminator,
  u64,
  settlementComplete,
} from "./client.mjs";
const keys = [1, 2, 3, 4].map((n) => new PublicKey(Buffer.alloc(32, n)));
function fixture() {
  const data = Buffer.alloc(520);
  discriminator("account", "ArenaAccount").copy(data);
  u64(7n).copy(data, 8);
  keys.forEach((key, i) => key.toBuffer().copy(data, 16 + i * 32));
  data.writeBigInt64LE(100n, 144);
  data[152] = 1;
  data[153] = 1;
  data[154] = 1;
  keys[0].toBuffer().copy(data, 155);
  data[187] = 255;
  data[188] = 4;
  data[189] = 6;
  data[190] = 2;
  data.writeUInt16LE(120, 191);
  data.writeUInt16LE(80, 193);
  u64(3n).copy(data, 195);
  data[227] = 11;
  data[228] = 6;
  data[229] = 4;
  data.writeUInt16LE(94, 230);
  data.writeUInt16LE(100, 232);
  data[266] = 1;
  data[267] = 1;
  data[268] = 2;
  data[269] = 1;
  u64(6n).copy(data, 294);
  return data;
}
test("decoder handles Borsh field widths, padding and malformed data", () => {
  const s = decodeArena(fixture());
  assert.equal(s.matchId, 7n);
  assert.equal(s.fighters[0].nonce, 3n);
  assert.equal(s.fighters[1].hp, 94);
  assert.equal(s.revision, 6n);
  assert.throws(() => decodeArena(Buffer.alloc(302)));
  assert.throws(() => decodeArena(fixture().subarray(0, 301)));
  const malformed = fixture();
  malformed[152] = 2;
  assert.throws(() => decodeArena(malformed));
});
test("settlement requires restored owner AND matching committed result", () => {
  const data = fixture(),
    expected = decodeArena(data);
  assert.equal(
    settlementComplete({ owner: DELEGATION, data }, expected),
    false,
  );
  assert.equal(settlementComplete({ owner: PROGRAM, data }, expected), true);
  assert.equal(
    settlementComplete({ owner: PROGRAM, data }, { ...expected, revision: 7n }),
    false,
  );
  const pending = Buffer.from(data);
  pending[154] = 0;
  assert.equal(
    settlementComplete({ owner: PROGRAM, data: pending }, expected),
    false,
  );
});
test("delegation and settlement match SDK macro account order", () => {
  const arena = arenaAddress(keys[0], 7n),
    ix = delegate(keys[0], arena, 7n);
  assert.equal(ix.keys.length, 8);
  assert(ix.keys[0].isSigner);
  assert(ix.keys[4].pubkey.equals(arena));
  assert(ix.keys[6].pubkey.equals(DELEGATION));
  const done = settle(keys[0], arena);
  assert.equal(done.keys.length, 4);
  assert(done.keys[3].isWritable);
  assert.equal(act(keys[2], arena, 3n, 1, 2).data.length, 18);
  assert.throws(() => act(keys[2], arena, 3n, 1, 256));
  assert.throws(() => u64(-1n));
});
