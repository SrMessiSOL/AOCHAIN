import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import {
  PROGRAM,
  DELEGATION,
  arenaAddress,
  create,
  join,
  delegate,
  act,
  settle,
  decodeArena,
  settlementComplete,
} from "./client.mjs";

// Local-only generated test identity. Never connect a real wallet to this lab.
export function createTransport(onUpdate, onLog) {
  const base = new Connection("http://127.0.0.1:8899", "confirmed");
  const er = new Connection("http://127.0.0.1:7799", "processed");
  let owner,
    session,
    pairing,
    arena,
    seat = -1,
    current,
    busy = false,
    settled = false,
    subscription;
  let tick = 0,
    slotMs = 50,
    lastClock,
    lastRevision = -1n,
    lastError,
    committing = false,
    waitingLogged = false;
  const kind = { ready: 0, move: 1, melee: 2, spell: 3, forfeit: 4 };
  function restore() {
    const saved = sessionStorage.getItem("aochain:local-test-identity");
    if (saved) {
      const data = JSON.parse(saved);
      owner = Keypair.fromSecretKey(Uint8Array.from(data.owner));
      session = Keypair.fromSecretKey(Uint8Array.from(data.session));
    } else {
      owner = Keypair.generate();
      session = Keypair.generate();
      sessionStorage.setItem(
        "aochain:local-test-identity",
        JSON.stringify({
          owner: [...owner.secretKey],
          session: [...session.secretKey],
        }),
      );
    }
  }
  async function pairPost() {
    const response = await fetch("/api/pair", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AOChain-Seat": sessionStorage.getItem("aochain:local-seat") || "",
      },
      body: JSON.stringify({
        owner: owner.publicKey.toBase58(),
        session: session.publicKey.toBase58(),
      }),
    });
    const data = await response.json();
    if (!response.ok) throw Error(data.error);
    sessionStorage.setItem("aochain:local-seat", data.resumeToken);
    if (pairing && pairing.id !== data.id) {
      if (subscription !== undefined)
        await er.removeAccountChangeListener(subscription);
      subscription = undefined;
      current = undefined;
      lastRevision = -1n;
      settled = false;
      committing = false;
      arena = undefined;
    }
    seat = data.seat;
    pairing = data;
    if (pairing.players.length === 2)
      arena = arenaAddress(
        new PublicKey(pairing.players[0].owner),
        BigInt(pairing.id),
      );
  }
  function snapshot() {
    if (!current)
      return {
        state: null,
        seat,
        generation: pairing?.id || 0,
        rematchVotes: [],
        tick,
        tickMs: slotMs,
        mode: "local-magicblock",
      };
    const fighters = current.fighters.map((f) => ({
      ...f,
      nonce: Number(f.nonce),
    }));
    return {
      state: { ...current, fighters, starts_at: Number(current.startsAt) },
      seat,
      generation: pairing.id,
      rematchVotes: [],
      tick,
      tickMs: slotMs,
      mode: "local-magicblock",
      settlement: settled ? "settled" : committing ? "pending" : "none",
    };
  }
  function accept(info) {
    if (!info) return;
    const state = decodeArena(info.data);
    if (state.revision < lastRevision) return;
    tick = Math.max(tick, Number(state.lastTick));
    lastRevision = state.revision;
    current = state;
    onUpdate(snapshot());
  }
  async function send(connection, signer, instruction) {
    const block = await connection.getLatestBlockhash();
    const tx = new Transaction({ feePayer: signer.publicKey, ...block }).add(
      instruction,
    );
    tx.sign(signer);
    const signature = await connection.sendRawTransaction(tx.serialize(), {
      maxRetries: 0,
    });
    const result = await connection.confirmTransaction(
      { signature, ...block },
      connection === er ? "processed" : "confirmed",
    );
    if (result.value.err)
      throw Error(
        "The validator rejected this action. State has been refreshed.",
      );
    return signature;
  }
  async function fund(signer) {
    if ((await base.getBalance(signer.publicKey)) < 100_000_000) {
      const signature = await base.requestAirdrop(
        signer.publicKey,
        2_000_000_000,
      );
      await base.confirmTransaction(signature, "confirmed");
    }
  }
  async function progress() {
    if (!owner || busy) return;
    busy = true;
    try {
      await pairPost();
      if (!arena) {
        if (!waitingLogged)
          onLog("Waiting for player two in a different browser session.");
        waitingLogged = true;
        return;
      }
      let info = await base.getAccountInfo(arena);
      if (!info && seat === 0) {
        await fund(owner);
        await fund(session);
        await send(
          base,
          owner,
          create(
            owner.publicKey,
            new PublicKey(pairing.players[1].owner),
            session.publicKey,
            BigInt(pairing.id),
          ),
        );
        onLog("Match created on the local Solana chain.");
        return;
      }
      if (!info) return;
      const state = decodeArena(info.data);
      if (info.owner.equals(PROGRAM) && !state.delegated) {
        if (!state.joined && seat === 1) {
          await fund(owner);
          await fund(session);
          await send(
            base,
            owner,
            join(owner.publicKey, arena, session.publicKey),
          );
          onLog("Player two joined on chain.");
        } else if (state.joined && seat === 0) {
          await send(
            base,
            owner,
            delegate(owner.publicKey, arena, BigInt(pairing.id)),
          );
          onLog("Match delegated to MagicBlock.");
        }
        return;
      }
      if (info.owner.equals(DELEGATION)) {
        accept(await er.getAccountInfo(arena));
        if (subscription === undefined)
          subscription = er.onAccountChange(arena, accept, "processed");
      }
      if (
        info.owner.equals(PROGRAM) &&
        state.phase === 2 &&
        state.settlementRequested
      )
        accept(info);
      if (current?.phase === 2 && !settled) {
        if (settlementComplete(info, current)) {
          settled = true;
          onLog("Result settled on the local Solana chain.");
          onUpdate(snapshot());
        } else if (!committing && seat === 0 && !current.settlementRequested) {
          committing = true;
          await send(er, owner, settle(owner.publicKey, arena));
          onLog(
            "Settlement submitted. Checking restored base-chain ownership…",
          );
        }
      }
    } catch (error) {
      if (error.message !== lastError) {
        lastError = error.message;
        onLog(error.message);
      }
    } finally {
      busy = false;
    }
  }
  async function clock() {
    try {
      tick = await er.getSlot("processed");
      const now = performance.now();
      if (lastClock && tick > lastClock.tick) {
        const sample = (now - lastClock.now) / (tick - lastClock.tick);
        if (sample > 1 && sample < 1000) slotMs = slotMs * 0.8 + sample * 0.2;
      }
      lastClock = { tick, now };
      if (current) onUpdate(snapshot());
    } catch {
      /* Lifecycle polling reports validator availability. */
    }
  }
  return {
    async post(url, body) {
      if (url === "/api/join") {
        restore();
        await pairPost();
        onLog(
          "Local test identity ready. Keys stay in this tab; no wallet funds are used.",
        );
        await progress();
        return snapshot();
      }
      if (url === "/api/rematch")
        throw Error(
          "Start a fresh pairing by restarting the local chain web server. Rematch is not integrated yet.",
        );
      if (!arena || !current || busy || current.phase === 2)
        throw Error("Wait for the on-chain match to be ready.");
      busy = true;
      try {
        const info = await er.getAccountInfo(arena);
        accept(info);
        const nonce = current.fighters[seat].nonce + 1n;
        await send(
          er,
          session,
          act(
            session.publicKey,
            arena,
            nonce,
            kind[body.kind],
            body.value || 0,
          ),
        );
        accept(await er.getAccountInfo(arena));
        return snapshot();
      } finally {
        busy = false;
      }
    },
    start() {
      if (sessionStorage.getItem("aochain:local-test-identity")) {
        restore();
        progress();
      }
      setInterval(progress, 1000);
      setInterval(clock, 250);
      return snapshot();
    },
  };
}
