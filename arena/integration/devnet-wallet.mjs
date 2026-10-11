import { getWallets } from "@wallet-standard/app";
import { Connection } from "@solana/web3.js";
import { PROGRAM } from "./client.mjs";

export const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export const DEVNET_RPC = "https://api.devnet.solana.com";
export function compatible(wallet) {
  return (
    wallet.chains.includes("solana:devnet") &&
    typeof wallet.features["standard:connect"]?.connect === "function" &&
    typeof wallet.features["solana:signTransaction"]?.signTransaction ===
      "function"
  );
}
export async function inspectDevnet(connection) {
  if ((await connection.getGenesisHash()) !== DEVNET_GENESIS)
    throw Error("Wrong network. Only Solana devnet is allowed.");
  const account = await connection.getAccountInfo(PROGRAM, "confirmed");
  return { deployed: !!account?.executable };
}
export async function connectWallet(wallet) {
  if (!compatible(wallet))
    throw Error("This wallet does not support devnet transaction signing.");
  const result = await wallet.features["standard:connect"].connect();
  const account = result.accounts.find(
    (a) =>
      a.chains.includes("solana:devnet") &&
      a.features.includes("solana:signTransaction"),
  );
  if (!account) throw Error("No compatible devnet account was returned.");
  return account;
}

// This preparation screen only connects and inspects public chain state.
// Match/session transaction signing is gated until deployment is verified.
export function startDevnetSetup() {
  const registry = getWallets();
  const connection = new Connection(DEVNET_RPC, "confirmed");
  const dialog = document.getElementById("wallet-dialog");
  const list = document.getElementById("wallet-list");
  const status = document.getElementById("wallet-status");
  let connecting = false;
  function render() {
    list.replaceChildren();
    const wallets = registry.get().filter(compatible);
    if (!wallets.length) {
      list.textContent =
        "No compatible wallet detected. Open this page in a browser with a Solana wallet installed.";
      return;
    }
    for (const wallet of wallets) {
      const button = document.createElement("button");
      button.textContent = wallet.name;
      button.disabled = connecting;
      button.onclick = async () => {
        if (connecting) return;
        connecting = true;
        render();
        status.textContent =
          "Approve the connection in your wallet. No signature or transfer is requested.";
        try {
          const account = await connectWallet(wallet);
          document.getElementById("wallet-button").textContent =
            `${account.address.slice(0, 4)}…${account.address.slice(-4)}`;
          status.textContent = "Wallet connected. Checking devnet deployment…";
          const readiness = await inspectDevnet(connection);
          status.textContent = readiness.deployed
            ? "Wallet connected. Program found on devnet; match integration verification is next."
            : "Wallet connected. The arena program is not deployed on devnet yet. Matches remain disabled.";
        } catch (error) {
          status.textContent =
            error.message || "Connection failed. Please try again.";
        } finally {
          connecting = false;
          render();
        }
      };
      list.append(button);
    }
  }
  registry.on("register", render);
  registry.on("unregister", render);
  document.getElementById("wallet-button").onclick = () => {
    render();
    dialog.showModal();
  };
  document.getElementById("wallet-close").onclick = () => dialog.close();
  document.querySelector(".build").textContent =
    "DEVNET SETUP · MATCHES NOT ENABLED";
  document.getElementById("join").disabled = true;
  document.getElementById("join").textContent =
    "Devnet match setup in progress";
  document.getElementById("status").textContent =
    "Connect a wallet to check devnet readiness";
  document.getElementById("latency").textContent = "Devnet preparation";
  document.getElementById("events").textContent =
    "This screen prepares wallet access. Local gameplay is available at /chain. No rewards or assets are enabled.";
  document.querySelector("footer span:last-child").textContent =
    "Solana devnet setup · no match execution yet";
  document.getElementById("wallet-button").hidden = false;
}
