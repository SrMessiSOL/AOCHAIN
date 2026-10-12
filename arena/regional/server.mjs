// Realtime combat only. This server has no Solana signing or mint authority.
import http from "node:http";
import { WebSocketServer } from "ws";
import { spawn } from "node:child_process";
import { randomUUID, randomBytes, createHmac } from "node:crypto";
import { readFile, mkdir, open } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import readline from "node:readline";
import { eligible, latencyScore, verifyAdmission } from "./policy.mjs";
const root = new URL("../", import.meta.url);
const port = Number(process.env.PORT || 3210),
  host = process.env.HOST || "127.0.0.1";
const region = process.env.REGION_ID || "local";
const origin = process.env.PUBLIC_ORIGIN || `http://127.0.0.1:${port}`;
const demo = process.env.AOCHAIN_DEMO === "1";
const secret = process.env.ASSET_ADMISSION_SECRET;
const allowedOrigins = new Set([
  origin,
  ...(process.env.PORTAL_ORIGINS || "").split(",").filter(Boolean),
]);
const regionDirectory = process.env.REGIONS_JSON
  ? JSON.parse(process.env.REGIONS_JSON)
  : [{ id: region, url: origin, available: true }];
for (const entry of regionDirectory) {
  if (
    entry.available &&
    (!entry.id || !["http:", "https:"].includes(new URL(entry.url).protocol))
  )
    throw Error("Invalid region directory");
}
const connectSources = [
  "'self'",
  ...regionDirectory
    .filter((r) => r.available)
    .flatMap((r) => {
      const u = new URL(r.url);
      const ws = new URL(u);
      ws.protocol = u.protocol === "https:" ? "wss:" : "ws:";
      return [u.origin, ws.origin];
    }),
].join(" ");
if (
  !Number.isInteger(port) ||
  port < 1024 ||
  port > 65535 ||
  (!demo && (!secret || secret.length < 32))
)
  throw Error(
    "Configure regional port and asset admission secret, or explicit demo mode",
  );
if (demo && host !== "127.0.0.1")
  throw Error("Demo identities are restricted to loopback");
const executable =
  process.env.AOCHAIN_RUNNER ||
  fileURLToPath(
    new URL(
      `target/debug/aochain-arena-runner${process.platform === "win32" ? ".exe" : ""}`,
      root,
    ),
  );
const players = new Set(),
  queue = [],
  matches = new Set(),
  usedTickets = new Map(),
  activeCharacters = new Map();
const output = new URL("work/regional-results.jsonl", root);
await mkdir(new URL("work/", root), { recursive: true });
const send = (player, body) => {
  if (player.ws.readyState === 1 && player.ws.bufferedAmount < 65536)
    player.ws.send(JSON.stringify(body));
};
function waiting(p, reason) {
  send(p, {
    type: "queue",
    reason,
    region,
    ping: Number.isFinite(latencyScore(p.samples, Date.now()))
      ? Math.round(latencyScore(p.samples, Date.now()))
      : null,
  });
}
function dequeue(p) {
  const i = queue.indexOf(p);
  if (i >= 0) queue.splice(i, 1);
}
function matchmake() {
  const now = Date.now();
  for (const p of queue)
    waiting(
      p,
      eligible(p, now)
        ? "Waiting for an opponent below 100 ms in this region."
        : "Measuring latency or waiting for ping below 100 ms.",
    );
  const candidates = queue.filter((p) => eligible(p, now));
  while (candidates.length >= 2) {
    const a = candidates.shift();
    const index = candidates.findIndex(
      (b) => !a.claims?.wallet || a.claims.wallet !== b.claims?.wallet,
    );
    if (index < 0) continue;
    const b = candidates.splice(index, 1)[0];
    dequeue(a);
    dequeue(b);
    startMatch(a, b);
  }
}
function startMatch(a, b) {
  const match = {
    id: randomUUID(),
    players: [a, b],
    state: null,
    tick: 0,
    observed: Date.now(),
    commands: [],
    finished: false,
    persisted: false,
  };
  matches.add(match);
  for (const [seat, p] of match.players.entries()) {
    p.match = match;
    p.seat = seat;
  }
  const runner = spawn(executable, [], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  match.runner = runner;
  const snapshot = (p) => ({
    type: "state",
    seat: p.seat,
    generation: match.id,
    state: match.state,
    tick: match.tick + Math.floor((Date.now() - match.observed) / 50),
    tickMs: 50,
    rematchVotes: [],
    mode: "regional-offchain",
    practice: !!match.players[1].bot,
    region,
  });
  match.broadcast = () => match.players.forEach((p) => send(p, snapshot(p)));
  match.execute = (command) =>
    new Promise((resolve, reject) => {
      if (match.failed) return reject(Error("Combat engine unavailable"));
      match.commands.push({ resolve, reject });
      runner.stdin.write(JSON.stringify(command) + "\n");
    });
  const failure = () => {
    match.failed = true;
    for (const command of match.commands.splice(0))
      command.reject(Error("Combat engine unavailable"));
    match.players.forEach((p) =>
      send(p, {
        type: "error",
        message:
          "Match interrupted. Assets remain locked until recovery; no reward awarded.",
      }),
    );
  };
  runner.on("error", failure);
  runner.on("exit", () => {
    if (!match.finished) failure();
  });
  readline.createInterface({ input: runner.stdout }).on("line", (line) => {
    let result;
    try {
      result = JSON.parse(line);
    } catch {
      return failure();
    }
    match.state = result.state;
    match.tick = result.tick;
    match.observed = Date.now();
    match.commands.shift()?.resolve(result);
    match.broadcast();
    if (result.state.phase === 2 && !match.finished) {
      match.finished = true;
      const receipt = {
        version: 1,
        matchId: match.id,
        region,
        finishedAt: Date.now(),
        winner: result.state.winner,
        players: match.players.map((p) => p.claims || { demo: true }),
        state: result.state,
        settlement: "awaiting-asset-service",
        demo,
      };
      // Append once, before advertising a final result. No rewards are paid by this server.
      (async () => {
        const encoded = JSON.stringify(receipt);
        const record = {
          receipt,
          signature: secret
            ? createHmac("sha256", secret).update(encoded).digest("hex")
            : null,
        };
        const handle = await open(output, "a", 0o600);
        try {
          await handle.writeFile(JSON.stringify(record) + "\n");
          await handle.sync();
        } finally {
          await handle.close();
        }
      })()
        .then(() => {
          match.persisted = true;
          match.players.forEach((p) =>
            send(p, {
              type: "result",
              matchId: match.id,
              receiptStatus: "recorded",
              rewardsEnabled: false,
            }),
          );
        })
        .catch(() =>
          match.players.forEach((p) =>
            send(p, {
              type: "error",
              message:
                "Result persistence failed. Assets remain locked for recovery.",
            }),
          ),
        );
    }
  });
  match
    .execute({ actor: 0, nonce: 0, kind: "snapshot" })
    .then(async () => {
      await match.execute({ actor: 0, nonce: 1, kind: "ready" });
      await match.execute({ actor: 1, nonce: 1, kind: "ready" });
    })
    .catch(failure);
}
const server = http.createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, origin).pathname;
    const json = (body) => {
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(body));
    };
    if (req.method !== "GET") {
      res.writeHead(405);
      return res.end();
    }
    if (pathname === "/health")
      return json({
        region,
        queue: queue.length,
        matches: [...matches].filter((m) => !m.finished).length,
        demo,
      });
    if (pathname === "/regions.json") return json(regionDirectory);
    const files = {
      "/": "web/index.html",
      "/ranked": "web/index.html",
      "/arena.js": "web/arena.js",
      "/arena.css": "web/arena.css",
      "/sprites.json": "web/sprites.json",
      "/regional-transport.mjs": "regional/transport.mjs",
      "/region-selection.mjs": "regional/region-selection.mjs",
      "/devnet-wallet.bundle.js": "work/devnet-wallet.bundle.js",
    };
    const graphics = /^\/graphics\/(\d+)\.png$/.exec(pathname);
    const file = files[pathname];
    if (!file && !graphics) {
      res.writeHead(404);
      return res.end();
    }
    const content = await readFile(
      graphics
        ? new URL(`../frontend/public/graphics/${graphics[1]}.png`, root)
        : new URL(file, root),
    );
    res.writeHead(200, {
      "Content-Type": graphics
        ? "image/png"
        : pathname.endsWith(".css")
          ? "text/css"
          : pathname.endsWith(".json")
            ? "application/json"
            : pathname.endsWith(".js") || pathname.endsWith(".mjs")
              ? "text/javascript"
              : "text/html",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": `default-src 'self'; connect-src ${connectSources}; frame-ancestors 'none'`,
    });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
const wss = new WebSocketServer({
  noServer: true,
  maxPayload: 2048,
  perMessageDeflate: false,
});
server.on("upgrade", (req, socket, head) => {
  if (
    !allowedOrigins.has(req.headers.origin) ||
    req.url !== "/realtime" ||
    players.size >= 200
  )
    return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws));
});
wss.on("connection", (ws) => {
  const p = {
    ws,
    samples: [],
    ping: null,
    claims: null,
    match: null,
    budget: 0,
    start: Date.now(),
    inflight: false,
  };
  players.add(p);
  send(p, { type: "hello", region, demo, limit: 100 });
  const ping = () => {
    if (p.ping && Date.now() - p.ping.at < 3000) return;
    p.ping = {
      id: randomBytes(12).toString("hex"),
      at: Date.now(),
      started: performance.now(),
    };
    if (ws.readyState === 1) ws.ping(p.ping.id);
  };
  ws.on("pong", (payload) => {
    if (payload.toString() !== p.ping?.id) return;
    const ms = performance.now() - p.ping.started;
    p.ping = null;
    p.samples.push({ ms, at: Date.now() });
    p.samples = p.samples.slice(-20);
    send(p, {
      type: "latency",
      ping: Math.round(latencyScore(p.samples, Date.now())),
      region,
    });
    matchmake();
  });
  const timer = setInterval(ping, 500);
  ping();
  ws.on("message", async (raw) => {
    try {
      if (Date.now() - p.start >= 1000) {
        p.start = Date.now();
        p.budget = 0;
      }
      if (++p.budget > 40) throw Error("Input rate exceeded");
      const message = JSON.parse(raw);
      if (message.type === "cancel") {
        dequeue(p);
        waiting(p, "Queue cancelled.");
        return;
      }
      if (message.type === "practice") {
        if (!demo) throw Error("PvE asset admission is not enabled.");
        if (p.match && (!p.match.finished || !p.match.persisted))
          throw Error("Finish the previous match first.");
        dequeue(p);
        const bot = {
          ws: { readyState: 0 },
          claims: null,
          samples: [],
          bot: true,
        };
        startMatch(p, bot);
        return;
      }
      if (message.type === "ranked") {
        if (p.match) {
          if (!p.match.finished || !p.match.persisted)
            throw Error("Previous result still pending");
          if (!demo)
            throw Error("Request a new asset admission after settlement");
          p.match = null;
        }
        if (!demo && !p.claims) {
          const claims = verifyAdmission(message.ticket, secret, region);
          if (
            usedTickets.has(claims.ticketId) ||
            activeCharacters.has(claims.character)
          )
            throw Error("Character or ticket already active");
          usedTickets.set(claims.ticketId, claims.expires);
          activeCharacters.set(claims.character, p);
          p.claims = claims;
        }
        if (!queue.includes(p)) queue.push(p);
        matchmake();
        return;
      }
      if (message.type === "action") {
        const match = p.match;
        if (
          !match ||
          match.finished ||
          p.inflight ||
          message.generation !== match.id ||
          !["move", "melee", "spell", "forfeit"].includes(message.kind) ||
          !Number.isSafeInteger(message.nonce) ||
          !Number.isInteger(message.value) ||
          message.value < 0 ||
          message.value > 255
        )
          throw Error("Invalid, stale or overlapping action");
        p.inflight = true;
        try {
          const result = await match.execute({
            actor: p.seat,
            nonce: message.nonce,
            kind: message.kind,
            value: message.value,
          });
          send(p, { type: "ack", id: message.id, error: result.error });
        } finally {
          p.inflight = false;
        }
        return;
      }
      throw Error("Unknown message");
    } catch (error) {
      send(p, {
        type: "error",
        id: (() => {
          try {
            return JSON.parse(raw).id;
          } catch {
            return undefined;
          }
        })(),
        message: error.message,
      });
    }
  });
  ws.on("close", () => {
    clearInterval(timer);
    dequeue(p);
    players.delete(p);
    const m = p.match;
    if (m && !m.finished && m.state)
      m.execute({
        actor: p.seat,
        nonce: m.state.fighters[p.seat].nonce + 1,
        kind: "forfeit",
        value: 0,
      }).catch(() => {});
  });
});
const heartbeat = setInterval(() => {
  matchmake();
  for (const m of matches) {
    if (m.state && !m.finished) {
      m.broadcast();
      const bot = m.players[1];
      const nowTick = m.tick + Math.floor((Date.now() - m.observed) / 50);
      if (
        bot.bot &&
        m.state.phase === 1 &&
        nowTick >= m.state.starts_at &&
        !m.commands.length
      ) {
        const me = m.state.fighters[1],
          enemy = m.state.fighters[0];
        const dx = enemy.x - me.x,
          dy = enemy.y - me.y;
        const heading =
          Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 2 : 4) : dy > 0 ? 3 : 1;
        let kind, value;
        if (
          Math.abs(dx) + Math.abs(dy) === 1 &&
          me.heading === heading &&
          nowTick >= me.melee_at
        ) {
          kind = "melee";
          value = 0;
        } else if (
          Math.max(Math.abs(dx), Math.abs(dy)) <= 6 &&
          me.mana >= 20 &&
          nowTick >= me.spell_at
        ) {
          kind = "spell";
          value = 0;
        } else if (nowTick >= me.move_at) {
          kind = "move";
          value = heading;
        }
        if (kind)
          m.execute({ actor: 1, nonce: me.nonce + 1, kind, value }).catch(
            () => {},
          );
      }
      if (
        m.state.phase === 1 &&
        m.tick + Math.floor((Date.now() - m.observed) / 50) >=
          m.state.expires_at &&
        m.commands.length === 0
      )
        m.execute({
          actor: 0,
          nonce: m.state.fighters[0].nonce + 1,
          kind: "timeout",
          value: 0,
        }).catch(() => {});
    }
    if (m.finished && m.persisted && Date.now() - m.observed > 60000) {
      m.runner.kill();
      matches.delete(m);
    }
  }
}, 100);
server.listen(port, host, () =>
  console.log(
    `Regional ranked ${region}: ${origin}/ranked (${demo ? "DEMO — no assets or rewards" : "verified asset admission required"})`,
  ),
);
function stop() {
  clearInterval(heartbeat);
  for (const p of players) p.ws.close();
  for (const m of matches) m.runner.kill();
  server.close();
}
process.on("SIGINT", () => {
  stop();
  process.exit(0);
});
process.on("SIGTERM", () => {
  stop();
  process.exit(0);
});
