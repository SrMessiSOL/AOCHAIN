const $ = (id) => document.getElementById(id),
  canvas = $("arena"),
  ctx = canvas.getContext("2d");
const devnetMode = location.pathname === "/devnet";
const chainMode = location.pathname === "/chain" || devnetMode;
let transport = null;
let latest = null,
  seat = -1,
  selected = false,
  casting = false,
  finishedGeneration = -1,
  pending = false,
  held = null,
  lastMove = 0;
const sprites = await fetch("/sprites.json").then((r) => r.json()),
  images = new Map();
for (const entry of Object.values(sprites)) {
  for (const frame of entry.frames) {
    if (!images.has(frame.file)) {
      const img = new Image();
      img.src = `/graphics/${frame.file}.png`;
      images.set(frame.file, img);
    }
  }
}
function log(message) {
  const line = document.createElement("p");
  line.textContent = message;
  $("events").append(line);
  while ($("events").children.length > 35)
    $("events").firstElementChild.remove();
  $("events").scrollTop = $("events").scrollHeight;
}
const errors = {
  Range:
    "Move closer and face your opponent to strike. Spells reach six tiles.",
  Cooldown: "That action is still cooling down.",
  Countdown: "Wait for the countdown.",
  Mana: "Not enough mana.",
  Bounds: "You cannot leave the arena.",
  Occupied: "Your opponent occupies that tile.",
  Replay: "The arena has refreshed your action state. Try again.",
  Target: "Choose your opponent as the spell target.",
};
async function post(url, body = {}) {
  const started = performance.now();
  if (transport) {
    const result = await transport.post(url, body);
    $("latency").textContent =
      `${url === "/api/join" ? "Pairing request" : "Signed action"} ${Math.round(performance.now() - started)} ms`;
    return result;
  }
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await r.json();
  $("latency").textContent =
    `Action round trip ${Math.round(performance.now() - started)} ms`;
  if (!r.ok)
    throw Error(errors[result.error] || result.error || "Action failed");
  return result;
}
function update(data) {
  if (chainMode && Number.isInteger(data.seat)) seat = data.seat;
  const before = latest;
  latest = data;
  if (chainMode && seat >= 0) {
    $("join").hidden = true;
    $("player").textContent = `Player ${seat + 1}`;
  }
  const d = data.state;
  if (!d) return;
  if (chainMode) {
    $("settlement-status").hidden = false;
    $("settlement-status").textContent =
      data.settlement === "settled"
        ? devnetMode
          ? "Result settled on Solana devnet."
          : "Result settled on the local Solana chain."
        : d.phase === 2
          ? "Match finished. Verifying base-chain settlement…"
          : devnetMode
            ? "Signed actions execute on MagicBlock US devnet."
            : "Signed actions execute on the local MagicBlock runtime.";
    if (sessionStorage.getItem(`aochain:result-dismissed:${data.generation}`))
      finishedGeneration = data.generation;
  }
  if (before?.generation !== data.generation) {
    casting = false;
    selected = false;
    $("result").close();
    log(
      chainMode
        ? d.phase === 0
          ? "On-chain duel ready. Both players must ready up."
          : "Restored the authoritative match state."
        : "New local duel. Both players must ready up.",
    );
  }
  if (before?.state && before.generation === data.generation) {
    d.fighters.forEach((f, i) => {
      const previous = before.state.fighters[i];
      if (f.hp < previous.hp)
        log(`Player ${i + 1} took ${previous.hp - f.hp} damage.`);
    });
  }
  const remaining = Math.max(
    0,
    Math.ceil(((d.starts_at - data.tick) * (data.tickMs || 50)) / 1000),
  );
  $("status").textContent = data.failed
    ? "Rules engine unavailable"
    : d.phase === 2
      ? d.winner === 2
        ? "Draw"
        : `Player ${d.winner + 1} wins`
      : d.phase === 0
        ? "Waiting for both players to ready up"
        : remaining
          ? `Duel begins in ${remaining}`
          : "Duel in progress";
  $("ready").disabled = seat < 0 || d.phase !== 0 || d.ready[seat];
  $("forfeit").disabled = seat < 0 || d.phase === 2;
  $("rematch").hidden = chainMode || seat < 0 || d.phase !== 2;
  $("rematch").disabled = data.rematchVotes.includes(seat);
  $("join").hidden = seat >= 0;
  $("player").textContent = seat < 0 ? "Spectator" : `Player ${seat + 1}`;
  if (seat >= 0) {
    const me = d.fighters[seat];
    $("hp").textContent = `${me.hp} / 120`;
    $("mp").textContent = `${me.mana} / 100`;
    $("health").value = me.hp;
    $("mana").value = me.mana;
  }
  $("spell").setAttribute("aria-pressed", String(selected));
  $("cast").disabled = !selected || seat < 0 || d.phase !== 1 || remaining > 0;
  if (d.phase === 2 && seat >= 0 && finishedGeneration !== data.generation) {
    finishedGeneration = data.generation;
    $("result-title").textContent =
      d.winner === 2
        ? "The duel is a draw."
        : d.winner === seat
          ? "Victory."
          : "Defeat.";
    $("result").showModal();
  }
}
async function action(kind, value = 0) {
  if (pending || seat < 0 || !latest?.state) return;
  pending = true;
  try {
    const result = await post("/api/action", {
      kind,
      value,
      nonce: latest.state.fighters[seat].nonce + 1,
      generation: latest.generation,
    });
    update(result);
  } catch (e) {
    if (e.message !== errors.Cooldown) log(e.message);
  } finally {
    pending = false;
  }
}
$("join").onclick = async () => {
  try {
    const data = await post("/api/join");
    seat = data.seat;
    update(data);
    log(
      `You joined as player ${seat + 1}. Use a different browser or private window for the other player.`,
    );
    canvas.focus();
  } catch (e) {
    log(e.message);
  }
};
$("ready").onclick = () => action("ready");
$("forfeit").onclick = () => {
  held = null;
  $("forfeit-dialog").showModal();
};
$("forfeit-cancel").onclick = () => {
  $("forfeit-dialog").close();
  canvas.focus();
};
$("forfeit-confirm").onclick = () => {
  $("forfeit-dialog").close();
  action("forfeit");
};
$("rematch").onclick = async () => {
  try {
    update(await post("/api/rematch"));
    log("Rematch requested. The other player must agree.");
  } catch (e) {
    log(e.message);
  }
};
$("spell").onclick = () => {
  selected = !selected;
  casting = false;
  update(latest);
};
$("cast").onclick = () => {
  casting = true;
  log("Casting armed. Click your opponent to release Arcane bolt.");
  canvas.focus();
};
$("result-close").onclick = () => {
  if (chainMode && latest)
    sessionStorage.setItem(
      `aochain:result-dismissed:${latest.generation}`,
      "1",
    );
  $("result").close();
  canvas.focus();
};
const headings = {
  w: 1,
  ArrowUp: 1,
  d: 2,
  ArrowRight: 2,
  s: 3,
  ArrowDown: 3,
  a: 4,
  ArrowLeft: 4,
};
window.addEventListener("keydown", (e) => {
  if (
    document.querySelector("dialog[open]") ||
    ["INPUT", "TEXTAREA"].includes(e.target.tagName)
  )
    return;
  if (headings[e.key]) {
    e.preventDefault();
    held = headings[e.key];
  }
  if (e.code === "Space") {
    e.preventDefault();
    if (!e.repeat) action("melee");
  }
  if (e.key === "Escape") {
    casting = false;
    log("Casting cancelled.");
  }
});
window.addEventListener("keyup", (e) => {
  if (headings[e.key] === held) held = null;
});
window.addEventListener("blur", () => {
  held = null;
});
canvas.addEventListener("click", (e) => {
  canvas.focus();
  if (!casting || seat < 0 || !latest?.state) return;
  const rect = canvas.getBoundingClientRect(),
    x = ((e.clientX - rect.left) * canvas.width) / rect.width,
    y = ((e.clientY - rect.top) * canvas.height) / rect.height;
  const target = latest.state.fighters[1 - seat];
  if (
    Math.abs(x - (target.x + 0.5) * 48) < 28 &&
    Math.abs(y - (target.y + 0.5) * 48) < 50
  ) {
    casting = false;
    action("spell", 1 - seat);
  } else
    log(
      "Choose the opposing fighter. Clicking the ground does not move or cast.",
    );
});
function drawSprite(name, x, y, scale, now) {
  const entry = sprites[name],
    frame = entry?.frames[Math.floor(now / 140) % (entry?.frames.length || 1)],
    image = images.get(frame?.file);
  if (!image?.complete || !image.naturalWidth) return;
  ctx.drawImage(
    image,
    frame.x,
    frame.y,
    frame.w,
    frame.h,
    x - (frame.w * scale) / 2,
    y - frame.h * scale,
    frame.w * scale,
    frame.h * scale,
  );
}
function frame(now) {
  ctx.imageSmoothingEnabled = false;
  for (let y = 0; y < 12; y++)
    for (let x = 0; x < 16; x++) {
      ctx.fillStyle =
        x === 0 || y === 0 || x === 15 || y === 11
          ? "#26332d"
          : (x + y) % 2
            ? "#4a4b38"
            : "#454634";
      ctx.fillRect(x * 48, y * 48, 48, 48);
      ctx.strokeStyle = "#ffffff08";
      ctx.strokeRect(x * 48, y * 48, 48, 48);
    }
  if (latest?.state) {
    latest.state.fighters.forEach((f, i) => {
      const x = (f.x + 0.5) * 48,
        y = (f.y + 1) * 48;
      ctx.fillStyle = i === seat ? "#d4b36a55" : "#66a4b655";
      ctx.beginPath();
      ctx.ellipse(x, y - 5, 18, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      drawSprite("body" + f.heading, x, y, 1.5, now);
      drawSprite("head" + f.heading, x, y - 6, 1.5, 0);
      ctx.font = "bold 12px system-ui";
      ctx.textAlign = "center";
      ctx.fillStyle = i === seat ? "#f1d28c" : "#a5d9e9";
      ctx.fillText(`Player ${i + 1}`, x, y - 88);
      ctx.fillStyle = "#12201a";
      ctx.fillRect(x - 24, y - 80, 48, 4);
      ctx.fillStyle = "#71c596";
      ctx.fillRect(x - 24, y - 80, (48 * f.hp) / 120, 4);
    });
    if (
      held &&
      !document.querySelector("dialog[open]") &&
      now - lastMove >= 200 &&
      latest.state.phase === 1 &&
      latest.tick >= latest.state.starts_at &&
      !pending
    ) {
      lastMove = now;
      action("move", held);
    }
  }
  requestAnimationFrame(frame);
}
if (location.pathname === "/devnet") {
  const { startDevnetSetup, createDevnetTransport } =
    await import("/devnet-wallet.bundle.js");
  const stages = {
    waiting:
      "Waiting for another wallet. Use a separate browser session and a different wallet.",
    create:
      "Create the duel and fund a scoped session with 0.01 devnet SOL, plus match rent and fees.",
    join: "Join the duel and fund your scoped session with 0.01 devnet SOL, plus fees.",
    delegate:
      "Both players consented. Approve delegation to MagicBlock US devnet.",
    "waiting-create": "Waiting for player one to create the duel.",
    "waiting-join": "Waiting for player two to approve joining.",
    "waiting-delegate": "Waiting for player one to approve delegation.",
    pending: "Checking the existing transaction. No new signature is needed.",
    active: "Match active on MagicBlock US devnet.",
    finished: "Match finished. Verifying settlement on Solana devnet.",
    error:
      "Connection or operation needs attention. Read the match console; existing transactions are checked before retrying.",
    "account-changed":
      "Wallet account changed. Reconnect the original wallet to recover this match.",
    "connection-lost":
      "Connection interrupted. Gameplay state is being refreshed.",
  };
  startDevnetSetup(
    (wallet, account) => {
      transport?.stop?.();
      transport = createDevnetTransport(
        wallet,
        account,
        update,
        log,
        (step, data, waiting) => {
          update(data);
          if (!data.state) $("status").textContent = stages[step] || step;
          $("match-setup-status").hidden = false;
          $("match-setup-status").textContent = stages[step] || step;
          $("authorize-match").hidden = ![
            "create",
            "join",
            "delegate",
          ].includes(step);
          $("authorize-match").disabled = waiting;
          $("authorize-match").textContent =
            step === "delegate"
              ? "Approve delegation"
              : step === "create"
                ? "Create & authorize session"
                : "Join & authorize session";
        },
      );
      update(transport.start());
    },
    () => {
      transport?.stop?.();
      seat = -1;
      latest = null;
      held = null;
      $("cast").disabled = true;
      $("authorize-match").hidden = true;
      $("ready").disabled = true;
      $("forfeit").disabled = true;
    },
  );
  $("authorize-match").onclick = async () => {
    const b = $("authorize-match");
    b.disabled = true;
    try {
      await transport.authorize();
    } catch (e) {
      log(e.message);
    } finally {
      b.disabled = false;
    }
  };
} else if (chainMode) {
  document.querySelector(".build").textContent =
    "LOCAL MAGICBLOCK · TEST IDENTITIES";
  document.querySelector("footer span:last-child").textContent =
    "MagicBlock-authoritative · measured local slot timing";
  $("join").textContent = "Join local on-chain duel →";
  $("latency").textContent = "Local MagicBlock";
  $("events").textContent =
    "Uses disposable local identities. Open a different browser session for player two. No real wallet or funds.";
  transport = (await import("/chain.bundle.js")).createTransport(update, log);
  update(transport.start());
} else {
  update(
    await fetch("/api/state")
      .then((r) => r.json())
      .then((d) => {
        seat = d.seat;
        return d;
      }),
  );
  const stream = new EventSource("/api/events");
  stream.onmessage = (e) => update(JSON.parse(e.data));
  stream.onerror = () => {
    $("status").textContent = "Reconnecting to the local arena…";
  };
}
requestAnimationFrame(frame);
