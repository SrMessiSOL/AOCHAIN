import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
const port = 13202,
  base = `http://127.0.0.1:${port}`;
test("actual Rust-backed local duel and HTTP boundaries", async () => {
  const process = spawn(
    globalThis.process.execPath,
    ["arena/scripts/serve.mjs"],
    {
      env: { ...globalThis.process.env, PORT: String(port) },
      stdio: "pipe",
      windowsHide: true,
    },
  );
  let output = "";
  process.stdout.on("data", (d) => (output += d));
  process.stderr.on("data", (d) => (output += d));
  const get = () => fetch(base + "/api/state").then((r) => r.json());
  async function post(path, body, cookie, origin = base) {
    const r = await fetch(base + path, {
      method: "POST",
      headers: {
        origin,
        "Content-Type": "application/json",
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    });
    return {
      status: r.status,
      data: await r.json(),
      cookie: r.headers.get("set-cookie")?.split(";")[0],
    };
  }
  try {
    for (let n = 0; n < 60; n++) {
      try {
        if ((await get()).state) break;
      } catch {}
      await delay(100);
    }
    assert.ok((await get()).state, output);
    assert.equal(
      (await post("/api/action", { kind: "ready" }, undefined)).status,
      401,
    );
    assert.equal(
      (await post("/api/join", {}, undefined, "https://evil.example")).status,
      403,
    );
    const a = await post("/api/join", {}),
      b = await post("/api/join", {});
    assert.equal(a.data.seat, 0);
    assert.equal(b.data.seat, 1);
    assert.notEqual(a.cookie, b.cookie);
    assert.equal((await post("/api/join", {})).status, 409);
    const generation = a.data.generation;
    const action = (cookie, nonce, kind, value = 0) =>
      post("/api/action", { nonce, kind, value, generation }, cookie);
    assert.equal((await action(a.cookie, 1, "ready")).status, 200);
    assert.equal((await action(b.cookie, 1, "ready")).status, 200);
    assert.equal(
      (await action(a.cookie, 2, "move", 2)).data.error,
      "Countdown",
    );
    await delay(3100);
    assert.equal((await action(a.cookie, 2, "move", 2)).status, 200);
    assert.equal((await action(a.cookie, 2, "move", 2)).data.error, "Replay");
    assert.equal(
      (
        await post(
          "/api/action",
          { nonce: 3, kind: "spell", value: 1, generation, actor: 1 },
          a.cookie,
        )
      ).status,
      400,
    );
    for (let n = 3; n <= 7; n++) {
      const cast = await action(a.cookie, n, "spell", 1);
      assert.equal(cast.status, 200, JSON.stringify(cast.data));
      if (n < 7) await delay(900);
    }
    const end = await get();
    assert.equal(end.state.phase, 2);
    assert.equal(end.state.winner, 0);
    assert.equal(end.state.fighters[1].hp, 0);
    assert.equal(
      (await action(b.cookie, 2, "spell", 0)).data.error,
      "Finished",
    );
    await post("/api/rematch", {}, a.cookie);
    assert.equal((await get()).generation, generation);
    await post("/api/rematch", {}, b.cookie);
    await delay(100);
    assert.equal((await get()).generation, generation + 1);
    assert.equal((await get()).state.phase, 0);
    assert.equal((await action(a.cookie, 1, "ready")).status, 400);
  } finally {
    process.kill();
    await new Promise((resolve) => process.once("exit", resolve));
  }
});
