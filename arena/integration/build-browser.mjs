import { build } from "esbuild";
import { fileURLToPath } from "node:url";
const here = fileURLToPath(new URL(".", import.meta.url));
await build({
  entryPoints: [here + "browser.mjs"],
  outfile: here + "../work/chain.bundle.js",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  inject: [here + "browser-globals.mjs"],
  define: { "process.env.NODE_ENV": '"production"' },
});
await build({
  entryPoints: [here + "devnet-wallet.mjs"],
  outfile: here + "../work/devnet-wallet.bundle.js",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  inject: [here + "browser-globals.mjs"],
  define: { "process.env.NODE_ENV": '"production"' },
});
