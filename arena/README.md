# AOCHAIN arena prototype

The isolated arena lives here. It does not change or connect to the running ArgentumOnchain realm.

## Play the local rules lab

Requirements: Node 22+ and a stable Rust toolchain. From the repository root:

```sh
cargo build --manifest-path arena/Cargo.toml -p aochain-arena-runner --locked
node arena/scripts/serve.mjs
```

Open http://127.0.0.1:3202 in two independent browser sessions (for example Chrome and another browser, or a private window). Two ordinary tabs share a cookie and represent the same player. Join and ready up in each session. WASD/arrows move and face the opponent; Space performs melee. Select Arcane bolt, choose Cast, then click the opponent. Ground clicks do not move or auto-cast. The post-match modal appears once per match. A rematch requires both players to agree.

The lab is loopback-only and uses ephemeral capability cookies, same-origin POST checks, bounded requests and action budgets. Restart it to clear occupied seats. It is not a public hosting service, wallet login, matchmaking service, validator or blockchain match. No database, production keys, gold or ranked points are connected. A local Rust process enforces the same deterministic rules used by the program.

## Rules and source parity

Upstream references: `server/src/protocol.ts` movement/melee/spell handlers, `server/src/vars.ts` cooldowns, `frontend/components/game/input/combatTargeting.ts`, and `frontend/components/game/rendering/characterLayout.ts`.

This is a fixed-loadout **rules prototype**, not complete combat parity: each fighter has 120 health and 100 mana; melee deals 18 and the spell deals 26 for 20 mana. Both players must ready up before a countdown. Melee must face an orthogonally adjacent opponent; the spell targets the other player within six tiles (Chebyshev distance). There are no walls inside the test arena. Damage is deterministic. The first lethal action in authoritative transaction order ends the match; there is no client-decided simultaneous draw. The match timeout is a draw.

Movement cooldown is four ticks, melee 19, spell 17, cross-action lock 16, countdown 60 and match duration 12,000. The local harness supplies one tick per 50 ms, giving 200 ms movement and approximately upstream 950/850/800 ms combat timings. The program uses **runtime Clock.slot**, not browser timestamps. Actual rollup slot cadence must be measured/calibrated before claiming equivalent real-time combat timing. These are tuning parameters, not a latency guarantee. Rendering interpolation, local prediction, richer spells/classes, potions and balance remain future work.

## Actual Solana program

`programs/aochain-arena` uses Anchor 1.0.2 and MagicBlock's ephemeral-rollups-sdk 0.16.2, pinned in Cargo.lock. It creates a match PDA, accepts the named opponent's consent, delegates the state to an allowed prototype validator, validates signed actions and requests commit/undelegation after completion.

Main-wallet approval sets per-player session public keys. They can only invoke the game's scoped actions, expire after 20 minutes, and can be revoked by the owner. Session keys cannot create/join/delegate a match or authorize token transfers. Owner recovery and permissionless expiration remain available. The prototype does not enforce one active match per production character and has no production character assets or economic rewards.

The `settlement_requested` flag records a request, **not proof of completed base-chain settlement**. Check committed account state and delegation ownership before treating a result as settled. Crash recovery, interrupted commit reconciliation and end-to-end wallet/session tests are release gates.

Program identity in source is an unfunded local development identity. Its keypair is generated under ignored `target/deploy`, never committed. A fresh checkout needs its own local identity and matching declare_id; do not reuse this identity for production. No mainnet deployment is authorized by these instructions.

## Validate

```sh
cargo test --manifest-path arena/Cargo.toml -p aochain-arena-core --locked
node --test arena/scripts/arena-http.test.mjs
cargo test --manifest-path arena/Cargo.toml -p aochain-arena --locked
cargo build-sbf --manifest-path arena/programs/aochain-arena/Cargo.toml --sbf-out-dir arena/target/deploy
```

Use a supported Linux Solana toolchain (WSL on Windows) for SBF. The local browser lab runs natively on Windows. Keep Linux compilation outputs on a Linux filesystem to avoid Windows-mounted filesystem build stalls.

The on-chain program still needs a full local-validator/MagicBlock lifecycle test and a real two-client devnet match. A passing native Rust test or SBF build is not evidence of delegation, latency, wallet signatures or completed settlement.

Official integration references: [MagicBlock quickstart](https://docs.magicblock.gg/pages/ephemeral-rollups-ers/how-to-guide/quickstart), [local stack](https://docs.magicblock.gg/pages/ephemeral-rollups-ers/how-to-guide/local-development), [official examples](https://github.com/magicblock-labs/magicblock-engine-examples/tree/main/counter/anchor).
