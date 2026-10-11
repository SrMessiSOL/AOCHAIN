import { Connection, PublicKey } from "@solana/web3.js";
import { inspectDevnet, DEVNET_RPC } from "./devnet-wallet.mjs";
import { PROGRAM } from "./client.mjs";
import { writeFile } from "node:fs/promises";
const payer = new PublicKey("DB5fZRbpbzsar78cEEpWmy55rU7zqaxiDgHmsYCXQ2T2");
const connection = new Connection(DEVNET_RPC, "confirmed");
const readiness = await inspectDevnet(connection);
const balance = await connection.getBalance(payer);
const report = {
  checkedAt: new Date().toISOString(),
  network: "solana:devnet",
  program: PROGRAM.toBase58(),
  payer: payer.toBase58(),
  payerLamports: balance,
  ...readiness,
};
await writeFile(
  new URL("../work/devnet-preflight.json", import.meta.url),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
