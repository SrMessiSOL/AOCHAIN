// Loopback-only local harness. The Rust engine is authoritative; no database,
// wallet, token movement, validator or production account is connected.
import http from "node:http";
import { spawn } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import readline from "node:readline";

const root = fileURLToPath(new URL("../", import.meta.url));
const executable =
  process.env.AOCHAIN_RUNNER ||
  path.join(
    root,
    "target",
    "debug",
    process.platform === "win32"
      ? "aochain-arena-runner.exe"
      : "aochain-arena-runner",
  );
const port = Number(process.env.PORT || 3202);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw Error("Invalid port");
const origin = `http://127.0.0.1:${port}`;
let runner,
  state,
  tick = 0,
  observed = Date.now(),
  generation = 0,
  failed = false;
const seats = [null, null],
  votes = new Set(),
  requests = [];
function boot() {
  generation++;
  failed = false;
  state = null;
  tick = 0;
  votes.clear();
  runner = spawn(executable, [], {
    stdio: ["pipe", "pipe", "inherit"],
    windowsHide: true,
  });
  const own = runner;
  readline.createInterface({ input: runner.stdout }).on("line", (line) => {
    if (own !== runner) return;
    const result = JSON.parse(line);
    state = result.state;
    tick = result.tick;
    observed = Date.now();
    requests.shift()?.(result);
    broadcast();
  });
  runner.on("error", () => {
    failed = true;
    while (requests.length)
      requests.shift()({ error: "Rules engine unavailable" });
  });
  runner.on("exit", () => {
    if (own !== runner) return;
    failed = true;
    while (requests.length)
      requests.shift()({ error: "Rules engine unavailable" });
    broadcast();
  });
  runner.stdin.write(
    JSON.stringify({ actor: 0, nonce: 0, kind: "snapshot" }) + "\n",
  );
}
function execute(command) {
  return new Promise((resolve) => {
    if (failed) return resolve({ error: "Rules engine unavailable" });
    requests.push(resolve);
    runner.stdin.write(JSON.stringify(command) + "\n");
  });
}
function snapshot() {
  return {
    state,
    tick: tick + Math.floor((Date.now() - observed) / 50),
    generation,
    seats: seats.map(Boolean),
    rematchVotes: [...votes],
    mode: "local-rust-harness",
    failed,
  };
}
const streams = new Set();
function broadcast() {
  const message = `data: ${JSON.stringify(snapshot())}\n\n`;
  for (const res of streams) res.write(message);
}
function tokenOf(req) {
  return /(?:^|;\s*)aochain-arena=([a-f0-9]{64})(?:;|$)/.exec(
    req.headers.cookie || "",
  )?.[1];
}
function seatOf(req) {
  const token = tokenOf(req);
  if (!token) return -1;
  return seats.findIndex(
    (s) => s && timingSafeEqual(Buffer.from(s.token), Buffer.from(token)),
  );
}
function json(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}
async function body(req) {
  let text = "";
  for await (const part of req) {
    text += part;
    if (text.length > 512) throw Error("Request too large");
  }
  return JSON.parse(text || "{}");
}
const budget = new Map();
const server = http.createServer(async (req, res) => {
  try {
    if (req.headers.host !== `127.0.0.1:${port}`)
      return json(res, 403, {
        error: "Use the loopback URL shown by the launcher",
      });
    const url = new URL(req.url, origin);
    const seat = seatOf(req);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'",
    );
    if (req.method === "GET" && url.pathname === "/api/state")
      return json(res, 200, { ...snapshot(), seat });
    if (req.method === "GET" && url.pathname === "/api/events") {
      if (streams.size >= 8)
        return json(res, 429, { error: "Too many local viewers" });
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store",
        Connection: "keep-alive",
      });
      streams.add(res);
      res.write(`data: ${JSON.stringify(snapshot())}\n\n`);
      req.on("close", () => streams.delete(res));
      return;
    }
    if (req.method === "POST") {
      if (
        req.headers.origin !== origin ||
        req.headers["content-type"] !== "application/json"
      )
        return json(res, 403, { error: "Invalid origin" });
      if (url.pathname === "/api/join") {
        if (seat >= 0) return json(res, 200, { seat, ...snapshot() });
        const free = seats.findIndex((s) => !s);
        if (free < 0)
          return json(res, 409, {
            error:
              "Both seats are occupied. Open the second player link or restart the local lab.",
          });
        const token = randomBytes(32).toString("hex");
        seats[free] = { token };
        res.setHeader(
          "Set-Cookie",
          `aochain-arena=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=7200`,
        );
        broadcast();
        return json(res, 200, { seat: free, ...snapshot() });
      }
      if (seat < 0) return json(res, 401, { error: "Join the arena first" });
      const now = Date.now(),
        entry = budget.get(seat);
      if (entry && now - entry.start < 1000 && entry.count >= 25)
        return json(res, 429, { error: "Too many actions" });
      budget.set(
        seat,
        entry && now - entry.start < 1000
          ? { ...entry, count: entry.count + 1 }
          : { start: now, count: 1 },
      );
      const input = await body(req);
      if (url.pathname === "/api/rematch") {
        if (state?.phase !== 2)
          return json(res, 409, { error: "Finish this match first" });
        votes.add(seat);
        if (votes.size === 2) {
          const old = runner;
          runner = null;
          old.kill();
          boot();
        } else broadcast();
        return json(res, 200, snapshot());
      }
      if (url.pathname === "/api/action") {
        if (
          Object.keys(input).some(
            (k) => !["nonce", "kind", "value", "generation"].includes(k),
          ) ||
          !Number.isSafeInteger(input.nonce) ||
          input.nonce < 1 ||
          !["ready", "move", "melee", "spell", "forfeit"].includes(
            input.kind,
          ) ||
          !Number.isInteger(input.value ?? 0) ||
          (input.value ?? 0) < 0 ||
          (input.value ?? 0) > 255 ||
          input.generation !== generation
        )
          return json(res, 400, { error: "Invalid or stale action" });
        const result = await execute({
          actor: seat,
          nonce: input.nonce,
          kind: input.kind,
          value: input.value ?? 0,
        });
        return json(res, result.error ? 409 : 200, {
          ...result,
          ...snapshot(),
        });
      }
      return json(res, 404, { error: "Not found" });
    }
    if (req.method !== "GET")
      return json(res, 405, { error: "Method not allowed" });
    if (url.pathname === "/devnet-wallet.bundle.js") {
      const content = await readFile(
        path.join(root, "work", "devnet-wallet.bundle.js"),
      );
      res.writeHead(200, { "Content-Type": "text/javascript" });
      return res.end(content);
    }
    const files = {
      "/": "index.html",
      "/arena.js": "arena.js",
      "/arena.css": "arena.css",
      "/sprites.json": "sprites.json",
    };
    if (files[url.pathname]) {
      const content = await readFile(
        path.join(root, "web", files[url.pathname]),
      );
      res.writeHead(200, {
        "Content-Type": url.pathname.endsWith(".js")
          ? "text/javascript"
          : url.pathname.endsWith(".css")
            ? "text/css"
            : url.pathname.endsWith(".json")
              ? "application/json"
              : "text/html",
      });
      return res.end(content);
    }
    const graphic = /^\/graphics\/(\d+)\.png$/.exec(url.pathname);
    if (graphic) {
      const content = await readFile(
        path.resolve(root, "../frontend/public/graphics", `${graphic[1]}.png`),
      );
      res.writeHead(200, {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=3600",
      });
      return res.end(content);
    }
    json(res, 404, { error: "Not found" });
  } catch {
    if (!res.headersSent)
      json(res, 400, { error: "Invalid request or missing local asset" });
    else res.end();
  }
});
const heartbeat = setInterval(() => {
  broadcast();
  if (
    state?.phase === 1 &&
    snapshot().tick >= state.expires_at &&
    requests.length === 0
  )
    execute({
      actor: 0,
      nonce: state.fighters[0].nonce + 1,
      kind: "timeout",
      value: 0,
    });
}, 250);
boot();
server.listen(port, "127.0.0.1", () =>
  console.log(
    `AOCHAIN local rules lab: ${origin}\nNo blockchain or wallet connected. Use two independent browser sessions.`,
  ),
);
function stop() {
  clearInterval(heartbeat);
  for (const res of streams) res.end();
  runner?.kill();
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
