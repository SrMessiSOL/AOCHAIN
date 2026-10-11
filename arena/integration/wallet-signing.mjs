import { Transaction } from "@solana/web3.js";
import { Buffer } from "buffer";
export async function signDevnetTransaction(wallet, account, tx) {
  const valid = () =>
    wallet.accounts.some(
      (a) =>
        a.address === account.address &&
        a.chains.includes("solana:devnet") &&
        a.features.includes("solana:signTransaction"),
    );
  if (!valid())
    throw Error(
      "Wallet account changed. Reconnect before approving this match.",
    );
  const message = tx.serializeMessage();
  const [result] = await wallet.features[
    "solana:signTransaction"
  ].signTransaction({
    account,
    chain: "solana:devnet",
    transaction: new Uint8Array(
      tx.serialize({ requireAllSignatures: false, verifySignatures: false }),
    ),
  });
  if (!valid())
    throw Error(
      "Wallet account changed during approval. Transaction was not submitted.",
    );
  const signed = Transaction.from(result.signedTransaction);
  if (!Buffer.from(signed.serializeMessage()).equals(Buffer.from(message)))
    throw Error(
      "Wallet returned a different transaction. Nothing was submitted.",
    );
  return signed.serialize({
    requireAllSignatures: true,
    verifySignatures: true,
  });
}
