const $ = (id) => document.getElementById(id),
  canvas = $("arena"),
  ctx = canvas.getContext("2d");
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
  const before = latest;
  latest = data;
  const d = data.state;
  if (!d) return;
  if (before?.generation !== data.generation) {
    casting = false;
    selected = false;
    $("result").close();
    log("New local duel. Both players must ready up.");
  }
  if (before?.state && before.generation === data.generation) {
    d.fighters.forEach((f, i) => {
      const previous = before.state.fighters[i];
      if (f.hp < previous.hp)
        log(`Player ${i + 1} took ${previous.hp - f.hp} damage.`);
    });
  }
  const remaining = Math.max(0, Math.ceil((d.starts_at - data.tick) * 0.05));
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
  $("rematch").hidden = seat < 0 || d.phase !== 2;
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
  if (confirm("Forfeit this test duel?")) action("forfeit");
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
  if ($("result").open || ["INPUT", "TEXTAREA"].includes(e.target.tagName))
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
requestAnimationFrame(frame);
