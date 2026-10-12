import test from "node:test";
import assert from "node:assert/strict";
import { PvpEngine, preset, data } from "./pvp-engine.mjs";
const profiles = [
  { name: "Alice", classId: 1, raceId: 1 },
  { name: "Bob", classId: 1, raceId: 1 },
];
function duel() {
  const e = new PvpEngine(profiles, (min) => min);
  e.apply({ actor: 0, nonce: 1, kind: "ready" }, 0);
  e.apply({ actor: 1, nonce: 1, kind: "ready" }, 0);
  e.state.fighters[1].x = 9;
  return e;
}
test("level 50 class presets use only source newbie equipment, without modifying supplied characters", () => {
  for (const classId of Object.keys(data.classes).map(Number))
    for (let raceId = 1; raceId <= 5; raceId++) {
      const saved = {
          name: "Owned character",
          classId,
          raceId,
          level: 7,
          gold: 123,
          inventory: [{ id: 861, quantity: 1 }],
        },
        before = JSON.stringify(saved),
        p = preset(saved);
      assert.equal(JSON.stringify(saved), before);
      assert.equal(p.level, 50);
      assert(p.maxHp > 0);
      assert(p.equipment.every((id) => data.equipment[id]));
      assert(
        p.spellIds.every(
          (id) =>
            data.spells[id].duelAllowed &&
            data.spells[id].manaRequired <= p.maxMana,
        ),
      );
      if ([3, 9].includes(classId)) assert.equal(p.spellIds.length, 0);
    }
});
test("every exported duel spell executes and charges mana exactly once", () => {
  const spells = Object.values(data.spells).filter((s) => s.duelAllowed);
  assert.equal(spells.length, 25);
  for (const spell of spells) {
    const e = duel(),
      f = e.state.fighters[0],
      target = e.state.fighters[1];
    f.hp -= 30;
    f.poisoned = true;
    f.stunnedUntil = 100;
    f.paralyzedUntil = 100;
    const offensive =
        spell.subeHp === 2 ||
        spell.paraliza ||
        spell.inmoviliza ||
        [4, 12, 13, 19, 21, 31, 42].includes(spell.id),
      value = offensive ? 1 : 0,
      mana = f.mana;
    e.apply(
      { actor: 0, nonce: 2, kind: "spell", spellId: spell.id, value },
      60,
    );
    assert.equal(f.mana, mana - spell.manaRequired, spell.name);
    assert.equal(f.nonce, 2);
    assert.throws(
      () =>
        e.apply(
          { actor: 0, nonce: 2, kind: "spell", spellId: spell.id, value },
          80,
        ),
      /Replay/,
    );
    if (spell.subeHp === 2) assert(target.hp < target.maxHp, spell.name);
    if (spell.subeHp === 1) assert(f.hp > f.maxHp - 30, spell.name);
    if (spell.paraliza) assert(target.paralyzedUntil > 60);
    if (spell.inmoviliza) assert(target.rootedUntil > 60);
    if (spell.invisibilidad) assert(f.invisibleUntil > 60);
    if (spell.id === 1) assert.equal(f.poisoned, false);
    if (spell.id === 4) assert.equal(target.poisoned, true);
    if (spell.id === 41) assert.equal(f.stunnedUntil, 0);
  }
});
test("mana, range, cooldown and death are server enforced; forfeit cannot apply twice", () => {
  const e = duel(),
    f = e.state.fighters[0];
  assert.throws(
    () =>
      e.apply({ actor: 0, nonce: 2, kind: "spell", spellId: 11, value: 1 }, 60),
    /InvalidSpell/,
  );
  f.mana = 0;
  assert.throws(
    () =>
      e.apply({ actor: 0, nonce: 2, kind: "spell", spellId: 2, value: 1 }, 60),
    /Mana/,
  );
  f.mana = f.maxMana;
  e.state.fighters[1].x = 14;
  assert.throws(
    () =>
      e.apply({ actor: 0, nonce: 2, kind: "spell", spellId: 2, value: 1 }, 60),
    /Range/,
  );
  e.state.fighters[1].x = 9;
  e.apply({ actor: 0, nonce: 2, kind: "spell", spellId: 2, value: 1 }, 60);
  assert.throws(
    () =>
      e.apply({ actor: 0, nonce: 3, kind: "spell", spellId: 2, value: 1 }, 61),
    /Cooldown/,
  );
  e.apply({ actor: 0, nonce: 3, kind: "forfeit" }, 61);
  assert.equal(e.state.phase, 2);
  assert.equal(e.state.winner, 1);
  assert.throws(
    () => e.apply({ actor: 0, nonce: 4, kind: "move", value: 2 }, 70),
    /Finished/,
  );
  const lethal = duel();
  lethal.state.fighters[1].hp = 1;
  lethal.apply({ actor: 0, nonce: 2, kind: "spell", spellId: 2, value: 1 }, 60);
  assert.equal(lethal.state.phase, 2);
  assert.equal(lethal.state.winner, 0);
});
test("invisibility, reveal, immobilization, antidote and potions affect the duel state", () => {
  const e = duel(),
    a = e.state.fighters[0],
    b = e.state.fighters[1];
  e.apply({ actor: 1, nonce: 2, kind: "spell", spellId: 14, value: 1 }, 60);
  assert.throws(
    () =>
      e.apply({ actor: 0, nonce: 2, kind: "spell", spellId: 2, value: 1 }, 60),
    /InvisibleTarget/,
  );
  e.apply({ actor: 0, nonce: 2, kind: "spell", spellId: 47, value: 0 }, 60);
  assert(b.revealedUntil > 60);
  e.apply({ actor: 0, nonce: 3, kind: "spell", spellId: 9, value: 1 }, 77);
  assert.throws(
    () => e.apply({ actor: 1, nonce: 3, kind: "move", value: 1 }, 78),
    /Immobilized/,
  );
  e.apply({ actor: 1, nonce: 3, kind: "spell", spellId: 10, value: 1 }, 78);
  assert.equal(b.paralyzedUntil, 0);
  a.hp -= 80;
  e.apply({ actor: 0, nonce: 4, kind: "potion", value: 0 }, 80);
  assert.equal(a.potions.health, 499);
  assert(a.hp > a.maxHp - 80);
  assert.throws(
    () => e.apply({ actor: 0, nonce: 5, kind: "potion", value: 0 }, 81),
    /Cooldown/,
  );
});
