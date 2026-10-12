# Owned characters in the ranked arena

The existing [ArgentumOnchain API/portal](https://github.com/SrMessiSOL/ArgentumOnchain) remains the character and custody authority. Its new `ranked-service.ts` reserves an owned staked character, signs the region admission, starts two fenced sessions, records the result once and unlocks both characters atomically. The exact server-computer deployment steps are in that repository's [handoff](https://github.com/SrMessiSOL/ArgentumOnchain/blob/main/docs/RANKED-ASSET-INTEGRATION.md).

The player flow is Profile → Ranked PvP → choose an owned staked character → Play ranked → wait for a compatible opponent → automatic countdown → duel → result → unlocked character. The portal keeps account credentials; it sends only a short-lived ticket to the configured regional iframe with exact-origin/source checks. No wallet prompt is needed for movement/combat. Closing an active duel forfeits; cancelling a queued search unlocks. A fresh admission is needed for the next match.

## Temporary PvP preset

`arena/regional/export-pvp-data.mjs` exports class/race balance, starter gear and spell definitions from the paired source repository into checked-in `pvp-data.json`. Regenerate deliberately when source balance changes. `pvp-engine.mjs` calculates level-50 stats without rewriting saved character data. Class/race, character ID and name come from signed admission. Newbie gear, potion supplies, arrows and spell access are temporary arena loaners. Personal inventory, bank, level and gold stay untouched.

There are 25 duel-valid spells for a max-mana Mage; other classes retain mana restrictions, and Warrior/Hunter remain non-magic. Summons, single-elimination revival, NPC/admin spells and requirements above 100 skill are excluded. Server handlers cover damage/healing, mana, melee/ranged arrows, poison/antidote, paralysis/root/removal, buffs/debuffs, hunger, invisibility/reveal, stun/removal, mimicry and potions. Spell controls use select → Cast → valid target. This is a lean arena rule implementation with source-derived data, not a claim of complete AOWeb formula/timing/presentation parity.

## Lock and result lifecycle

The worker has a regional authentication secret but no mint/burn key. Before engine start it journals the match/participants and calls the central start transaction. Completion flushes an atomic receipt file to `arena/work/ranked-outbox`; delivery occurs separately from combat. Central SQL enforces match UUID uniqueness and validates both lock fences. Identical semantic receipts are idempotent, conflicting results reject, and old receipts cannot unlock a newer match. Delivery failure retains locks and retries without another reward application. Gold/rating rewards are disabled.

The worker periodically recovers journals without a result after restart or runner failure, resolving an existing match as an interrupted draw. If start never committed, release may only clear queued reservations. Do not run multiple workers sharing a region/work volume. Back up and retain that volume; lost or corrupted journals/outboxes require operator investigation, not blind SQL unlocks. The existing asset bridge and regional operator remain trusted.

## Configuration and validation

Worker configuration is in `arena/regional/.env.example`: matching `REGION_ID` and `ASSET_ADMISSION_SECRET`, exact HTTPS `PUBLIC_ORIGIN`, approved `PORTAL_ORIGINS`, and `ASSET_SERVICE_URL` pointing to the private TLS API or fixed opt-in `/region-api/ranked` bridge. The central API has a distinct secret per region in server-only `RANKED_REGIONS_JSON`. The bridge remains closed by default. A persistent writable work volume and HTTPS/WSS termination are required. The profile entry also stays hidden until Vercel `NEXT_PUBLIC_RANKED_ENABLED=1` is enabled after deployment.

Five paired API lifecycle tests pass, including two real local WebSocket clients, unchanged persistent bundles, JSONB duplicate recovery and killed-worker restart. Stake is mocked and the PGlite fixture serializes connections; native PostgreSQL concurrency/live NFT tests are pending. Preset tests cover every supported class/race pair, and every exported spell executes. The legacy WebSocket latency/forfeit test also passes. Browser verification includes self-targeted invisibility and a working Forfeit/result modal. API type checks and a fresh portal production build pass.

The wider API suite still needs its isolated running API/database fixtures and has existing wallet mock/vendor test harness failures; see the paired handoff. Real regions, WAN measurements, 100-player capacity, reconnect/resume, original Argentum combat parity and live Solana custody remain release gates. PvE is deferred to another design. Source preparation does not deploy the API/gateway on the other computer.
