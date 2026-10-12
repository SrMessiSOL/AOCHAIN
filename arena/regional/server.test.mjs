import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocket } from "ws";
import { fileURLToPath } from "node:url";
const port = 13210,
  origin = `http://127.0.0.1:${port}`;
async function wait(check, limit = 7000) {
  const end = Date.now() + limit;
  while (Date.now() < end) {
    const result = check();
    if (result) return result;
    await delay(20);
  }
  throw Error("Timed out waiting for realtime state");
}
function connect(pongDelay = 0) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/realtime`, {
    origin,
    autoPong: false,
  });
  ws.on("ping", (payload) =>
    setTimeout(() => {
      if (ws.readyState === 1) ws.pong(payload);
    }, pongDelay),
  );
  const messages = [];
  ws.on("message", (raw) => {
    const m = JSON.parse(raw);
    messages.push(m);
  });
  return {
    ws,
    messages,
    send: (m) => ws.send(JSON.stringify(m)),
    lastState: () =>
      messages.filter((m) => m.type === "state" && m.state).at(-1),
  };
}
test("real websocket matchmaking rejects slow peers, runs Rust combat and records forfeit once", async () => {
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL("./server.mjs", import.meta.url))],
    {
      env: {
        ...process.env,
        PORT: String(port),
        AOCHAIN_DEMO: "1",
        AOCHAIN_DEMO_LEGACY: "1",
      },
      windowsHide: true,
      stdio: "pipe",
    },
  );
  let logs = "";
  child.stdout.on("data", (d) => (logs += d));
  child.stderr.on("data", (d) => (logs += d));
  const clients = [];
  try {
    await wait(() => logs.includes("Regional ranked"));
    const a = connect(),
      slow = connect(150);
    clients.push(a, slow);
    await wait(() => a.ws.readyState === 1 && slow.ws.readyState === 1);
    a.send({ type: "ranked" });
    slow.send({ type: "ranked" });
    await delay(3200);
    assert.equal(
      a.lastState(),
      undefined,
      "slow opponent must not create a match",
    );
    assert(slow.messages.some((m) => m.type === "latency" && m.ping >= 100));
    const b = connect();
    clients.push(b);
    await wait(() => b.ws.readyState === 1);
    b.send({ type: "ranked" });
    await wait(
      () =>
        a.lastState()?.state.phase === 1 && b.lastState()?.state.phase === 1,
    );
    const match = a.lastState();
    assert.equal(match.seat, 0);
    assert.equal(b.lastState().seat, 1);
    assert.equal(a.lastState().generation, b.lastState().generation);
    assert(a.messages.filter((m) => m.type === "latency").at(-1).ping < 100);
    await wait(() => a.lastState().tick >= a.lastState().state.starts_at);
    const roundTrips = [];
    for (let i = 0; i < 6; i++) {
      const state = a.lastState(),
        id = 10 + i,
        sent = performance.now();
      a.send({
        type: "action",
        id,
        generation: state.generation,
        kind: "move",
        value: 2,
        nonce: state.state.fighters[0].nonce + 1,
      });
      await wait(() =>
        a.messages.some((m) => m.type === "ack" && m.id === id && !m.error),
      );
      roundTrips.push(performance.now() - sent);
      await delay(210);
    }
    assert.equal(a.lastState().state.fighters[0].x, 10);
    const attack = a.lastState();
    a.send({
      type: "action",
      id: 20,
      generation: attack.generation,
      kind: "melee",
      value: 0,
      nonce: attack.state.fighters[0].nonce + 1,
    });
    await wait(() => a.lastState().state.fighters[1].hp === 102);
    assert(
      Math.max(...roundTrips) < 100,
      "loopback realtime action acknowledgment should be below 100 ms",
    );
    console.log(
      `Loopback movement acknowledgment max: ${Math.round(Math.max(...roundTrips))} ms (not regional WAN proof)`,
    );
    const afterAttack = a.lastState();
    a.send({
      type: "action",
      id: 1,
      generation: match.generation,
      kind: "forfeit",
      value: 0,
      nonce: afterAttack.state.fighters[0].nonce + 1,
    });
    await wait(() => a.lastState()?.state.phase === 2);
    assert.equal(a.lastState().state.winner, 1);
    await wait(() =>
      a.messages.some(
        (m) => m.type === "result" && m.receiptStatus === "recorded",
      ),
    );
    assert.equal(a.messages.filter((m) => m.type === "result").length, 1);
    a.send({
      type: "action",
      id: 2,
      generation: match.generation,
      kind: "forfeit",
      value: 0,
      nonce: 2,
    });
    await wait(() => a.messages.some((m) => m.type === "error" && m.id === 2));
    a.send({ type: "ranked" });
    b.send({ type: "ranked" });
    await wait(
      () =>
        a.lastState()?.generation !== match.generation &&
        a.lastState()?.state.phase === 1,
    );
    const practice = connect();
    clients.push(practice);
    await wait(() => practice.ws.readyState === 1);
    practice.send({ type: "practice" });
    await wait(() => practice.lastState()?.state.phase === 1);
    await wait(() => practice.lastState()?.state.fighters[0].hp < 120);
    const p = practice.lastState();
    practice.send({
      type: "action",
      id: 30,
      generation: p.generation,
      kind: "forfeit",
      value: 0,
      nonce: p.state.fighters[0].nonce + 1,
    });
    await wait(() => practice.lastState()?.state.phase === 2);
  } finally {
    for (const c of clients) c.ws.close();
    child.kill();
  }
});
