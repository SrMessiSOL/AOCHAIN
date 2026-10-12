import { readFile, writeFile } from "node:fs/promises";
const source = new URL("../../../aoweb-solana/", import.meta.url);
const spellNames = {
  41: "Remove Stun",
  42: "Mimicry",
  47: "Detect Invisibility",
};
const read = async (path) =>
  JSON.parse(await readFile(new URL(path, source), "utf8"));
const spells = await read("server/jsons/spells.json"),
  objects = await read("frontend/public/init/objs.json"),
  balance = await read("api/src/jsons/balance.json"),
  names = await read("frontend/locales/catalog.json");
const gearNames = {
  855: "Newbie agility potion",
  856: "Newbie mana potion",
  857: "Newbie health potion",
  858: "Newbie strength potion",
  859: "Newbie bow",
  860: "Newbie arrows",
  861: "Newbie sword",
  862: "Newbie mage staff",
  863: "Newbie magic flute",
  864: "Newbie magic lute",
  1044: "Newbie robe",
  1045: "Newbie robe",
  1046: "Newbie leather armor",
  1047: "Newbie leather armor",
  1048: "Newbie shield",
  1051: "Newbie simple helmet",
  1052: "Newbie hunter hood",
};
const data = {
  version: "ranked-newbie-v1",
  level: 50,
  classes: {
    1: "Mage",
    2: "Cleric",
    3: "Warrior",
    4: "Assassin",
    6: "Bard",
    7: "Druid",
    8: "Paladin",
    9: "Hunter",
  },
  balance,
  spells: Object.fromEntries(
    Object.entries(spells).map(([id, s]) => {
      const { desc, projectileVisual, ...fields } = s;
      return [
        id,
        {
          ...fields,
          id: Number(id),
          name: spellNames[id] || names[`spell.${id}.name`]?.en || s.name,
          duelAllowed:
            Number(s.minSkill) <= 100 &&
            ![0, 4].includes(Number(s.type)) &&
            !s.revivir &&
            ![36, 44, 45].includes(Number(id)),
        },
      ];
    }),
  ),
  equipment: Object.fromEntries(
    Object.entries(gearNames).map(([id, name]) => [
      id,
      { ...objects[id], id: Number(id), name },
    ]),
  ),
};
await writeFile(
  new URL("pvp-data.json", import.meta.url),
  JSON.stringify(data, null, 2) + "\n",
);
console.log(
  `Exported ${Object.values(data.spells).filter((s) => s.duelAllowed).length} duel-valid spells and ${Object.keys(data.equipment).length} newbie items`,
);
