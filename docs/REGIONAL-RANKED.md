# Regional ranked: off-chain combat, existing Solana characters

The current integration is described in [RANKED-ASSET-INTEGRATION.md](RANKED-ASSET-INTEGRATION.md). The default engine now runs the normalized level-50/newbie class preset in Node. The original Rust duel and MagicBlock clients remain explicit diagnostics.

Players enter through the existing ArgentumOnchain portal using an owned staked character. The asset API verifies custody and takes a global exclusive database lock before issuing a signed admission. Both players must have fresh server-observed p90 RTT strictly below 100 ms to the same regional server. Two players at 99 ms each can qualify: this is not a promise of under-100 ms player-to-player propagation. High-latency players stay queued; the limit never widens automatically. A signed start request transitions both reservations to playing before the engine starts.

The browser predicts movement and interpolates opponents. Damage, mana, cooldowns, spell validity and terminal results are server authoritative. Inputs carry a match ID and exact nonce. WebSocket origins, payloads, connection count, rate and overlapping actions are checked. Invisible opponents have positions removed from recipient snapshots. No wallet approval, Solana RPC or chain execution occurs in the action path.

Results are saved once and both fenced character locks are released in one central SQL transaction. Durable journals/outboxes allow interrupted-draw recovery on worker restart and retries after delivery failure. A disconnected player forfeits. Active sessions are never unlocked merely by a queue expiry timer. Keep one worker per region and its work volume persistent; loss/corruption of that storage requires operator investigation. Authenticated reconnect/resume is not implemented.

Cloud regional deployment and real-character activation remain pending. Configure per-region secrets, a private TLS or opt-in fixed gateway bridge, exact portal origins and persistent storage following the paired repository deployment guide. The prepared non-root Dockerfile was not built/run in this milestone. HMAC trusts the regional operator; it is not trustless combat proof.

For a local demo, install the arena/browser dependencies, build the browser bundle, set AOCHAIN_DEMO=1 and HOST=127.0.0.1, then run node arena/regional/server.mjs. Open /ranked in two tabs. The normalized engine needs Node 24; Rust is required only for the legacy diagnostic. Demo mode changes no assets, gold or rating.

PvE is deferred to a separate design. The supplied Argentum Offline archive had an executable/assets without source or a verified license; it was not executed or ported. The old practice bot is hidden from the ranked UI. Rating, rewards and equipment progression are deferred.

Local SQL/WebSocket lifecycle, duplicate receipt and worker crash/restart tests pass with mocked stake and isolated serialized PGlite. Browser checks cover level-50 gear, spellbook, explicit self-target casting and Forfeit/result modal. These do not establish live NFT ownership, native PostgreSQL concurrency, full original-game combat parity, regional WAN latency or 100-player capacity. Those remain release gates. No live production database, mainnet transaction or cloud region was changed.
