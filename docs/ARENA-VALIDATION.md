# Arena prototype validation — 2026-10-11

## Verified

- Seven native Rust combat tests: countdown, actor bounds, nonce replay, cooldowns, backwards clocks, tile boundaries, facing without entering an occupied tile, range, targeting, shared cooldowns, mana, first-lethal ordering, single completion, timeout, forfeit and atomic overflow rejection.
- Two native program tests: participant/session resolution and expiry boundary; account allocation and serialization round trip.
- Actual two-client HTTP test with separate capability cookies against the Rust executable: readiness, countdown, movement, replay rejection, actor injection rejection, five spell hits, winner detection, post-finish rejection, two-party rematch and stale-generation rejection. Unauthenticated and wrong-origin actions are rejected.
- Browser review in independent in-app/Chrome sessions: both players joined and readied; keyboard movement worked; select → Cast → opponent reduced the other client's health by 26 and the attacker's mana by 20. Original body/head sprites were inspected and aligned using upstream layout rules.
- `cargo check` with stable Linux Rust passed for the actual Anchor/MagicBlock program. `cargo build-sbf` produced a Solana executable locally. JavaScript syntax checks and Git whitespace checks passed.

## Not verified / next gates

- No validator lifecycle transaction, delegation acknowledgement, account subscription, on-chain match or base-chain settlement was executed.
- The browser still connects to the local Rust harness, not MagicBlock. There is no wallet connection in this lab.
- No devnet/mainnet deployment, real signatures, funding, gold, rating, asset ownership or payouts were exercised.
- Scoped session authorization is implemented in the program but has not been tested through a real wallet/session lifecycle. Slot-based cooldown timing must be calibrated against the selected runtime.
- Program instruction boundaries, signer enforcement and CPI behavior require validator-level tests; native helper tests and compilation do not prove them.
- Disconnection recovery, pending commit reconciliation, matchmaking, prediction/interpolation, global latency and ranked balance remain unfinished.

## Build notes

Use the stable compiler for native program checks. The installed nightly compiler crashed during macro expansion. A Windows-mounted Linux build output stalled in a dependency build script; Linux-native build storage resolved it. Program dependencies follow the official example's pinned Anchor 1.0.2 / ephemeral-rollups-sdk 0.16.2 pairing. Generated binaries, build logs and the unfunded local identity key are excluded from Git.

The initial SBF build succeeded and produced a 321,072-byte executable. A final incremental rebuild after formatting could not start because WSL returned `Wsl/Service/E_UNEXPECTED` twice. Re-run the final SBF build once WSL is healthy before deploying; the successful native tests are separate evidence. No WSL shutdown/restart was attempted because it could interrupt unrelated work.

The inherited API/frontend/server were not rebuilt or claimed production-ready. This validation applies only to the isolated `arena/` prototype.
