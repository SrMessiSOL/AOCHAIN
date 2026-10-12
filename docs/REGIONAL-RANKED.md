# Regional ranked: off-chain combat, Solana assets

## Decision

Movement and combat now use a persistent WebSocket connection to an authoritative regional Rust rules process. No validator, blockchain RPC or wallet approval is in the action path. The existing character staking, off-chain ordinary inventory/item withdrawal and SPL gold bridge remain in the separate ArgentumOnchain repository; they are not replaced or redeployed here. This change restores off-chain execution for the fixed-loadout duel slice, not complete AOWeb spell/content parity.

## Play locally

Build the existing `aochain-arena-runner` first (the Windows build is present in this workspace). Install `arena` dependencies with `npm ci`, build the browser bundle from `arena/integration`, then set `AOCHAIN_DEMO=1` and run `npm run start:ranked` from `arena`. Open `http://127.0.0.1:3210/ranked` in two tabs. No separate browser or wallet is needed for this explicit demo. Choose **Play ranked** on each tab. Countdown starts automatically. Cancel search, Forfeit and Play ranked again are available.

Demo identities are loopback-only. No Solana assets, economic rewards or persistent rating are used. The original `/chain` and `/devnet` experiments remain diagnostic tools, not the default combat architecture.

**PvE practice · fight a bot** starts a solo match immediately in demo mode. The bot uses the same authoritative movement, spell and melee rules and cooldowns as players; damage is never invented by the browser. Practice gives no rewards and is separate from ranked matchmaking. This is an arena training opponent, not the full Argentum Offline game.

## Latency gate

The server sends random WebSocket control-frame ping challenges through the actual gameplay socket, times the matching pong itself with a monotonic clock, and uses the 90th percentile of up to 20 samples from the last 15 seconds. Browsers answer control frames automatically, avoiding background JavaScript scheduling in the network RTT measurement. At least five observations are required. Each player must measure **strictly below 100 ms to the same server** when the match is created. High-latency or unmeasured players stay queued, with a clear reason; the threshold never widens automatically. This is not a promise of under-100 ms player-to-player propagation: two players at 99 ms RTT can both qualify. Ping and action processing are distinct metrics. If latency deteriorates mid-match, the server keeps the match together rather than migrating or invalidating it.

The browser predicts one local movement and interpolates opponents. Damage/mana/results come only from server state. Inputs carry match ID and exact nonce, and the rules engine enforces bounds, cooldowns and combat range. The server caps socket payloads, connection count, inbound message rate and overlapping per-player actions, checks WebSocket origins and disables compression. The disconnect policy is a server-authoritative forfeit; reconnect/resume needs additional work before public ranked release.

## Regional deployment prepared, not deployed

`arena/regional/Dockerfile` builds the Rust runner and browser bundle into a non-root Node image. Build from repository root with that Dockerfile. The container needs a persistent writable volume at `/app/arena/work`, TLS/WSS termination, an exact `PUBLIC_ORIGIN`, a regional `REGION_ID`, and a private `ASSET_ADMISSION_SECRET`. Demo mode refuses public binding. Docker build and cloud infrastructure are not verified in this workspace.

`regions.example.json` lists South America, North America, Europe, West Africa and Southeast Asia as **not provisioned**. Each region runs its own queue and matches. **Find my best region** probes configured real URLs over WebSocket and selects the lowest observed eligible latency; if none qualifies it does not widen the threshold. Set `REGIONS_JSON` to the actual available fleet and `PORTAL_ORIGINS` to trusted discovery portal origins. With no fleet configured, discovery measures only the local server. Public endpoints, real user measurements, carrier routing and capacity testing are required to establish coverage. Geography cannot be removed by software, and some players may have no eligible region.

## Existing Solana asset service integration contract

`asset-admission.mjs` prepares the issuer interface. Its repository implementation must, in one transaction, authenticate the account, verify linked wallet/ownership and on-chain character stake, lock the character bundle against PvE sessions, marketplace listing, unstaking and item/gold withdrawals, and return a fenced snapshot revision. Only then does the trusted service issue a 60-second admission ticket bound to region, character, wallet, lock and ticket ID. The regional server rejects unsigned/expired/wrong-region tickets, local reuse and concurrent character use. Global exclusion must come from the existing asset service/database lock, not the regional in-memory map.

The existing API's `assertPlayableCharacter` in `api/src/game-asset-policy.ts` already verifies the stake; `economy_lock` participates in marketplace exclusions. The actual ranked admission endpoint and transactional lock repository still need integration in that server checkout. Do not mint replacement characters or introduce a second gold ledger.

Match results are recorded once with a server-generated match ID and a region HMAC, flushed to disk before a result-recorded event. Combat servers have no mint/burn keys. The asset service must authenticate receipts, verify both lock fences, insert a unique match ID, atomically apply any configured reward ledger and unlock. `settleResult` is an interface, not an implemented Solana settlement worker. Rank/rewards remain disabled. Queue cancellation, admission expiry, server restart and failed result persistence need central lock recovery before assets can be enabled. HMAC authorization assumes trusted regional operators; it is not trustless combat proof.

## Validation

The actual WebSocket/Rust test rejects a simulated 150 ms opponent, pairs two low-latency clients, automatically readies both players, moves six tiles, performs melee damage, forfeits, records one result, rejects replay after finish, and starts another match. The measured maximum movement acknowledgment on loopback was 31 ms in the initial run; this is neither WAN nor production capacity proof. Policy tests cover insufficient/stale samples, the strict 100 ms boundary, tail latency, occupied sessions and authenticated admission claims. Issuer tests cover ownership rejection and exclusive cross-region locking through a test repository.

## Argentum Offline PvE

The user-provided `Downloads/AO_OFFLINE.zip` was inspected without executing its binaries. It contains 495 entries (approximately 22.9 MB uncompressed), a Windows executable, DLLs, BMP graphics and one map. No source-code files or license/readme files were found. The executable has not been run, redistributed or treated as a browser-compatible codebase. A PvE port cannot be claimed from this archive alone; the separate practice bot uses our existing rules instead.

The executable's readable metadata identifies “AO Offline By Dylan.-”. Targeted public source searches did not locate a verified repository for this exact build. The user also could not find it. An alternative PvE implementation using the existing AOWeb source should be scoped separately; it must not be presented as a port of this binary.

## Remaining public release gates

- Integrate the real asset-service issuer/lock repository and receipt worker; verify cancel, crash and stale-lock recovery against the existing database and Solana stake.
- Add authenticated reconnect/resume, deterministic crash recovery, durable matchmaking identity and duplicate-result rehearsal.
- Deploy actual regional endpoints, add portal region discovery, run real WAN ping/jitter/action measurements and 100-player capacity tests.
- Review the fixed-loadout Rust duel against AOWeb attack/spell timing and interaction behavior; complete combat parity and presentation.
- Obtain Argentum Offline source and asset permissions, then implement/test the PvE port.

No mainnet transaction or production asset/database change was made by this milestone.
