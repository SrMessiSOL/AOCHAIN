import { getWallets } from "@wallet-standard/app";
import { Connection } from "@solana/web3.js";
import { PROGRAM } from "./client.mjs";
export { createDevnetTransport } from "./devnet-transport.mjs";

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

// Only explicit match setup buttons request signatures after deployment checks.
export function startDevnetSetup(
  onConnected = () => {},
  onDisconnect = () => {},
) {
  const registry = getWallets();
  const connection = new Connection(DEVNET_RPC, "confirmed");
  const dialog = document.getElementById("wallet-dialog");
  const list = document.getElementById("wallet-list");
  const status = document.getElementById("wallet-status");
  let connecting = false;
  let selectedWallet, selectedAccount, unsubscribe;
  async function activate(wallet, account) {
    const readiness = await inspectDevnet(connection);
    if (!readiness.deployed)
      throw Error("The arena program is not deployed on devnet.");
    selectedWallet = wallet;
    selectedAccount = account;
    sessionStorage.setItem("aochain:devnet-wallet", wallet.name);
    document.getElementById("wallet-button").textContent =
      `${account.address.slice(0, 4)}…${account.address.slice(-4)}`;
    status.textContent =
      "Connected to Solana devnet. Join the pairing, then approve each match setup step.";
    document.getElementById("join").disabled = false;
    document.getElementById("join").textContent = "Join devnet duel →";
    unsubscribe?.();
    unsubscribe = wallet.features["standard:events"]?.on(
      "change",
      ({ accounts }) => {
        if (
          accounts &&
          !accounts.some((a) => a.address === selectedAccount?.address)
        ) {
          onDisconnect();
          selectedWallet = undefined;
          selectedAccount = undefined;
          document.getElementById("wallet-button").textContent =
            "Reconnect wallet";
          document.getElementById("join").disabled = true;
          status.textContent =
            "Wallet account changed. Gameplay is paused; reconnect the original wallet to recover its match.";
        }
      },
    );
    onConnected(wallet, account);
    document.getElementById("status").textContent =
      "Wallet connected. Join the devnet pairing.";
  }
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
          await activate(wallet, account);
          dialog.close();
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
  registry.on("register", () => {
    render();
    resumePreferred();
  });
  registry.on("unregister", render);
  document.getElementById("wallet-button").onclick = () => {
    if (selectedWallet) {
      list.replaceChildren();
      list.textContent = `Connected with ${selectedWallet.name}. Match transactions use this provider directly.`;
    } else render();
    dialog.showModal();
  };
  document.getElementById("wallet-close").onclick = () => dialog.close();
  document.querySelector(".build").textContent =
    "MAGICBLOCK DEVNET · TEST MATCHES";
  document.getElementById("join").disabled = true;
  document.getElementById("join").textContent =
    "Devnet match setup in progress";
  document.getElementById("status").textContent =
    "Connect a wallet to check devnet readiness";
  document.getElementById("latency").textContent = "Devnet preparation";
  document.getElementById("events").textContent =
    "Connect a wallet, join a pairing, then approve match setup. Session actions run on MagicBlock US devnet. No rewards or assets are enabled.";
  document.querySelector("footer span:last-child").textContent =
    "MagicBlock US devnet · test SOL only";
  document.getElementById("wallet-button").hidden = false;
  let restoring = false;
  async function resumePreferred() {
    const preferred = sessionStorage.getItem("aochain:devnet-wallet");
    const candidate = registry
      .get()
      .find((w) => w.name === preferred && compatible(w));
    if (!candidate || selectedWallet || connecting || restoring) return;
    restoring = true;
    try {
      const result = await candidate.features["standard:connect"].connect({
        silent: true,
      });
      const account = result.accounts.find(
        (a) =>
          a.chains.includes("solana:devnet") &&
          a.features.includes("solana:signTransaction"),
      );
      if (account) await activate(candidate, account);
    } catch {
      status.textContent = "Reconnect your wallet to restore its session.";
    } finally {
      restoring = false;
    }
  }
  resumePreferred();
}
export {
  predictMovement,
  reconcileMovement,
  queueIntent,
} from "../web/movement.mjs";
