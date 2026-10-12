import test from "node:test";
import assert from "node:assert/strict";
import { issueAdmission, settleResult } from "./asset-admission.mjs";
import { verifyAdmission } from "./policy.mjs";
test("asset service admits only a repository-verified staked and exclusively locked character", async () => {
  const locks = new Set(),
    secret = "local-test-only".repeat(3);
  const repository = {
    verifyStakeAndLock: async ({ character, account }) => {
      if (account !== "owner" || locks.has(character))
        throw Error("Not available");
      locks.add(character);
      return { wallet: "verified-wallet", revision: 5 };
    },
  };
  await assert.rejects(
    issueAdmission(
      repository,
      { account: "other", character: "one", region: "eu" },
      secret,
    ),
  );
  const result = await issueAdmission(
    repository,
    { account: "owner", character: "one", region: "eu" },
    secret,
    1000,
  );
  assert.equal(
    verifyAdmission(result.ticket, secret, "eu", 1001).revision,
    "5",
  );
  await assert.rejects(
    issueAdmission(
      repository,
      { account: "owner", character: "one", region: "us" },
      secret,
      1000,
    ),
  );
  await assert.rejects(
    settleResult(
      {},
      { demo: true, matchId: "one", players: [{}, {}], winner: 0 },
    ),
  );
});
