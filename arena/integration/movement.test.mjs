import test from "node:test";
import assert from "node:assert/strict";
import {
  predictMovement,
  reconcileMovement,
  queueIntent,
} from "../web/movement.mjs";
test("forfeit survives input pressure; combat buffering is bounded and expires", () => {
  const attack = queueIntent(null, "melee", 0, 100);
  assert.equal(attack.expires, 450);
  assert.equal(queueIntent(attack, "move", 2, 110), attack);
  const exit = queueIntent(attack, "forfeit", 0, 120);
  assert.equal(exit.expires, Infinity);
  assert.equal(queueIntent(exit, "spell", 1, 130), exit);
  assert.equal(queueIntent(exit, "move", 3, 140), exit);
});
const fixture = () => ({
  generation: 7,
  tick: 100,
  state: {
    phase: 1,
    starts_at: 60,
    fighters: [
      { x: 4, y: 6, heading: 2, nonce: 3, moveAt: 90, hp: 120 },
      { x: 11, y: 6, nonce: 2, hp: 120 },
    ],
  },
});
test("prediction responds before confirmation without changing authoritative positions or combat", () => {
  const data = fixture(),
    original = structuredClone(data);
  const prediction = predictMovement(data, 0, 2, 0);
  assert.equal(prediction.x, 5);
  assert.deepEqual(data, original);
  // Opponent updates and clock refreshes must not undo an unacknowledged move.
  data.state.fighters[1].nonce++;
  assert.equal(reconcileMovement(prediction, data, 180), prediction);
  data.state.fighters[0].nonce++;
  data.state.fighters[0].x = 5;
  assert.equal(reconcileMovement(prediction, data, 180), null);
});
test("bounds, countdown, cooldown and occupied tiles match arena movement rules", () => {
  const data = fixture();
  data.state.fighters[0].x = 1;
  assert.equal(predictMovement(data, 0, 4, 0), null);
  data.tick = 59;
  assert.equal(predictMovement(data, 0, 2, 0), null);
  data.tick = 89;
  assert.equal(predictMovement(data, 0, 2, 0), null);
  data.tick = 100;
  data.state.fighters[1].x = 2;
  const p = predictMovement(data, 0, 2, 0);
  assert.equal(p.x, 1);
  assert.equal(p.heading, 2);
});
test("rejected moves, timeout, finished match and new generation restore authority", () => {
  const data = fixture(),
    p = predictMovement(data, 0, 2, 0);
  data.state.fighters[0].nonce++; // A consumed action can still have a corrected position.
  assert.equal(reconcileMovement(p, data, 180), null);
  assert.equal(data.state.fighters[0].x, 4);
  assert.equal(reconcileMovement(p, fixture(), 800), null);
  assert.equal(reconcileMovement(p, { ...fixture(), generation: 8 }, 10), null);
  data.state.phase = 2;
  assert.equal(reconcileMovement(p, data, 10), null);
});
