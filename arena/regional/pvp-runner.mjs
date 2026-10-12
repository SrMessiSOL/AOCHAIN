import readline from "node:readline";
import { PvpEngine } from "./pvp-engine.mjs";
const profiles = JSON.parse(process.env.RANKED_PROFILES || "[]");
if (profiles.length !== 2) throw Error("Two character presets required");
const engine = new PvpEngine(profiles),
  started = performance.now();
for await (const line of readline.createInterface({ input: process.stdin })) {
  const tick = Math.floor((performance.now() - started) / 50);
  let error = null;
  try {
    engine.apply(JSON.parse(line), tick);
  } catch (e) {
    error = e.message;
  }
  console.log(JSON.stringify({ state: engine.state, tick, error }));
}
