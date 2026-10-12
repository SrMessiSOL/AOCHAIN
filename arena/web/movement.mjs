// Display-only prediction. Never mutate the authoritative match snapshot.
export function predictMovement(data, seat, heading, now) {
  const state = data?.state;
  if (
    !state ||
    seat < 0 ||
    seat > 1 ||
    state.phase !== 1 ||
    data.tick < state.starts_at
  )
    return null;
  const me = state.fighters[seat],
    other = state.fighters[1 - seat];
  if (
    data.tick < Number(me.paralyzedUntil || 0) ||
    data.tick < Number(me.rootedUntil || 0)
  )
    return null;
  if (data.tick < Number(me.stunnedUntil || 0))
    heading = ((heading + 1) % 4) + 1;
  if (data.tick < Number(me.moveAt ?? me.move_at ?? 0)) return null;
  const delta = { 1: [0, -1], 2: [1, 0], 3: [0, 1], 4: [-1, 0] }[heading];
  if (!delta) return null;
  let x = me.x + delta[0],
    y = me.y + delta[1];
  if (x < 1 || x > 14 || y < 1 || y > 10) return null;
  // The rules permit turning toward an occupied tile, without entering it.
  if (x === other.x && y === other.y) {
    x = me.x;
    y = me.y;
  }
  return {
    generation: data.generation,
    seat,
    nonce: me.nonce + 1,
    x,
    y,
    heading,
    expires: now + 800,
  };
}
export function reconcileMovement(prediction, data, now) {
  if (!prediction) return null;
  if (
    !data?.state ||
    data.generation !== prediction.generation ||
    data.state.phase !== 1 ||
    now >= prediction.expires
  )
    return null;
  if (data.state.fighters[prediction.seat].nonce >= prediction.nonce)
    return null;
  return prediction;
}
export function queueIntent(existing, kind, value, now) {
  if (existing?.kind === "forfeit") return existing;
  if (kind === "forfeit") return { kind, value, expires: Infinity };
  if (kind === "melee" || kind === "spell")
    return { kind, value, expires: now + 350 };
  return existing;
}
