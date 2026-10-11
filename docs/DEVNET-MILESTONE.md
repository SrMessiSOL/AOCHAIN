# First wallet-backed devnet match

UI work accompanies implementation. Wallet choice, readiness, session authorization, connection health and settlement state must be understandable now. Final art, animation and visual polish follow a reliable match loop.

## Implemented preparation

`/devnet` on the local browser server discovers Wallet Standard providers that advertise devnet transaction signing. Connecting only requests accounts, never a signature or transfer. A genesis check rejects other chains before reading the arena program; matches stay disabled on this preparation screen. `/chain` remains the independent disposable-key local lab.

The official Wallet Standard and MagicBlock documentation were checked while preparing this flow:
- https://github.com/anza-xyz/wallet-standard
- https://docs.magicblock.gg/pages/ephemeral-rollups-ers/how-to-guide/quickstart

## Deployment gate

The dedicated test payer is `DB5fZRbpbzsar78cEEpWmy55rU7zqaxiDgHmsYCXQ2T2`. Its generated key is ignored under `arena/work/devnet-deployer.json` and is never bundled or sent to the coordinator. Test funding is required before deployment; never fund this development payer with mainnet SOL.

Program deployment succeeded on 2026-10-11. `node arena/integration/devnet-preflight.mjs` checks the actual devnet genesis, executable program presence and public payer balance and records a public report under ignored `arena/work`.

Program: `FuHnshxKDZ5pPvGPPKko526eEWk6RCQCMRnVfCp8Y9pZ`.
Deployment transaction: https://explorer.solana.com/tx/4UwF4SnkZAHpd8YugHGSSphWbkuqCHQBzcjkBPyRS4K9Aozr4RbgdYhQMurwxsBjmbArzPqe1dd5Jqj1TWjMMyUp?cluster=devnet
Downloaded deployed binary SHA256 matches the tested build: `b9d9a8ff89a579c142f8542b148b4b8d0515b40cbd2baf939893eee8fe6b48f1`.

The initial public-RPC bulk upload exhausted retries. MagicBlock's router lacked a CLI-required RPC method. Resuming the same buffer through the official CLI TPU transport succeeded; no replacement program or buffer was created. The payer was funded with 10 devnet SOL by the user. No mainnet funds were used.

## Actual devnet execution

`devnet-smoke.mjs` runs only against hardcoded devnet endpoints with the dedicated test payer. It allocates 0.02 test SOL each to two disposable owners and two sessions (0.08 total), and writes public receipts and ignored recovery keys before gameplay. This is scripted keypair execution, not browser wallet approval.

A first match at `8MB5CG5bA3554enYR3bQQb5y9prS88YwsBdzDHo6vxbj` lost its network confirmation path after both participants readied. Reading the existing account showed unchanged combat nonce and an expired match. Recovery used the next authoritative nonce to time it out as a draw, then verified restored program ownership and matching result on Solana devnet.

A fresh match at `CaNYefcLyMqQRaLc6nFp34b1qATPvASR2rExRE4TZYjD` completed create → join → delegate → both session readiness → movement → spell → forfeit → commit/undelegate. Opponent HP was 94 and caster mana 80. Base-chain settlement required restored program ownership and matching match ID, owners, winner and revision. Receipts remain under ignored `arena/work`; ER signatures are not necessarily indexed by the Solana base-chain explorer.

Use `node arena/integration/devnet-smoke.mjs` only for an explicit new test. `--resume` is currently a diagnostic path for an already-readied interrupted match with its saved keys; it is not a general transaction recovery client. Before rerunning, inspect the existing receipt and account. Production recovery, account changes and session expiry remain gates.

## Remaining sequence

1. Deployment, binary verification and scripted devnet combat/settlement are complete. Preserve the upgrade key outside browser code.
2. US validator identity/endpoints were checked against the official quickstart: `MUS3hc9TCw4cGC12vHNoYcCGzJG1txjgQLZWVoeNHNd`, `https://devnet-us.magicblock.app`.
3. Add wallet-signed match creation/join and scoped session funding/authorization, with explicit user actions rather than automatic wallet prompts from polling.
4. Route session actions to the selected ER and verify final base-chain ownership/result after commit.
5. Complete two real-wallet matches, reconnect, account-change, expiry, revocation and interrupted settlement checks. Measure regional latency before enabling community matches.

No rewards, rating or asset transfers are enabled. Unit tests with mock Wallet Standard accounts establish capability and network filtering, not real wallet approval or devnet match execution.
