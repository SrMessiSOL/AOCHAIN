import {
  predictMovement,
  reconcileMovement,
  queueIntent,
} from "/devnet-wallet.bundle.js";
const $ = (id) => document.getElementById(id),
  canvas = $("arena"),
  ctx = canvas.getContext("2d");
const devnetMode = location.pathname === "/devnet";
const regionalMode = location.pathname === "/ranked";
const pvpData = regionalMode
  ? await fetch("/pvp-data.json").then((r) => r.json())
  : null;
const chainMode = location.pathname === "/chain" || devnetMode;
let transport = null;
let regionalDemo = false;
const savedMatches = new Set();
const renderedFighters = new Map();
let predictedMovement = null;
let selectedSpell = 2,
  bookKey = "";
let queuedIntent = null;
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
      `${url === "/api/join" ? "Queue request" : regionalMode ? "Realtime action" : "Signed action"} ${Math.round(performance.now() - started)} ms`;
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
  if (regionalMode && Number.isInteger(data.seat)) seat = data.seat;
  if (chainMode && Number.isInteger(data.seat)) seat = data.seat;
  const before = latest;
  latest = data;
  predictedMovement = reconcileMovement(
    predictedMovement,
    data,
    performance.now(),
  );
  if (chainMode && seat >= 0) {
    $("join").hidden = true;
    $("player").textContent = `Player ${seat + 1}`;
  }
  const d = data.state;
  if (!d) return;
  if (regionalMode) {
    document.querySelector(".intro").hidden = true;
    document.body.classList.add("ranked-playing");
    $("ranked-lobby").hidden = true;
    document.querySelector(".arena-layout").hidden = false;
    $("ready").hidden = true;
    $("rematch").textContent = data.practice
      ? "Practice again"
      : "Play ranked again";
    $("settlement-status").hidden = false;
    $("settlement-status").textContent = regionalDemo
      ? "Local demo. No wallet assets or rewards are changed."
      : savedMatches.has(data.generation)
        ? "Result saved. Character unlocked."
        : "Saving the result will unlock your character. Your saved inventory stays unchanged.";
  }
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
        : regionalMode
          ? "Opponent found. The regional duel starts after the countdown."
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
  $("rematch").hidden =
    chainMode || (regionalMode && !regionalDemo) || seat < 0 || d.phase !== 2;
  $("rematch").disabled = data.rematchVotes.includes(seat);
  $("join").hidden = seat >= 0;
  $("player").textContent = seat < 0 ? "Spectator" : `Player ${seat + 1}`;
  if (seat >= 0) {
    const me = d.fighters[seat];
    $("player").textContent = me.name
      ? `${me.name} · ${me.className} · Lv. ${me.level}`
      : `Player ${seat + 1}`;
    $("hp").textContent = `${me.hp} / ${me.maxHp ?? 120}`;
    $("mp").textContent = `${me.mana} / ${me.maxMana ?? 100}`;
    $("health").max = me.maxHp ?? 120;
    $("mana").max = Math.max(1, me.maxMana ?? 100);
    $("health").value = me.hp;
    $("mana").value = me.mana;
    if (regionalMode && Array.isArray(me.spellIds)) {
      $("spellbook-label").hidden = false;
      $("potions").hidden = false;
      const key = `${data.generation}:${me.classId}`;
      if (key !== bookKey) {
        bookKey = key;
        const options = me.spellIds.map((id) => {
          const s = pvpData.spells[id],
            option = document.createElement("option");
          option.value = String(id);
          option.textContent = `${s.name} · ${s.manaRequired} mana`;
          return option;
        });
        $("spellbook").replaceChildren(...options);
        selectedSpell = me.spellIds.includes(2) ? 2 : me.spellIds[0] || null;
        $("spellbook").value = String(selectedSpell);
        selected = false;
        const equipment = me.equipment.map((id) => {
          const el = document.createElement("div");
          el.textContent = pvpData.equipment[id].name;
          return el;
        });
        document.querySelector(".equipment").replaceChildren(...equipment);
      }
      $("spell").disabled = !me.spellIds.length;
      $("spell").textContent = selectedSpell
        ? `✦ ${pvpData.spells[selectedSpell].name}`
        : "No magic spells for this class";
      $("cast-help").textContent =
        "Choose a spell, select Cast, then click yourself or your opponent.";
      $("health-potion").textContent = `Health · R (${me.potions.health})`;
      $("mana-potion").textContent = `Mana · B (${me.potions.mana})`;
      $("mana-potion").disabled = !me.potions.mana;
    }
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
async function action(kind, value = 0, spellId = selectedSpell) {
  if (seat < 0 || !latest?.state || latest.state.phase === 2) return;
  if (pending) {
    queuedIntent = queueIntent(queuedIntent, kind, value, performance.now());
    if (queuedIntent && kind === "spell") queuedIntent.spellId = spellId;
    if (kind === "forfeit") {
      held = null;
      casting = false;
      log(
        "Forfeit queued. Waiting for the existing action before ending the match.",
      );
    }
    return;
  }
  pending = true;
  if (kind === "move")
    predictedMovement = predictMovement(latest, seat, value, performance.now());
  try {
    const result = await post("/api/action", {
      kind,
      value,
      nonce: latest.state.fighters[seat].nonce + 1,
      generation: latest.generation,
      ...(regionalMode && latest.state.fighters[seat].spellIds
        ? { spellId }
        : {}),
    });
    update(result);
  } catch (e) {
    if (e.message !== errors.Cooldown) log(e.message);
  } finally {
    if (kind === "move") predictedMovement = null;
    pending = false;
    const next = queuedIntent;
    queuedIntent = null;
    if (next && performance.now() < next.expires && latest?.state?.phase !== 2)
      void action(next.kind, next.value, next.spellId);
  }
}
$("join").onclick = async () => {
  try {
    const data = await post("/api/join");
    seat = data.seat;
    update(data);
    if (regionalMode) {
      $("join").hidden = true;
      log(
        "Ranked search started. Waiting for a compatible opponent below 100 ms.",
      );
      return;
    }
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
  log(
    regionalMode && selectedSpell
      ? `Casting ${pvpData.spells[selectedSpell].name}. Click a valid target.`
      : "Casting armed. Click your opponent to release Arcane bolt.",
  );
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
$("spellbook").onchange = () => {
  selectedSpell = Number($("spellbook").value);
  selected = true;
  casting = false;
  if (latest) update(latest);
};
$("health-potion").onclick = () => action("potion", 0);
$("mana-potion").onclick = () => action("potion", 1);
window.addEventListener("keydown", (e) => {
  if (
    document.querySelector("dialog[open]") ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)
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
  if (regionalMode && !e.repeat && e.key.toLowerCase() === "r")
    action("potion", 0);
  if (regionalMode && !e.repeat && e.key.toLowerCase() === "b")
    action("potion", 1);
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
  const targets = regionalMode ? [seat, 1 - seat] : [1 - seat];
  for (const index of targets) {
    const target = latest.state.fighters[index];
    if (target.hidden) continue;
    const visual = renderedFighters.get(index);
    if (
      Math.abs(x - (visual?.x ?? (target.x + 0.5) * 48)) < 28 &&
      Math.abs(y - ((visual?.y ?? (target.y + 1) * 48) - 40)) < 50
    ) {
      casting = false;
      void action("spell", index);
      return;
    }
  }
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
  predictedMovement = reconcileMovement(predictedMovement, latest, now);
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
      if (f.hidden) return;
      const displayed = i === seat && predictedMovement ? predictedMovement : f;
      const targetX = (displayed.x + 0.5) * 48,
        targetY = (displayed.y + 1) * 48;
      let visual = renderedFighters.get(i);
      if (
        !visual ||
        visual.generation !== latest.generation ||
        Math.abs(visual.x - targetX) + Math.abs(visual.y - targetY) > 96
      ) {
        visual = {
          x: targetX,
          y: targetY,
          targetX,
          targetY,
          fromX: targetX,
          fromY: targetY,
          since: now,
          generation: latest.generation,
        };
        renderedFighters.set(i, visual);
      }
      if (visual.targetX !== targetX || visual.targetY !== targetY) {
        Object.assign(visual, {
          fromX: visual.x,
          fromY: visual.y,
          targetX,
          targetY,
          since: now,
        });
      }
      const progress = Math.min(1, (now - visual.since) / 120);
      visual.x = visual.fromX + (visual.targetX - visual.fromX) * progress;
      visual.y = visual.fromY + (visual.targetY - visual.fromY) * progress;
      const x = visual.x,
        y = visual.y;
      ctx.fillStyle = i === seat ? "#d4b36a55" : "#66a4b655";
      ctx.beginPath();
      ctx.ellipse(x, y - 5, 18, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      drawSprite("body" + displayed.heading, x, y, 1.5, now);
      drawSprite("head" + displayed.heading, x, y - 6, 1.5, 0);
      ctx.font = "bold 12px system-ui";
      ctx.textAlign = "center";
      ctx.fillStyle = i === seat ? "#f1d28c" : "#a5d9e9";
      ctx.fillText(
        (f.mimicUntil > latest.tick && f.mimicName ? f.mimicName : f.name) ||
          (latest.practice && i === 1
            ? "Training opponent"
            : `Player ${i + 1}`),
        x,
        y - 88,
      );
      ctx.fillStyle = "#12201a";
      ctx.fillRect(x - 24, y - 80, 48, 4);
      ctx.fillStyle = "#71c596";
      ctx.fillRect(x - 24, y - 80, (48 * f.hp) / (f.maxHp ?? 120), 4);
    });
    if (
      held &&
      !document.querySelector("dialog[open]") &&
      now - lastMove >= 200 &&
      latest.state.phase === 1 &&
      latest.tick >= latest.state.starts_at &&
      !pending &&
      queuedIntent?.kind !== "forfeit"
    ) {
      lastMove = now;
      action("move", held);
    }
  }
  requestAnimationFrame(frame);
}
if (regionalMode) {
  document.querySelector(".arena-layout").hidden = true;
  document.querySelector(".build").textContent =
    "REGIONAL REALTIME · LOCAL TEST";
  document.querySelector("footer span:last-child").textContent =
    "Off-chain authoritative combat · Solana outside the combat loop";
  $("join").textContent = "Play ranked";
  $("events").textContent =
    "Choose Play ranked. Both players need measured ping below 100 ms to the same region. No wallet signatures for movement or attacks.";
  transport = (await import("/regional-transport.mjs")).createRegionalTransport(
    update,
    log,
    (message) => {
      if (typeof message.demo === "boolean") {
        regionalDemo = message.demo;
        document.querySelector(".build").textContent = message.demo
          ? "REGIONAL REALTIME · LOCAL TEST"
          : "REGIONAL RANKED · VERIFIED CHARACTER";
        document.querySelector("#result p:nth-of-type(2)").textContent =
          "Gold and rating rewards are not enabled in this PvP test.";
        $("pve").hidden = true;
        $("join").hidden = !message.demo;
        $("find-region").disabled = !message.demo;
        $("pve").textContent = message.demo
          ? "PvE practice · fight a bot"
          : "PvE · unavailable";
        $("pve").title =
          "Practice using the current arena rules. Not a port of the Argentum Offline executable.";
      }
      if (typeof message.queued === "boolean")
        $("join").hidden = message.queued;
      $("ranked-lobby").hidden = false;
      if (!latest?.state || latest.state.phase === 2) {
        document.querySelector(".arena-layout").hidden = true;
        document.querySelector(".intro").hidden = false;
        document.body.classList.remove("ranked-playing");
      }
      $("queue-status").textContent = message.reason;
      $("status").textContent = message.reason;
      if (message.reason.includes("cancelled")) $("join").hidden = false;
    },
    (message) => {
      $("region-ping").textContent =
        `Region: ${message.region} · measured ping: ${message.ping ?? "measuring"} ms · ranked limit: under 100 ms`;
    },
    (message) => {
      if (message.unlocked && message.matchId)
        savedMatches.add(message.matchId);
      if (!regionalDemo)
        $("settlement-status").textContent = message.unlocked
          ? "Character unlocked. Your saved inventory is unchanged."
          : "Saving the match result. Your character stays reserved until confirmation.";
    },
  );
  $("cancel-queue").onclick = () =>
    post("/api/cancel").catch((e) => log(e.message));
  $("pve").onclick = () => post("/api/practice").catch((e) => log(e.message));
  $("find-region").onclick = async () => {
    const button = $("find-region");
    button.disabled = true;
    try {
      if (latest?.state?.phase === 1)
        throw Error("Finish the active match before changing regions.");
      $("queue-status").textContent = "Measuring available regional servers…";
      const { chooseRegion, probeRegion } =
        await import("/region-selection.mjs");
      const regions = await fetch("/regions.json").then((r) => r.json());
      const results = await Promise.all(
        regions.filter((r) => r.available).map(probeRegion),
      );
      const best = chooseRegion(results);
      if (!best) {
        $("queue-status").textContent =
          "No available region is below 100 ms. You can keep waiting; ranked limits will not be widened.";
        return;
      }
      if (new URL(best.url).origin === location.origin) {
        $("queue-status").textContent =
          `You are on the best available region: ${best.id} (${best.ping} ms). Choose Play ranked.`;
        return;
      }
      await post("/api/cancel");
      location.assign(new URL("/ranked", best.url));
    } catch (error) {
      log(error.message);
    } finally {
      button.disabled = false;
    }
  };
  update(transport.start());
} else if (location.pathname === "/devnet") {
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
