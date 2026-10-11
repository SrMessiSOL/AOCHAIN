# Local Solana / MagicBlock lifecycle

This isolated client exercises the actual arena program, not the HTTP rules lab. It uses throwaway keys generated in memory and hardcoded loopback RPC endpoints. It never imports a user wallet, persists private keys, changes Solana CLI configuration, or contacts devnet/mainnet. Test SOL is created by the local validator.

## Setup

Use a Linux runtime compatible with the pinned official validator package (Ubuntu 24.04 supports its glibc requirements). Install `@magicblock-labs/ephemeral-validator@0.14.10` in a private tooling directory, and keep its local dumps with the package. A supported Solana toolchain must be on PATH. Build the arena program first with `cargo build-sbf` as documented in the arena README.

Start the base validator with a fresh dedicated ledger, preserving any unrelated ledgers:

```sh
mb-test-validator --ledger /path/to/new/aochain-base-ledger \
  --bind-address 127.0.0.1 --rpc-port 8899 \
  --bpf-program FuHnshxKDZ5pPvGPPKko526eEWk6RCQCMRnVfCp8Y9pZ /absolute/path/to/aochain_arena.so
```

Then start the rollup against that base validator:

```sh
ephemeral-validator --remotes http://127.0.0.1:8899 \
  --remotes ws://127.0.0.1:8900 --listen 127.0.0.1:7799 \
  --lifecycle ephemeral --storage /path/to/new/aochain-rollup-ledger --no-tui
```

From this directory:

```sh
npm ci --ignore-scripts
npm test
npm run test:local
```

A successful run creates the ignored `arena/work/` directory and writes `arena/work/local-lifecycle-receipt.json`, containing public local transaction signatures and the arena address. These signatures only exist in that local ledger; they are not public explorer transactions. Stop the temporary validators when finished to conserve disk and memory.

## Verified behavior

The script creates a match, rejects an unrelated opponent, accepts the named opponent, delegates the arena, rejects premature settlement, readies both scoped sessions, moves and casts a spell, rejects unauthorized and replayed actions without changing account bytes, recovers nonce through a fresh RPC client, revokes a session, verifies rejection of the revoked key, forfeits through the owner, rejects post-finish combat, requests settlement, and waits for restored program ownership plus matching committed match ID, owners, winner and revision on the base chain.

`settlement_requested` alone never means settlement completed. Polling has deadlines; a timeout requires reconciliation of the existing account rather than blindly creating another operation. The script intentionally uses a fresh match ID per run, and is a diagnostic test rather than a production recovery client.

The client account order and PDA tags were checked against the pinned Rust SDK macros. Decoder tests use a synthetic Borsh fixture; actual account decoding is also exercised by the validator test. Session expiration by elapsed wall-clock time, rollup outages during commit, replay across production character identities, and browser wallet approvals are not covered yet. The reconnect check recreates the RPC connection; it does not simulate a process crash or restore session secrets.

The browser still uses the local Rust harness. Next: browser account subscriptions, ephemeral session signing, measured slot cadence, pending transaction reconciliation and two-browser gameplay through the rollup. No gold, ranked points, character ownership or payouts are enabled.

Official reference: [MagicBlock local development](https://docs.magicblock.gg/pages/ephemeral-rollups-ers/how-to-guide/local-development).
