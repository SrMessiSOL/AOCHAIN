# AOCHAIN

A browser-first Argentum Online PvP arena project exploring regional on-chain matches with MagicBlock on Solana.

## Current status

This repository starts from upstream [AOWeb](https://github.com/dcatanzaro/aoweb), commit `f55f02635e008ed0e831742d28be5385f0583bd3`. The original game code and Git history are preserved. An isolated [arena prototype](arena/README.md) now includes a deterministic Rust combat core, a two-player local browser lab using upstream character sprites, and a Solana program with MagicBlock delegation/settlement hooks. It has not been deployed or verified through a complete rollup match. Ranked matchmaking and the full PvP conversion remain planned.

This is a separate project from [ArgentumOnchain](https://github.com/SrMessiSOL/ArgentumOnchain). Its running server, database, website and deployment are unchanged. This fresh upstream copy does not yet include that project's English localization, security fixes or wallet features.

## Target experience

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
