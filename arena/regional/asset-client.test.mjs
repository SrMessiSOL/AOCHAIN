import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createAssetClient } from "./asset-client.mjs";
test("worker calls bind action, region and fresh nonce without player or wallet credentials", async () => {
  const secret = "only-a-test-regional-key".repeat(2),
    calls = [];
  const client = createAssetClient({
    url: "http://127.0.0.1:3001/internal/ranked",
    region: "eu",
    secret,
    fetcher: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, json: async () => ({ ok: true }) };
    },
  });
  await client.finish({ matchId: "fixture" });
  await client.finish({ matchId: "fixture" });
  for (const { url, options } of calls) {
    assert.equal(url, "http://127.0.0.1:3001/internal/ranked/finish");
    assert.equal(options.redirect, "error");
    assert.equal(options.headers.Authorization, undefined);
    assert.equal(options.headers.Cookie, undefined);
    const envelope = JSON.parse(options.body);
    assert.equal(envelope.region, "eu");
    assert.equal(
      options.headers["X-AOChain-Signature"],
      createHmac("sha256", secret)
        .update("/internal/ranked/finish\n" + options.body)
        .digest("hex"),
    );
  }
  assert.notEqual(
    JSON.parse(calls[0].options.body).nonce,
    JSON.parse(calls[1].options.body).nonce,
  );
});
test("insecure endpoints and rejected settlements fail closed", async () => {
  for (const url of [
    "http://remote.example/ranked",
    "https://name:password@remote.example/ranked",
    "https://remote.example/ranked?key=secret",
  ])
    assert.throws(() =>
      createAssetClient({ url, region: "eu", secret: "test" }),
    );
  const client = createAssetClient({
    url: "https://example.test/region-api/ranked",
    region: "eu",
    secret: "test",
    fetcher: async () => ({ ok: false, status: 409 }),
  });
  await assert.rejects(client.finish({}), /retain the existing lock/);
});
