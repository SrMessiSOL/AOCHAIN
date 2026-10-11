# Arena prototype validation — 2026-10-11

## Verified

- Seven native Rust combat tests: countdown, actor bounds, nonce replay, cooldowns, backwards clocks, tile boundaries, facing without entering an occupied tile, range, targeting, shared cooldowns, mana, first-lethal ordering, single completion, timeout, forfeit and atomic overflow rejection.
- Two native program tests: participant/session resolution and expiry boundary; account allocation and serialization round trip.
- Actual two-client HTTP test with separate capability cookies against the Rust executable: readiness, countdown, movement, replay rejection, actor injection rejection, five spell hits, winner detection, post-finish rejection, two-party rematch and stale-generation rejection. Unauthenticated and wrong-origin actions are rejected.
- Browser review in independent in-app/Chrome sessions: both players joined and readied; keyboard movement worked; select → Cast → opponent reduced the other client's health by 26 and the attacker's mana by 20. Original body/head sprites were inspected and aligned using upstream layout rules.
- `cargo check` with stable Linux Rust passed for the actual Anchor/MagicBlock program. `cargo build-sbf` produced a Solana executable locally. JavaScript syntax checks and Git whitespace checks passed.

## Not verified / next gates

- Local validator lifecycle transactions, delegation and base-chain settlement now pass; see the lifecycle evidence below. Browser subscriptions and local session signing are now implemented.
- The chain browser lab connects to local MagicBlock; the Rust lab remains separate. There is no real wallet connection in either lab.
- No devnet/mainnet deployment, real signatures, funding, gold, rating, asset ownership or payouts were exercised.
- Scoped session authorization and revocation pass with locally generated signers. Real browser wallet approvals and wall-clock session expiry remain untested. Slot-based cooldown timing must be calibrated against the selected runtime.
- Tested instruction boundaries, signer enforcement and delegation/settlement CPI pass locally; production character isolation and adverse recovery paths still need coverage.
- Disconnection recovery, pending commit reconciliation, matchmaking, prediction/interpolation, global latency and ranked balance remain unfinished.

## Build notes

Use the stable compiler for native program checks. The installed nightly compiler crashed during macro expansion. A Windows-mounted Linux build output stalled in a dependency build script; Linux-native build storage resolved it. Program dependencies follow the official example's pinned Anchor 1.0.2 / ephemeral-rollups-sdk 0.16.2 pairing. Generated binaries, build logs and the unfunded local identity key are excluded from Git.

The initial SBF build succeeded and produced a 321,072-byte executable. WSL failures originally blocked the final rebuild. WSL subsequently recovered, and the final incremental SBF build passed. Its SHA256 is `b9d9a8ff89a579c142f8542b148b4b8d0515b40cbd2baf939893eee8fe6b48f1`. No WSL shutdown or system library upgrade was performed.

## Local lifecycle evidence

The official validator package is pinned to 0.14.10; Solana test validator is 4.2.2. Ubuntu 22.04 could not load the validator's newer glibc/libstdc++ requirements. Verified Ubuntu archive packages were extracted into a private cache and used through their private dynamic loader; no system libraries were replaced. Empty package files from the low-space installation were replaced by a fresh isolated installation. A failed generated Windows-mounted build cache was removed to free space; live game files and keys were preserved.

The actual program passed create → join → delegate → session readiness/movement/spell → forfeit → commit/undelegate. Rejected unrelated participant, premature settlement, unauthorized action, nonce replay, revoked session and post-finish action all preserved arena bytes. Fresh RPC connection recovered nonce 3. The base-chain check requires arena program ownership and matching final result, not just a settlement-request flag. Test wallets were generated in memory and only local test SOL was used. Public local receipts are saved under ignored `arena/work/`; these are not devnet transactions.

The inherited API/frontend/server were not rebuilt or claimed production-ready. This validation applies only to the isolated `arena/` prototype.

## Browser chain integration

Two independent browsers exercised create/join/delegate, signed readiness, keyboard movement, a targeted spell (26 damage and 20 mana), reload recovery, forfeit and base-chain settlement. Both clients reported the committed result. Local signed-action samples were 92 ms movement, 110 ms spell and 192 ms forfeit; these single samples are not regional performance claims.

Final recovery changes load committed base-chain state after undelegation, align the countdown with the last authoritative tick, and retain result dismissal per pairing. Four JavaScript tests cover decoder/settlement/account-order boundaries and actual HTTP coordinator origin, body-size, identity binding and seat limits. Generated bundles and local key material remain excluded from Git. No real wallet or public-chain test is implied.

A fresh browser run also reproduced missing cookie retention in the in-app browser. A tab-scoped random resume capability fixed polling and reload registration; HTTP tests reject forged capabilities and identity changes. Both browsers subsequently recovered their seats, readied and entered the authoritative match. Browser automation then timed out on the native forfeit confirmation, so the final post-settlement reload/modal-dismissal changes are implemented but have not received a fresh end-to-end UI verification. The earlier completed two-browser settlement test remains separate evidence.
