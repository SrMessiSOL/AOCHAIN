# AOCHAIN

A browser-first Argentum Online PvP arena with regional off-chain combat and Solana character, item and gold ownership.

## Current status

This repository starts from upstream [AOWeb](https://github.com/dcatanzaro/aoweb), commit `f55f02635e008ed0e831742d28be5385f0583bd3`. Original code and history are preserved. The [regional ranked milestone](docs/REGIONAL-RANKED.md) runs authoritative off-chain combat over WebSocket: Play ranked, wait for a compatible opponent, automatically start a duel and forfeit or finish. Both players require recent measured ping strictly below 100 ms to the same server. Local prediction and authoritative correction are implemented. Local movement/melee and browser queue/forfeit checks pass; loopback measurements are not global latency or full AOWeb combat parity proof.

The [character integration](docs/RANKED-ASSET-INTEGRATION.md) now implements owned staked-character admission, exclusive database locks, temporary level-50/newbie presets, the class-valid duel spellbook, and transactional result/unlock with duplicate and worker-restart recovery. The normalized authoritative Node engine is now the default; the earlier Rust engine is a legacy diagnostic. Saved character inventory, gold and progression remain unchanged. Five isolated SQL/WebSocket lifecycle tests pass; stake is mocked, so these are not live NFT or native PostgreSQL concurrency proof.

Regional container/configuration and discovery are prepared, but cloud regions are not deployed. The paired API and portal changes must be deployed/configured on the existing server and Vercel before real characters can play. The local demo changes no assets, gold or rating. PvE is deferred to a separate design.

This is a separate project from [ArgentumOnchain](https://github.com/SrMessiSOL/ArgentumOnchain). Its API remains the sole character/custody authority; this repository does not duplicate minting or the gold ledger. Changes are prepared in both repositories without modifying the running server or production database.

## Target experience

Movement and combat run on regional authoritative game servers; Solana ownership checks occur at admission and economy settlement stays outside the combat loop. The previous MagicBlock program and `/chain`/`/devnet` clients remain diagnostic experiments. Their scripted devnet lifecycle and settlement were verified, but observed gameplay delay motivated the off-chain ranked architecture. See [the devnet history](docs/DEVNET-MILESTONE.md).

- Maximum-level characters with balanced class/loadout presets.
- Ranked 1v1 arenas; PvE will be built separately later.
- Regional matchmaking by latency and rating.
- Restricted session authorization for gameplay without a wallet prompt for every action.
- Server-authoritative results, with Solana ownership and economy outside the realtime loop.
- Gold and equipment progression to be designed alongside competitive balance and abuse prevention.

See [the implementation plan](docs/PVP-IMPLEMENTATION-PLAN.md). No performance, trustlessness or production-readiness claims are made for this initial repository.

## Upstream and licensing

AOWeb was created by Damián Catanzaro: [GitHub](https://github.com/dcatanzaro/aoweb), [X](https://x.com/DamianCatanzaro).

No LICENSE file was found in this upstream snapshot. Public availability does not establish unrestricted redistribution or commercial rights. Code and game artwork licensing must be clarified before a public product release. Original files and author attribution are retained; no new license is imposed over upstream material.

The [original setup guide](docs/UPSTREAM-README.md) is preserved for reference. It describes the existing off-chain game, not the planned MagicBlock arena. Use isolated local services and test accounts only; do not import live player data or custody keys.
