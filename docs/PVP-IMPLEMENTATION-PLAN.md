# AOCHAIN PvP implementation plan

## Base choice and boundaries

Start from upstream AOWeb to retain its browser rendering, artwork, protocol references and Argentum combat behavior. Preserve its history. Import selected localization, security and UX changes from ArgentumOnchain only after reviewing each change; never import runtime configuration, player records or secrets. Licensing remains unresolved as recorded in README.

No destructive changes to the running MMORPG are part of this project. The source server remains a behavioral reference until the arena prototype demonstrates parity.

## First playable milestone

Two test players join one fixed arena with fixed maximum-level loadouts. They move with the keyboard, use melee and one explicitly selected/targeted spell, receive damage and cooldown feedback, finish the match, and return to a lobby. Keep local prediction separate from authoritative validation.

1. Audit the movement/combat source and extract a deterministic rules specification with bounded positions, range, health, mana, cooldowns and win conditions.
2. Implement a minimal Solana/Anchor match program and local tests covering unauthorized actions, replay, timing, invalid targets, simultaneous lethal damage and one-time completion.
3. Integrate a local MagicBlock stack: create match state, delegate the match accounts, execute player actions, commit and undelegate. Distinguish ER execution from base-chain settlement.
4. Adapt the existing renderer and controls to authoritative account updates. Session permissions must be limited to the match and approved instructions, time-bound and revocable; no token-transfer authority.
5. Test two real clients on devnet and record input-to-feedback latency, confirmation latency, jitter, corrections, runtime availability and settlement recovery. No valuable assets in the prototype.

## Before ranked play

Implement matchmaking, disconnect/forfeit rules, timeout recovery, idempotent rewards, exclusive active matches and rating updates. Measure actual player-to-runtime latency before promising regional coverage. Verify operator trust, deployment authority, failure recovery and current MagicBlock fees/limits. On-chain execution does not prevent bots or collusive reward farming.

Choose ranked gear/potion normalization and a capped reward policy explicitly before adding transferable gold. Mainnet, production custody and live economic rewards are outside the prototype milestone.

## Validation boundaries

A local program test is not a real wallet, devnet settlement or global latency result. A recorded match winner from an off-chain server is not fully on-chain combat. Publishing this plan does not imply the prototype exists.
