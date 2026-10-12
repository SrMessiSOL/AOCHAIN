import { readFileSync } from "node:fs";
import { randomInt } from "node:crypto";
export const data = JSON.parse(
  readFileSync(new URL("pvp-data.json", import.meta.url), "utf8"),
);
export function preset(
  profile = { classId: 1, raceId: 1, name: "Arena mage" },
) {
  const classId = Number(profile.classId),
    raceId = Number(profile.raceId),
    c = data.balance.classProgress[classId],
    race = data.balance.balanceRazas[raceId];
  if (!data.classes[classId] || !race)
    throw Error("Invalid character class or race");
  const stats = Object.fromEntries(
    Object.entries(race).map(([key, value]) => [key, 18 + Number(value)]),
  );
  const maxHp = Math.round(
      stats.constitucion + (c.vida - (21 - stats.constitucion) * 0.5) * 49,
    ),
    maxMana = Math.max(
      0,
      Math.round(
        stats.inteligencia * c.manaInicial +
          c.multMana * stats.inteligencia * 49,
      ),
    );
  const low = raceId >= 4,
    cloth = [1, 6, 7].includes(classId);
  const weaponId = { 1: 862, 6: 864, 7: 863, 9: 859 }[classId] || 861;
  const equipment = [weaponId, cloth ? (low ? 1045 : 1044) : low ? 1047 : 1046];
  if (!cloth && classId !== 9) equipment.push(1048, 1051);
  if (classId === 6) equipment.push(1051);
  if (classId === 9) equipment.push(1052, 860);
  return {
    name: String(profile.name || "Adventurer").slice(0, 40),
    characterId: profile.characterId || null,
    classId,
    className: data.classes[classId],
    raceId,
    level: 50,
    maxHp,
    maxMana,
    stats,
    baseHit: 1 + 35 * c.hitPre36 + 14 * c.hitPost36,
    equipment,
    weapon: data.equipment[weaponId],
    spellIds: Object.values(data.spells)
      .filter((s) => s.duelAllowed && maxMana > 0 && s.manaRequired <= maxMana)
      .map((s) => s.id),
    potions: { health: 500, mana: maxMana ? 250 : 0 },
    arrows: classId === 9 ? 500 : 0,
  };
}
export class PvpEngine {
  constructor(profiles, random = randomInt) {
    this.random = random;
    this.state = {
      fighters: profiles.map((p, i) => ({
        ...preset(p),
        x: i ? 11 : 4,
        y: 6,
        heading: i ? 4 : 2,
        hp: preset(p).maxHp,
        mana: preset(p).maxMana,
        nonce: 0,
        move_at: 0,
        melee_at: 0,
        spell_at: 0,
        item_at: 0,
        poisoned: false,
        poison_at: 0,
        paralyzedUntil: 0,
        rootedUntil: 0,
        invisibleUntil: 0,
        revealedUntil: 0,
        stunnedUntil: 0,
        agilityUntil: 0,
        strengthUntil: 0,
        agilityChange: 0,
        strengthChange: 0,
        hunger: 100,
        mimicUntil: 0,
      })),
      ready: [false, false],
      phase: 0,
      winner: 2,
      starts_at: 0,
      expires_at: 0,
      last_tick: 0,
      revision: 0,
    };
  }
  advance(tick) {
    const s = this.state;
    s.last_tick = Math.max(tick, s.last_tick);
    if (s.phase !== 1 || tick < s.starts_at) return;
    for (const f of s.fighters) {
      if (f.poisoned && tick >= f.poison_at) {
        f.hp = Math.max(0, f.hp - 2);
        f.poison_at = tick + 20;
        s.revision++;
      }
    }
    const dead = s.fighters.map((f) => f.hp <= 0);
    if (dead.some(Boolean)) {
      s.phase = 2;
      s.winner = dead.every(Boolean) ? 2 : dead[0] ? 1 : 0;
      s.revision++;
    }
    if (tick >= s.expires_at && s.phase === 1) {
      s.phase = 2;
      s.winner = 2;
      s.revision++;
    }
  }
  damage(value, caster, target) {
    let amount = value + Math.round(value * 1.5);
    amount += Math.round(
      (amount * (caster.weapon.magicDamageBonus || 0)) / 100,
    );
    amount = Math.floor(
      amount * (data.balance.modDmgMagia[caster.classId] || 1),
    );
    const resistance = data.balance.modResistenciaMagica[target.classId] || 0;
    return Math.max(1, amount - Math.floor((amount * resistance) / 100));
  }
  apply({ actor, nonce, kind, value = 0, spellId }, tick) {
    this.advance(tick);
    const s = this.state;
    if (kind === "snapshot") return;
    if (![0, 1].includes(actor) || !Number.isSafeInteger(nonce))
      throw Error("Unauthorized");
    if (s.phase === 2) throw Error("Finished");
    const me = s.fighters[actor],
      enemy = s.fighters[1 - actor];
    if (nonce !== me.nonce + 1) throw Error("Replay");
    if (kind === "ready") {
      if (s.phase !== 0 || s.ready[actor]) throw Error("NotReady");
      s.ready[actor] = true;
      if (s.ready.every(Boolean)) {
        s.phase = 1;
        s.starts_at = tick + 60;
        s.expires_at = s.starts_at + 12000;
      }
    } else if (kind === "forfeit") {
      s.phase = 2;
      s.winner = 1 - actor;
    } else if (kind === "timeout") {
      if (tick < s.expires_at) throw Error("NotExpired");
      s.phase = 2;
      s.winner = 2;
    } else {
      if (s.phase !== 1 || tick < s.starts_at) throw Error("Countdown");
      if (kind === "move") {
        if (tick < me.move_at) throw Error("Cooldown");
        if (tick < me.paralyzedUntil || tick < me.rootedUntil)
          throw Error("Immobilized");
        if (tick < me.stunnedUntil) value = ((value + 1) % 4) + 1;
        const d = { 1: [0, -1], 2: [1, 0], 3: [0, 1], 4: [-1, 0] }[value];
        if (!d) throw Error("Bounds");
        const x = me.x + d[0],
          y = me.y + d[1];
        if (x < 1 || x > 14 || y < 1 || y > 10) throw Error("Bounds");
        if (x !== enemy.x || y !== enemy.y) {
          me.x = x;
          me.y = y;
        }
        me.heading = value;
        me.move_at = tick + 4;
      } else if (kind === "melee") {
        if (tick < me.melee_at) throw Error("Cooldown");
        if (tick < me.paralyzedUntil) throw Error("Paralyzed");
        if (tick < enemy.invisibleUntil && tick >= enemy.revealedUntil)
          throw Error("InvisibleTarget");
        const distance = Math.abs(me.x - enemy.x) + Math.abs(me.y - enemy.y),
          ranged = !!me.weapon.proyectil,
          d = { 1: [0, -1], 2: [1, 0], 3: [0, 1], 4: [-1, 0] }[me.heading];
        if (
          ranged
            ? Math.max(Math.abs(me.x - enemy.x), Math.abs(me.y - enemy.y)) > 6
            : distance !== 1 ||
              me.x + d[0] !== enemy.x ||
              me.y + d[1] !== enemy.y
        )
          throw Error("Range");
        if (ranged && !me.arrows) throw Error("NoArrows");
        const strength = tick < me.strengthUntil ? me.strengthChange : 0,
          damage = Math.max(
            1,
            Math.floor(
              (me.baseHit +
                this.random(
                  Number(me.weapon.minHit || 1),
                  Number(me.weapon.maxHit || 1) + 1,
                ) +
                strength) *
                (ranged
                  ? data.balance.modDmgProyectiles[me.classId] || 1
                  : data.balance.modDmgArmas[me.classId] || 1),
            ) - 2,
          );
        const attackerAgility =
            me.stats.agilidad + (tick < me.agilityUntil ? me.agilityChange : 0),
          defenderAgility =
            enemy.stats.agilidad +
            (tick < enemy.agilityUntil ? enemy.agilityChange : 0);
        const chance = Math.max(
          20,
          Math.min(95, 80 + (attackerAgility - defenderAgility) * 2),
        );
        if (this.random(1, 101) <= chance)
          enemy.hp = Math.max(
            0,
            enemy.hp -
              Math.max(1, Math.floor(damage * (me.hunger > 0 ? 1 : 0.9))),
          );
        me.invisibleUntil = 0;
        if (ranged) me.arrows--;
        me.melee_at = tick + 19;
        me.spell_at = Math.max(me.spell_at, tick + 16);
      } else if (kind === "spell") {
        if (tick < me.spell_at) throw Error("Cooldown");
        const spell = data.spells[spellId];
        if (!spell || !me.spellIds.includes(spell.id))
          throw Error("InvalidSpell");
        if (me.mana < spell.manaRequired) throw Error("Mana");
        if (![0, 1].includes(value)) throw Error("Target");
        const target = s.fighters[value];
        if (Math.max(Math.abs(me.x - target.x), Math.abs(me.y - target.y)) > 6)
          throw Error("Range");
        const offensive =
          spell.subeHp === 2 ||
          spell.paraliza ||
          spell.inmoviliza ||
          [4, 12, 13, 19, 21, 31].includes(spell.id);
        if (offensive && value === actor) throw Error("Target");
        if (
          tick < target.invisibleUntil &&
          tick >= target.revealedUntil &&
          value !== actor &&
          !spell.remueveInvisibilidadParcial
        )
          throw Error("InvisibleTarget");
        if (spell.subeHp === 2) {
          target.hp = Math.max(
            0,
            target.hp -
              this.damage(
                this.random(spell.minHp, spell.maxHp + 1),
                me,
                target,
              ),
          );
          me.invisibleUntil = 0;
        } else if (spell.subeHp === 1)
          target.hp = Math.min(
            target.maxHp,
            target.hp +
              Math.round(this.random(spell.minHp, spell.maxHp + 1) * 2.5),
          );
        else if (spell.paraliza) target.paralyzedUntil = tick + 120;
        else if (spell.inmoviliza) target.rootedUntil = tick + 120;
        else if (spell.removerParalisis) {
          target.paralyzedUntil = 0;
          target.rootedUntil = 0;
        } else if (spell.invisibilidad) target.invisibleUntil = tick + 400;
        else if (spell.remueveInvisibilidadParcial) {
          for (const f of s.fighters) f.revealedUntil = tick + 100;
        } else if (spell.subeAg) {
          target.agilityChange =
            (spell.subeAg === 1 ? 1 : -1) *
            Math.max(1, this.random(spell.minAg || 1, (spell.maxAg || 5) + 1));
          target.agilityUntil = tick + 1200;
        } else if (spell.subeFz) {
          target.strengthChange =
            (spell.subeFz === 1 ? 1 : -1) *
            Math.max(1, this.random(spell.minFz || 1, (spell.maxFz || 5) + 1));
          target.strengthUntil = tick + 1200;
        } else if (spell.id === 1) target.poisoned = false;
        else if (spell.id === 4) {
          target.poisoned = true;
          target.poison_at = tick + 20;
        } else if (spell.id === 12 || spell.id === 13)
          target.hunger = spell.id === 13 ? 0 : Math.max(0, target.hunger - 50);
        else if (spell.id === 31) target.stunnedUntil = tick + 120;
        else if (spell.id === 41) target.stunnedUntil = 0;
        else if (spell.id === 42) {
          me.mimicUntil = tick + 400;
          me.mimicName = target.name;
        } else throw Error("InvalidSpell");
        me.mana -= spell.manaRequired;
        me.spell_at = tick + 17;
        me.melee_at = Math.max(me.melee_at, tick + 16);
      } else if (kind === "potion") {
        if (tick < me.item_at) throw Error("Cooldown");
        const type = value === 0 ? "health" : value === 1 ? "mana" : null;
        if (!type || me.potions[type] <= 0) throw Error("NoPotion");
        me.potions[type]--;
        if (type === "health")
          me.hp = Math.min(me.maxHp, me.hp + Math.ceil(me.maxHp * 0.12));
        else
          me.mana = Math.min(
            me.maxMana,
            me.mana + Math.ceil(me.maxMana * 0.12),
          );
        me.item_at = tick + 5;
      } else throw Error("Invalid action");
    }
    me.nonce = nonce;
    s.revision++;
    this.advance(tick);
  }
}
