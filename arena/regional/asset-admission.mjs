// This runs at the existing trusted asset API, never in a browser or combat worker.
// The repository must transact the exclusive lock with ownership/stake verification.
import { createHmac, randomUUID } from "node:crypto";
export async function issueAdmission(
  repository,
  { account, character, region },
  secret,
  now = Date.now(),
) {
  if (!account || !character || !region || !secret || secret.length < 32)
    throw Error("Incomplete asset admission configuration");
  const lockId = randomUUID(),
    ticketId = randomUUID();
  const verified = await repository.verifyStakeAndLock({
    account,
    character,
    region,
    lockId,
    ticketId,
  });
  if (!verified?.wallet || !verified.revision)
    throw Error("Verified stake and asset revision required");
  const claims = {
    wallet: verified.wallet,
    character,
    region,
    lockId,
    ticketId,
    revision: String(verified.revision),
    expires: now + 60000,
  };
  const encoded = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return {
    ticket:
      encoded +
      "." +
      createHmac("sha256", secret).update(encoded).digest("hex"),
    lockId,
    expires: claims.expires,
  };
}
export async function settleResult(repository, receipt) {
  if (
    receipt?.demo ||
    !receipt?.matchId ||
    receipt.players?.length !== 2 ||
    ![0, 1, 2].includes(receipt.winner)
  )
    throw Error("Verified real-match receipt required");
  // The caller authenticates the region's receipt before this boundary. The
  // repository atomically inserts UNIQUE(matchId), verifies both lock fences,
  // applies its configured reward ledger, and unlocks. Duplicate input is a no-op.
  return repository.settleExactlyOnce(receipt);
}
