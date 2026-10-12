import { createHmac, randomUUID } from "node:crypto";
export function createAssetClient({ url, region, secret, fetcher = fetch }) {
  const base = new URL(url);
  if (
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    !(
      base.protocol === "https:" ||
      (base.protocol === "http:" && base.hostname === "127.0.0.1")
    )
  )
    throw Error("Asset service requires HTTPS or loopback");
  async function call(action, payload) {
    const path = "/internal/ranked/" + action,
      envelope = {
        region,
        timestamp: Date.now(),
        nonce: randomUUID(),
        payload,
      };
    const signature = createHmac("sha256", secret)
      .update(path + "\n" + JSON.stringify(envelope))
      .digest("hex");
    const response = await fetcher(url.replace(/\/$/, "") + "/" + action, {
      method: "POST",
      redirect: "error",
      headers: {
        "Content-Type": "application/json",
        "X-AOChain-Signature": signature,
      },
      body: JSON.stringify(envelope),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok)
      throw Error(
        `Asset service rejected ${action} (${response.status}); retain the existing lock`,
      );
    return response.json();
  }
  return {
    start: (matchId, players) => call("start", { matchId, players }),
    renew: (claims) => call("renew", claims),
    release: (claims) => call("release", claims),
    finish: (receipt) => call("finish", { receipt }),
  };
}
