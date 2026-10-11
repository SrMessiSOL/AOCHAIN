// Static web + public pairing only. No keys, combat simulation or RPC signing.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
const port = Number(process.env.PORT || 3203);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw Error("Invalid local port");
const origin = `http://127.0.0.1:${port}`;
const players = [null, null],
  id = Date.now();
const json = (res, status, data) => {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
};
const files = {
  "/chain": ["../web/index.html", "text/html"],
  "/arena.js": ["../web/arena.js", "text/javascript"],
  "/arena.css": ["../web/arena.css", "text/css"],
  "/sprites.json": ["../web/sprites.json", "application/json"],
  "/chain.bundle.js": ["../work/chain.bundle.js", "text/javascript"],
};
const server = http.createServer(async (req, res) => {
  try {
    if (req.headers.host !== `127.0.0.1:${port}`)
      return json(res, 403, { error: "Invalid host" });
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; connect-src 'self' http://127.0.0.1:8899 http://127.0.0.1:7799 ws://127.0.0.1:8900 ws://127.0.0.1:7800; frame-ancestors 'none'",
    );
    const url = new URL(req.url, origin);
    if (req.method === "POST" && url.pathname === "/api/pair") {
      if (
        req.headers.origin !== origin ||
        req.headers["content-type"] !== "application/json"
      )
        return json(res, 403, { error: "Invalid origin or content type" });
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (Buffer.byteLength(body) > 512)
          return json(res, 413, { error: "Pairing request too large" });
      }
      const input = JSON.parse(body);
      if (
        Object.keys(input).some((k) => !["owner", "session"].includes(k)) ||
        typeof input.owner !== "string" ||
        typeof input.session !== "string"
      )
        return json(res, 400, { error: "Invalid pairing" });
      new PublicKey(input.owner);
      new PublicKey(input.session);
      const cookieValue = /(?:^|;\s*)aochain-chain=([a-f0-9]{64})(?:;|$)/.exec(
        req.headers.cookie || "",
      )?.[1];
      const resumeHeader = req.headers["x-aochain-seat"];
      const cookie =
        cookieValue ||
        (typeof resumeHeader === "string" && /^[a-f0-9]{64}$/.test(resumeHeader)
          ? resumeHeader
          : undefined);
      let seat = players.findIndex((p) => p?.cookie === cookie && cookie);
      if (seat < 0) {
        seat = players.findIndex((p) => p === null);
        if (seat < 0)
          return json(res, 409, {
            error:
              "Both local test seats are occupied. Restart the chain web server for a fresh match.",
          });
        if (
          players.some(
            (p) =>
              p && (p.owner === input.owner || p.session === input.session),
          )
        )
          return json(res, 409, {
            error: "Use a separate browser identity for player two",
          });
        players[seat] = { ...input, cookie: randomBytes(32).toString("hex") };
      } else if (
        players[seat].owner !== input.owner ||
        players[seat].session !== input.session
      )
        return json(res, 409, {
          error: "This seat belongs to another local test identity",
        });
      res.setHeader(
        "Set-Cookie",
        `aochain-chain=${players[seat].cookie}; HttpOnly; SameSite=Strict; Path=/`,
      );
      return json(res, 200, {
        id,
        seat,
        resumeToken: players[seat].cookie,
        players: players
          .filter(Boolean)
          .map(({ owner, session }) => ({ owner, session })),
      });
    }
    if (req.method !== "GET")
      return json(res, 405, { error: "Method not allowed" });
    if (url.pathname === "/") {
      res.writeHead(302, { Location: "/chain" });
      return res.end();
    }
    const graphic = /^\/graphics\/(\d+)\.png$/.exec(url.pathname);
    const file =
      files[url.pathname] ||
      (graphic && [
        `../../frontend/public/graphics/${graphic[1]}.png`,
        "image/png",
      ]);
    if (!file) return json(res, 404, { error: "Not found" });
    const content = await readFile(new URL(file[0], import.meta.url));
    res.writeHead(200, {
      "Content-Type": file[1],
      "Cache-Control": "no-store",
    });
    res.end(content);
  } catch {
    json(res, 400, { error: "Invalid request or unavailable local build" });
  }
});
server.listen(port, "127.0.0.1", () =>
  console.log("Local chain browser: " + origin + "/chain"),
);
