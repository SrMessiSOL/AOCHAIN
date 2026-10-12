import { createHmac, timingSafeEqual } from "node:crypto";
export function latencyScore(samples, now) {
  const recent = samples
    .filter(
      (s) =>
        now - s.at >= 0 &&
        now - s.at < 15000 &&
        Number.isFinite(s.ms) &&
        s.ms >= 0,
    )
    .map((s) => s.ms)
    .sort((a, b) => a - b);
  return recent.length < 5
    ? Infinity
    : recent[Math.ceil(recent.length * 0.9) - 1];
}
export function eligible(player, now) {
  return (
    player.ws.readyState === 1 &&
    !player.match &&
    latencyScore(player.samples, now) < 100
  );
}
export function verifyAdmission(ticket, secret, region, now = Date.now()) {
  if (!secret || typeof ticket !== "string" || ticket.length > 4096)
    throw Error("Verified asset admission required");
  const [encoded, signature, extra] = ticket.split(".");
  const actual = Buffer.from(signature || "", "hex");
  const expected = createHmac("sha256", secret)
    .update(encoded || "")
    .digest();
  if (
    extra ||
    actual.length !== expected.length ||
    !timingSafeEqual(actual, expected)
  )
    throw Error("Invalid admission signature");
  const claims = JSON.parse(Buffer.from(encoded, "base64url"));
  if (
    claims.region !== region ||
    !Number.isSafeInteger(claims.expires) ||
    claims.expires <= now ||
    claims.expires > now + 60000 ||
    !["wallet", "character", "lockId", "revision", "ticketId"].every(
      (k) =>
        typeof claims[k] === "string" &&
        claims[k].length > 0 &&
        claims[k].length < 128,
    )
  )
    throw Error("Invalid admission claims");
  return claims;
}
