# AOCHAIN

A browser-first Argentum Online PvP arena with regional off-chain combat and Solana character, item and gold ownership.

## Current status

This repository starts from upstream [AOWeb](https://github.com/dcatanzaro/aoweb), commit `f55f02635e008ed0e831742d28be5385f0583bd3`. The original game code and history are preserved. The current [regional ranked milestone](docs/REGIONAL-RANKED.md) runs the fixed-loadout Rust duel rules off-chain over WebSocket: Play ranked, wait for a compatible opponent, automatically start a duel, forfeit and queue again. Both players require recent measured ping strictly below 100 ms to the same server. Local prediction and authoritative correction are implemented. Actual movement/melee tests and the browser queue/forfeit flow pass locally; measured loopback action acknowledgments were 31–35 ms. This is not global latency or full AOWeb combat parity proof.

Regional container/configuration and best-region discovery are prepared, but cloud regions are not deployed. Real character admission and result settlement require connecting the existing Solana asset API; the local demo changes no assets, gold or rating. Argentum Offline PvE source is still unavailable: the supplied archive contains an executable and assets, not source code. Public authentication/recovery, global deployment, rating and complete PvP/PvE content remain release gates.

This is a separate project from [ArgentumOnchain](https://github.com/SrMessiSOL/ArgentumOnchain). Its running server, database, website and deployment are unchanged. This fresh upstream copy does not yet include that project's English localization, security fixes or wallet features.

## Target experience

Movement and combat run on regional authoritative game servers; Solana ownership checks occur at admission and economy settlement stays outside the combat loop. The previous MagicBlock program and `/chain`/`/devnet` clients remain diagnostic experiments. Their scripted devnet lifecycle and settlement were verified, but observed gameplay delay motivated the off-chain ranked architecture. See [the devnet history](docs/DEVNET-MILESTONE.md).

- Maximum-level characters with balanced class/loadout presets.
- A regional town lobby, practice duels and ranked 1v1 arenas.
- Regional matchmaking by latency and rating.
- Restricted session authorization for gameplay without a wallet prompt for every action.
- Match rules executed in Solana programs on MagicBlock Ephemeral Rollups, with results settled back to Solana.
- Gold and equipment progression to be designed alongside competitive balance and abuse prevention.

See [the implementation plan](docs/PVP-IMPLEMENTATION-PLAN.md). No performance, trustlessness or production-readiness claims are made for this initial repository.

## Upstream and licensing

AOWeb was created by Damián Catanzaro: [GitHub](https://github.com/dcatanzaro/aoweb), [X](https://x.com/DamianCatanzaro).

No LICENSE file was found in this upstream snapshot. Public availability does not establish unrestricted redistribution or commercial rights. Code and game artwork licensing must be clarified before a public product release. Original files and author attribution are retained; no new license is imposed over upstream material.

The [original setup guide](docs/UPSTREAM-README.md) is preserved for reference. It describes the existing off-chain game, not the planned MagicBlock arena. Use isolated local services and test accounts only; do not import live player data or custody keys.
