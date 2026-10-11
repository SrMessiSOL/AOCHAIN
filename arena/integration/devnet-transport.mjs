import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
} from "@solana/web3.js";
import bs58 from "bs58";
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
import { signDevnetTransaction } from "./wallet-signing.mjs";
const BASE = "https://api.devnet.solana.com",
  ER = "https://devnet-us.magicblock.app";
const VALIDATOR = new PublicKey("MUS3hc9TCw4cGC12vHNoYcCGzJG1txjgQLZWVoeNHNd");
export function lifecycleStep(pairing, info, state) {
  if (!pairing || pairing.players.length !== 2) return "waiting";
  if (!info) return pairing.seat === 0 ? "create" : "waiting-create";
  if (info.owner.equals(PROGRAM) && state.phase === 2) return "finished";
  if (info.owner.equals(PROGRAM) && !state.joined)
    return pairing.seat === 1 ? "join" : "waiting-join";
  if (info.owner.equals(PROGRAM) && state.joined && !state.delegated)
    return pairing.seat === 0 ? "delegate" : "waiting-delegate";
  if (info.owner.equals(DELEGATION)) return "active";
  throw Error(
    "Unexpected match ownership. Pause and inspect the existing match.",
  );
}
export function createDevnetTransport(
  wallet,
  account,
  onUpdate,
  onLog,
  onStage,
) {
  const base = new Connection(BASE, "confirmed"),
    er = new Connection(ER, {
      commitment: "processed",
      wsEndpoint: "wss://devnet-us.magicblock.app",
    });
  const owner = new PublicKey(account.address),
    storageKey = `aochain:devnet:${owner.toBase58()}`;
  const saved = JSON.parse(sessionStorage.getItem(storageKey) || "null");
  const session = saved
    ? Keypair.fromSecretKey(Uint8Array.from(saved.session))
    : Keypair.generate();
  let local = saved || { session: [...session.secretKey] },
    pairing,
    arena,
    current,
    tick = 0,
    step = "waiting",
    busy = false,
    settled = false,
    subscription,
    stopped = false;
  let slotMs = 50,
    lastClock,
    clockBusy = false,
    revision = -1n;
  const timers = [];
  const persist = () =>
    sessionStorage.setItem(storageKey, JSON.stringify(local));
  persist();
  const ownsAccount = () =>
    wallet.accounts.some((a) => a.address === account.address);
  const view = () => ({
    seat: pairing?.seat ?? -1,
    generation: pairing?.id ?? 0,
    rematchVotes: [],
    tick,
    tickMs: slotMs,
    mode: "devnet-magicblock",
    settlement: settled ? "settled" : "pending",
    state: current
      ? {
          ...current,
          fighters: current.fighters.map((f) => ({
            ...f,
            nonce: Number(f.nonce),
          })),
          starts_at: Number(current.startsAt),
        }
      : null,
  });
  function accept(info) {
    if (!info || stopped) return;
    const state = decodeArena(info.data);
    if (state.revision < revision) return;
    revision = state.revision;
    current = state;
    tick = Math.max(tick, Number(state.lastTick));
    onUpdate(view());
  }
  function stage(value) {
    if (stopped) return;
    step = value;
    onStage(value, view(), !!local.pending);
  }
  async function pair() {
    const r = await fetch("/api/pair/devnet", {
      method: "POST",
      // Wallet seats belong to tabs, not the shared browser cookie jar.
      credentials: "omit",
      headers: {
        "Content-Type": "application/json",
        "X-AOChain-Seat": local.token || "",
      },
      body: JSON.stringify({
        owner: owner.toBase58(),
        session: session.publicKey.toBase58(),
      }),
    });
    const data = await r.json();
    if (!r.ok) throw Error(data.error);
    if (local.matchId && local.matchId !== data.id)
      throw Error(
        "The pairing server restarted. Restore or settle the previous match before joining again.",
      );
    pairing = data;
    local.token = data.resumeToken;
    if (data.players.length === 2) {
      local.matchId = data.id;
      arena = arenaAddress(
        new PublicKey(data.players[0].owner),
        BigInt(data.id),
      );
    }
    persist();
  }
  async function reconcile() {
    if (!local.pending) return true;
    const connection = local.pending.network === "base" ? base : er;
    const status = (
      await connection.getSignatureStatuses([local.pending.signature], {
        searchTransactionHistory: true,
      })
    ).value[0];
    if (status?.err) {
      delete local.pending;
      persist();
      throw Error("Transaction rejected. Match state will be refreshed.");
    }
    if (
      status &&
      (connection === er ||
        ["confirmed", "finalized"].includes(status.confirmationStatus))
    ) {
      delete local.pending;
      persist();
      return true;
    }
    if (
      (await connection.getBlockHeight()) > local.pending.lastValidBlockHeight
    ) {
      // Never automatically resend an expired operation. Refresh authority state first.
      delete local.pending;
      persist();
      onLog(
        "Transaction validity expired. Inspect refreshed match state before approving again.",
      );
      return true;
    }
    return false;
  }
  async function send(
    connection,
    signer,
    instructions,
    walletApproval = false,
  ) {
    if (local.pending)
      throw Error(
        "An existing transaction is being checked. Do not sign again yet.",
      );
    if (!ownsAccount())
      throw Error("Wallet account changed. Reconnect before continuing.");
    const block = await connection.getLatestBlockhash();
    const tx = new Transaction({ feePayer: signer.publicKey, ...block }).add(
      ...instructions,
    );
    let raw;
    if (walletApproval) {
      const fee = (
        await connection.getFeeForMessage(tx.compileMessage(), "confirmed")
      ).value;
      const rent =
        step === "create"
          ? await base.getMinimumBalanceForRentExemption(520)
          : 0;
      const topUp = instructions.some((ix) =>
        ix.programId.equals(SystemProgram.programId),
      )
        ? 10_000_000
        : 0;
      if (fee === null || (await base.getBalance(owner)) < rent + topUp + fee)
        throw Error(
          "Not enough devnet SOL for match rent, session funding and transaction fees. Fund this wallet before approving.",
        );
      raw = await signDevnetTransaction(wallet, account, tx);
    } else {
      tx.sign(signer);
      raw = tx.serialize();
    }
    const signed = Transaction.from(raw);
    local.pending = {
      signature: bs58.encode(signed.signature),
      network: connection === base ? "base" : "er",
      lastValidBlockHeight: block.lastValidBlockHeight,
    };
    persist();
    onLog(
      walletApproval
        ? "Wallet approved. Confirming the existing transaction…"
        : "Confirming signed session action…",
    );
    try {
      await connection.sendRawTransaction(raw, { maxRetries: 0 });
    } catch (error) {
      onLog("Submission uncertain. Checking its signature before any retry.");
      throw error;
    }
    for (let i = 0; i < 40; i++) {
      if (await reconcile()) return;
      await new Promise((r) => setTimeout(r, connection === er ? 250 : 1000));
    }
    throw Error(
      "Confirmation is pending. The existing signature will be checked automatically.",
    );
  }
  async function refresh() {
    if (stopped || busy || !pairing) return;
    busy = true;
    try {
      if (!ownsAccount()) {
        stage("account-changed");
        return;
      }
      await pair();
      if (!arena) {
        stage("waiting");
        return;
      }
      const clear = await reconcile();
      const info = await base.getAccountInfo(arena);
      const state = info ? decodeArena(info.data) : undefined;
      const next = lifecycleStep(pairing, info, state);
      stage(clear ? next : "pending");
      if (next === "finished") {
        accept(info);
        settled = settlementComplete(info, current);
        onUpdate(view());
        return;
      }
      if (next === "active") {
        accept(await er.getAccountInfo(arena));
        if (subscription === undefined)
          subscription = er.onAccountChange(arena, accept, "processed");
        if (!clear) return;
        if (current.phase === 2 && !current.settlementRequested) {
          await send(er, session, [settle(session.publicKey, arena)]);
          onLog(
            "Settlement requested. Verifying Solana devnet ownership and result.",
          );
        } else if (current.phase === 1 && BigInt(tick) >= current.expiresAt) {
          await send(er, session, [
            act(
              session.publicKey,
              arena,
              current.fighters[pairing.seat].nonce + 1n,
              5,
            ),
          ]);
        }
      }
    } catch (error) {
      onLog(error.message);
      stage("error");
    } finally {
      busy = false;
    }
  }
  async function clock() {
    if (stopped || clockBusy || step !== "active") return;
    clockBusy = true;
    try {
      tick = await er.getSlot();
      const now = performance.now();
      if (lastClock && tick > lastClock.tick) {
        const sample = (now - lastClock.time) / (tick - lastClock.tick);
        if (sample > 1 && sample < 1000) slotMs = 0.8 * slotMs + 0.2 * sample;
      }
      lastClock = { time: now, tick };
      if (current) onUpdate(view());
    } catch {
      onStage("connection-lost", view(), !!local.pending);
    } finally {
      clockBusy = false;
    }
  }
  return {
    start() {
      timers.push(setInterval(refresh, 3000), setInterval(clock, 500));
      if (local.token)
        pair()
          .then(refresh)
          .catch((e) => {
            onLog(e.message);
            stage("error");
          });
      return view();
    },
    stop() {
      stopped = true;
      timers.forEach(clearInterval);
      if (subscription !== undefined)
        er.removeAccountChangeListener(subscription);
    },
    async authorize() {
      if (stopped)
        throw Error("This session is paused. Reconnect the original wallet.");
      if (busy || local.pending)
        throw Error("Wait for the current operation to finish.");
      busy = true;
      try {
        if (!arena) throw Error("Wait for another wallet to join the pairing.");
        const info = await base.getAccountInfo(arena),
          state = info ? decodeArena(info.data) : undefined;
        step = lifecycleStep(pairing, info, state);
        const ix = [];
        if (step === "create" || step === "join") {
          if ((await base.getBalance(session.publicKey)) < 1_000_000)
            ix.push(
              SystemProgram.transfer({
                fromPubkey: owner,
                toPubkey: session.publicKey,
                lamports: 10_000_000,
              }),
            );
          ix.push(
            step === "create"
              ? create(
                  owner,
                  new PublicKey(pairing.players[1].owner),
                  session.publicKey,
                  BigInt(pairing.id),
                  VALIDATOR,
                )
              : join(owner, arena, session.publicKey),
          );
        } else if (step === "delegate")
          ix.push(delegate(owner, arena, BigInt(pairing.id)));
        else
          throw Error("Match state changed. Wait for the refreshed next step.");
        await send(base, { publicKey: owner }, ix, true);
      } finally {
        busy = false;
        await refresh();
      }
    },
    async post(url, body) {
      if (stopped)
        throw Error("This session is paused. Reconnect the original wallet.");
      if (url === "/api/join") {
        await pair();
        await refresh();
        return view();
      }
      if (
        url !== "/api/action" ||
        busy ||
        local.pending ||
        !current ||
        current.phase === 2
      )
        throw Error(
          "Wait for authoritative match state and pending operations.",
        );
      if (!ownsAccount())
        throw Error("Wallet account changed. Gameplay paused.");
      busy = true;
      try {
        accept(await er.getAccountInfo(arena));
        if (Date.now() / 1000 >= Number(current.sessionExpires))
          throw Error(
            "Session expired. Owner recovery is required; do not create another match.",
          );
        const kind = { ready: 0, move: 1, melee: 2, spell: 3, forfeit: 4 }[
          body.kind
        ];
        if (kind === undefined) throw Error("Unknown action");
        await send(er, session, [
          act(
            session.publicKey,
            arena,
            current.fighters[pairing.seat].nonce + 1n,
            kind,
            body.value || 0,
          ),
        ]);
        accept(await er.getAccountInfo(arena));
        return view();
      } finally {
        busy = false;
      }
    },
  };
}
