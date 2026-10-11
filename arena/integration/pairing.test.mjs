import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { Keypair } from "@solana/web3.js";
test("local pairing enforces origin, size, cookie seat and two-player bounds; has no signing endpoint", async () => {
  const child = spawn(
    process.execPath,
    [
      new URL("./serve-browser.mjs", import.meta.url).pathname.replace(
        /^\/([A-Za-z]:)/,
        "$1",
      ),
    ],
    {
      env: { ...process.env, PORT: "13203" },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  const origin = "http://127.0.0.1:13203";
  try {
    await Promise.race([
      once(child.stdout, "data"),
      once(child, "exit").then(() => {
        throw Error("Pairing server failed to start");
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(Error("Startup timeout")), 10000).unref(),
      ),
    ]);
    const identity = () => ({
      owner: Keypair.generate().publicKey.toBase58(),
      session: Keypair.generate().publicKey.toBase58(),
    });
    const post = (body, cookie, overrideOrigin = origin) =>
      fetch(origin + "/api/pair", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: overrideOrigin,
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: typeof body === "string" ? body : JSON.stringify(body),
      });
    const one = identity(),
      two = identity();
    assert.equal(
      (await post(one, null, "https://unrelated.invalid")).status,
      403,
    );
    assert.equal((await post("x".repeat(513))).status, 413);
    assert.equal(
      (await post({ ...one, secretKey: "never accepted" })).status,
      400,
    );
    const first = await post(one),
      cookie = first.headers.get("set-cookie").split(";")[0];
    const registered = await first.json();
    assert.equal(registered.seat, 0);
    const resume = (body, token) =>
      fetch(origin + "/api/pair", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: origin,
          "X-AOChain-Seat": token,
        },
        body: JSON.stringify(body),
      });
    assert.equal(
      (await (await resume(one, registered.resumeToken)).json()).seat,
      0,
    );
    assert.equal((await resume(two, registered.resumeToken)).status, 409);
    assert.equal((await resume(one, "0".repeat(64))).status, 409);
    assert.equal((await (await post(one, cookie)).json()).seat, 0);
    assert.equal((await post(two, cookie)).status, 409);
    assert.equal((await (await post(two)).json()).seat, 1);
    assert.equal((await post(identity())).status, 409);
    const isolated = await fetch(origin + "/api/pair/devnet", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify(one),
    });
    assert.match(isolated.headers.get("set-cookie"), /^aochain-devnet=/);
    assert.equal(
      (await isolated.json()).seat,
      0,
      "devnet pairing must not inherit occupied local seats",
    );
    assert.equal(
      (await fetch(origin + "/api/action", { method: "POST" })).status,
      405,
    );
    assert.equal(
      (await fetch(origin + "/../integration/client.mjs")).status,
      404,
    );
  } finally {
    child.kill();
    await once(child, "exit");
  }
});
