import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { latencyScore, eligible, verifyAdmission } from "./policy.mjs";
import { chooseRegion } from "./region-selection.mjs";
test("best-region selection refuses unavailable and over-budget measurements", () => {
  assert.equal(
    chooseRegion([
      { id: "far", ping: 101 },
      { id: "near", ping: 25 },
      { id: "other", ping: 70 },
    ]).id,
    "near",
  );
  assert.equal(
    chooseRegion([{ ping: Infinity }, { ping: 100 }, { ping: null }]),
    null,
  );
});
const samples = (ms, at = 1000) =>
  Array.from({ length: 8 }, () => ({ ms, at }));
test("strict regional latency gate uses fresh server observations and tail latency", () => {
  assert.equal(latencyScore(samples(99), 1001), 99);
  assert(eligible({ samples: samples(99), ws: { readyState: 1 } }, 1001));
  assert(!eligible({ samples: samples(100), ws: { readyState: 1 } }, 1001));
  assert(!eligible({ samples: samples(20, 0), ws: { readyState: 1 } }, 16000));
  assert(
    !eligible(
      { samples: samples(20).slice(0, 4), ws: { readyState: 1 } },
      1001,
    ),
  );
  assert(
    !eligible({ samples: samples(20), ws: { readyState: 1 }, match: {} }, 1001),
  );
  assert.equal(
    latencyScore([...samples(20).slice(0, 5), { ms: 250, at: 1000 }], 1001),
    250,
  );
});
test("asset admission is bound to region, expiry and authenticated lock claims", () => {
  const secret = "test-only".repeat(5),
    claims = {
      wallet: "wallet",
      character: "character",
      lockId: "lock",
      revision: "1",
      ticketId: "one",
      region: "eu",
      expires: 2000,
    };
  const sign = (c) => {
    const data = Buffer.from(JSON.stringify(c)).toString("base64url");
    return data + "." + createHmac("sha256", secret).update(data).digest("hex");
  };
  assert.equal(
    verifyAdmission(sign(claims), secret, "eu", 1000).character,
    "character",
  );
  assert.throws(() => verifyAdmission(sign(claims), secret, "us", 1000));
  assert.throws(() => verifyAdmission(sign(claims), secret, "eu", 2000));
  assert.throws(() =>
    verifyAdmission(sign(claims), secret + "changed", "eu", 1000),
  );
  assert.throws(() =>
    verifyAdmission(sign({ ...claims, lockId: "" }), secret, "eu", 1000),
  );
});
