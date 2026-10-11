use anchor_lang::prelude::*;
use aochain_arena_core::{Action, Duel};
use ephemeral_rollups_sdk::anchor::{commit, delegate, ephemeral};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephem::MagicIntentBundleBuilder;

// Local prototype identity; no deployment/custody key is checked into Git.
declare_id!("FuHnshxKDZ5pPvGPPKko526eEWk6RCQCMRnVfCp8Y9pZ");
pub const SEED: &[u8] = b"arena";
pub const SESSION_SECONDS: i64 = 1200;

#[ephemeral]
#[program]
pub mod aochain_arena {
    use super::*;
    pub fn create(
        ctx: Context<Create>,
        match_id: u64,
        opponent: Pubkey,
        session: Pubkey,
        validator: Pubkey,
    ) -> Result<()> {
        let owner = ctx.accounts.owner.key();
        require!(
            opponent != owner
                && opponent != Pubkey::default()
                && session != Pubkey::default()
                && session != opponent,
            ArenaError::Authority
        );
        let local = pubkey!("mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev");
        let us = pubkey!("MUS3hc9TCw4cGC12vHNoYcCGzJG1txjgQLZWVoeNHNd");
        let eu = pubkey!("MEUGGrYPxKk17hCr7wpT6s8dtNokZj5U2L57vjYMS8e");
        let asia = pubkey!("MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57");
        require!(
            [local, us, eu, asia].contains(&validator),
            ArenaError::Validator
        );
        let account = &mut ctx.accounts.arena;
        account.match_id = match_id;
        account.owners = [owner, opponent];
        account.sessions = [session, Pubkey::default()];
        account.joined = false;
        account.delegated = false;
        account.settlement_requested = false;
        account.session_expires = Clock::get()?
            .unix_timestamp
            .checked_add(SESSION_SECONDS)
            .ok_or(ArenaError::Clock)?;
        account.validator = validator;
        account.bump = ctx.bumps.arena;
        account.duel = Duel::new();
        Ok(())
    }
    pub fn join(ctx: Context<Join>, session: Pubkey) -> Result<()> {
        let a = &mut ctx.accounts.arena;
        require!(
            !a.joined && !a.delegated && a.duel.phase == 0,
            ArenaError::State
        );
        require!(
            ctx.accounts.opponent.key() == a.owners[1],
            ArenaError::Authority
        );
        require!(
            session != Pubkey::default() && session != a.sessions[0] && session != a.owners[0],
            ArenaError::Authority
        );
        require!(
            Clock::get()?.unix_timestamp < a.session_expires,
            ArenaError::Expired
        );
        a.sessions[1] = session;
        a.joined = true;
        Ok(())
    }
    pub fn delegate<'info>(ctx: Context<'info, DelegateArena<'info>>, match_id: u64) -> Result<()> {
        let (expected, _) = Pubkey::find_program_address(
            &[
                SEED,
                ctx.accounts.owner.key().as_ref(),
                &match_id.to_le_bytes(),
            ],
            &crate::ID,
        );
        require_keys_eq!(ctx.accounts.arena.key(), expected, ArenaError::Authority);
        let validator;
        {
            let mut a = Account::<ArenaAccount>::try_from(&ctx.accounts.arena)?;
            require!(
                a.owners[0] == ctx.accounts.owner.key() && a.match_id == match_id,
                ArenaError::Authority
            );
            require!(
                a.joined && !a.delegated && a.duel.phase == 0,
                ArenaError::State
            );
            require!(
                Clock::get()?.unix_timestamp < a.session_expires,
                ArenaError::Expired
            );
            a.delegated = true;
            validator = a.validator;
            a.exit(&crate::ID)?;
        }
        ctx.accounts.delegate_arena(
            &ctx.accounts.owner,
            &[
                SEED,
                ctx.accounts.owner.key().as_ref(),
                &match_id.to_le_bytes(),
            ],
            DelegateConfig {
                validator: Some(validator),
                ..Default::default()
            },
        )?;
        Ok(())
    }
    /// The session has no transfer, close, delegation or arbitrary instruction authority.
    pub fn act(ctx: Context<Act>, nonce: u64, kind: u8, value: u8) -> Result<()> {
        let clock = Clock::get()?;
        let a = &mut ctx.accounts.arena;
        require!(
            a.delegated && a.joined && !a.settlement_requested,
            ArenaError::State
        );
        let signer = ctx.accounts.actor.key();
        let index = resolve_actor(a, &signer, clock.unix_timestamp).ok_or(ArenaError::Authority)?;
        let action = match kind {
            0 => Action::Ready,
            1 => Action::Move(value),
            2 => Action::Melee,
            3 => Action::Spell(value),
            4 => Action::Forfeit,
            5 => Action::Timeout,
            _ => return err!(ArenaError::Action),
        };
        a.duel
            .apply(index, nonce, clock.slot, action)
            .map_err(|e| {
                msg!("Arena rule rejected: {:?}", e);
                error!(ArenaError::Rule)
            })?;
        Ok(())
    }
    /// Recovery after expired session; no rewards or token movements in the prototype.
    pub fn expire(ctx: Context<Act>) -> Result<()> {
        let a = &mut ctx.accounts.arena;
        require!(
            a.delegated && !a.settlement_requested && a.duel.phase != 2,
            ArenaError::State
        );
        require!(
            Clock::get()?.unix_timestamp >= a.session_expires,
            ArenaError::Expired
        );
        a.duel.phase = 2;
        a.duel.winner = 2;
        Ok(())
    }
    pub fn revoke_session(ctx: Context<Act>) -> Result<()> {
        let a = &mut ctx.accounts.arena;
        require!(
            !a.settlement_requested && a.duel.phase != 2,
            ArenaError::State
        );
        let seat = a
            .owners
            .iter()
            .position(|key| *key == ctx.accounts.actor.key())
            .ok_or(ArenaError::Authority)?;
        a.sessions[seat] = Pubkey::default();
        Ok(())
    }
    pub fn settle(ctx: Context<Settle>) -> Result<()> {
        let a = &mut ctx.accounts.arena;
        require!(
            a.delegated && a.duel.phase == 2 && !a.settlement_requested,
            ArenaError::State
        );
        a.settlement_requested = true;
        a.exit(&crate::ID)?;
        MagicIntentBundleBuilder::new(
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
        .commit_and_undelegate(&[ctx.accounts.arena.to_account_info()])
        .build_and_invoke()?;
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(match_id:u64)]
pub struct Create<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(init,payer=owner,space=8+512,seeds=[SEED,owner.key().as_ref(),&match_id.to_le_bytes()],bump)]
    pub arena: Account<'info, ArenaAccount>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct Join<'info> {
    pub opponent: Signer<'info>,
    #[account(mut,seeds=[SEED,arena.owners[0].as_ref(),&arena.match_id.to_le_bytes()],bump=arena.bump)]
    pub arena: Account<'info, ArenaAccount>,
}
#[delegate]
#[derive(Accounts)]
pub struct DelegateArena<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    /// CHECK: Seeds and owner/data are checked explicitly before delegation.
    #[account(mut, del)]
    pub arena: UncheckedAccount<'info>,
}
#[derive(Accounts)]
pub struct Act<'info> {
    pub actor: Signer<'info>,
    #[account(mut,seeds=[SEED,arena.owners[0].as_ref(),&arena.match_id.to_le_bytes()],bump=arena.bump)]
    pub arena: Account<'info, ArenaAccount>,
}
#[commit]
#[derive(Accounts)]
pub struct Settle<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut,seeds=[SEED,arena.owners[0].as_ref(),&arena.match_id.to_le_bytes()],bump=arena.bump)]
    pub arena: Account<'info, ArenaAccount>,
}
#[account]
pub struct ArenaAccount {
    pub match_id: u64,
    pub owners: [Pubkey; 2],
    pub sessions: [Pubkey; 2],
    pub session_expires: i64,
    pub joined: bool,
    pub delegated: bool,
    pub settlement_requested: bool,
    pub validator: Pubkey,
    pub bump: u8,
    pub duel: Duel,
}
fn resolve_actor(a: &ArenaAccount, signer: &Pubkey, now: i64) -> Option<usize> {
    a.owners.iter().position(|k| k == signer).or_else(|| {
        if now < a.session_expires {
            a.sessions.iter().position(|k| k == signer)
        } else {
            None
        }
    })
}
#[error_code]
pub enum ArenaError {
    #[msg("Signer is not authorized for this match")]
    Authority,
    #[msg("Unsupported prototype runtime")]
    Validator,
    #[msg("Invalid match lifecycle state")]
    State,
    #[msg("Session deadline check failed")]
    Expired,
    #[msg("Invalid clock")]
    Clock,
    #[msg("Unknown gameplay action")]
    Action,
    #[msg("Gameplay rule rejected this action")]
    Rule,
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> ArenaAccount {
        ArenaAccount {
            match_id: 1,
            owners: [Pubkey::new_unique(), Pubkey::new_unique()],
            sessions: [Pubkey::new_unique(), Pubkey::new_unique()],
            session_expires: 100,
            joined: true,
            delegated: false,
            settlement_requested: false,
            validator: Pubkey::new_unique(),
            bump: 255,
            duel: Duel::new(),
        }
    }
    #[test]
    fn scoped_session_expiry_and_owner_recovery() {
        let a = fixture();
        assert_eq!(resolve_actor(&a, &a.sessions[0], 99), Some(0));
        assert_eq!(resolve_actor(&a, &a.sessions[1], 99), Some(1));
        assert_eq!(resolve_actor(&a, &a.sessions[0], 100), None);
        assert_eq!(resolve_actor(&a, &Pubkey::new_unique(), 99), None);
        assert_eq!(resolve_actor(&a, &a.owners[0], 101), Some(0));
    }
    #[test]
    fn account_fits_allocated_space_and_round_trips() {
        let a = fixture();
        let mut data = vec![];
        a.try_serialize(&mut data).unwrap();
        assert!(data.len() <= 520);
        let decoded = ArenaAccount::try_deserialize(&mut data.as_slice()).unwrap();
        assert_eq!(decoded.duel, a.duel);
        assert_eq!(decoded.sessions, a.sessions);
    }
}
