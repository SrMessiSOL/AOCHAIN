//! Deterministic fixed-loadout duel rules. Ticks are supplied by the authority,
//! never by a browser. Timing is in runtime slots, not a claimed network latency.
pub const WIDTH: u8 = 16;
pub const HEIGHT: u8 = 12;
pub const MOVE_TICKS: u64 = 4;
pub const MELEE_TICKS: u64 = 19;
pub const SPELL_TICKS: u64 = 17;
pub const CROSS_TICKS: u64 = 16;
pub const COUNTDOWN_TICKS: u64 = 60;
pub const MATCH_TICKS: u64 = 12000;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(
    feature = "anchor",
    derive(anchor_lang::AnchorSerialize, anchor_lang::AnchorDeserialize)
)]
pub struct Fighter {
    pub x: u8,
    pub y: u8,
    pub heading: u8,
    pub hp: u16,
    pub mana: u16,
    pub nonce: u64,
    pub move_at: u64,
    pub melee_at: u64,
    pub spell_at: u64,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(
    feature = "anchor",
    derive(anchor_lang::AnchorSerialize, anchor_lang::AnchorDeserialize)
)]
pub struct Duel {
    pub fighters: [Fighter; 2],
    pub ready: [bool; 2],
    /// 0 lobby, 1 countdown/live, 2 finished. Winner 2 denotes a draw.
    pub phase: u8,
    pub winner: u8,
    pub starts_at: u64,
    pub expires_at: u64,
    pub last_tick: u64,
    pub revision: u64,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Action {
    Ready,
    Move(u8),
    Melee,
    Spell(u8),
    Forfeit,
    Timeout,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RuleError {
    Unauthorized,
    Finished,
    NotReady,
    Countdown,
    Replay,
    Cooldown,
    Bounds,
    Occupied,
    Target,
    Range,
    Mana,
    Clock,
    Overflow,
    NotExpired,
}

impl Default for Duel {
    fn default() -> Self {
        Self::new()
    }
}
impl Duel {
    pub fn new() -> Self {
        let fighter = |x, heading| Fighter {
            x,
            y: 6,
            heading,
            hp: 120,
            mana: 100,
            nonce: 0,
            move_at: 0,
            melee_at: 0,
            spell_at: 0,
        };
        Self {
            fighters: [fighter(4, 2), fighter(11, 4)],
            ready: [false; 2],
            phase: 0,
            winner: 2,
            starts_at: 0,
            expires_at: 0,
            last_tick: 0,
            revision: 0,
        }
    }
    /// Atomic even outside Solana: failed commands cannot mutate any state.
    pub fn apply(
        &mut self,
        actor: usize,
        nonce: u64,
        tick: u64,
        action: Action,
    ) -> Result<(), RuleError> {
        let mut next = *self;
        next.apply_inner(actor, nonce, tick, action)?;
        *self = next;
        Ok(())
    }
    fn apply_inner(
        &mut self,
        actor: usize,
        nonce: u64,
        tick: u64,
        action: Action,
    ) -> Result<(), RuleError> {
        if actor > 1 {
            return Err(RuleError::Unauthorized);
        }
        if self.phase == 2 {
            return Err(RuleError::Finished);
        }
        if tick < self.last_tick {
            return Err(RuleError::Clock);
        }
        if nonce
            != self.fighters[actor]
                .nonce
                .checked_add(1)
                .ok_or(RuleError::Overflow)?
        {
            return Err(RuleError::Replay);
        }
        if action == Action::Ready {
            if self.phase != 0 || self.ready[actor] {
                return Err(RuleError::NotReady);
            }
            self.ready[actor] = true;
            if self.ready == [true, true] {
                self.starts_at = tick
                    .checked_add(COUNTDOWN_TICKS)
                    .ok_or(RuleError::Overflow)?;
                self.expires_at = self
                    .starts_at
                    .checked_add(MATCH_TICKS)
                    .ok_or(RuleError::Overflow)?;
                self.phase = 1;
            }
        } else if action == Action::Forfeit {
            self.phase = 2;
            self.winner = (1 - actor) as u8;
        } else if action == Action::Timeout {
            if self.phase != 1 || tick < self.expires_at {
                return Err(RuleError::NotExpired);
            }
            self.phase = 2;
            self.winner = 2;
        } else {
            if self.phase != 1 {
                return Err(RuleError::NotReady);
            }
            if tick < self.starts_at {
                return Err(RuleError::Countdown);
            }
            if tick >= self.expires_at {
                return Err(RuleError::NotExpired);
            }
            let enemy = 1 - actor;
            let me = self.fighters[actor];
            let target = self.fighters[enemy];
            match action {
                Action::Move(heading) => {
                    if tick < me.move_at {
                        return Err(RuleError::Cooldown);
                    }
                    let (dx, dy) = match heading {
                        1 => (0, -1),
                        2 => (1, 0),
                        3 => (0, 1),
                        4 => (-1, 0),
                        _ => return Err(RuleError::Bounds),
                    };
                    let x = me.x as i16 + dx;
                    let y = me.y as i16 + dy;
                    if x < 1 || y < 1 || x >= WIDTH as i16 - 1 || y >= HEIGHT as i16 - 1 {
                        return Err(RuleError::Bounds);
                    }
                    let until = tick.checked_add(MOVE_TICKS).ok_or(RuleError::Overflow)?;
                    // Facing an adjacent opponent must work without walking through them.
                    if x != target.x as i16 || y != target.y as i16 {
                        self.fighters[actor].x = x as u8;
                        self.fighters[actor].y = y as u8;
                    }
                    self.fighters[actor].heading = heading;
                    self.fighters[actor].move_at = until;
                }
                Action::Melee => {
                    if tick < me.melee_at {
                        return Err(RuleError::Cooldown);
                    }
                    let (dx, dy) = match me.heading {
                        1 => (0, -1),
                        2 => (1, 0),
                        3 => (0, 1),
                        4 => (-1, 0),
                        _ => return Err(RuleError::Target),
                    };
                    if me.x as i16 + dx != target.x as i16 || me.y as i16 + dy != target.y as i16 {
                        return Err(RuleError::Range);
                    }
                    self.fighters[actor].melee_at =
                        tick.checked_add(MELEE_TICKS).ok_or(RuleError::Overflow)?;
                    self.fighters[actor].spell_at = self.fighters[actor]
                        .spell_at
                        .max(tick.checked_add(CROSS_TICKS).ok_or(RuleError::Overflow)?);
                    self.damage(enemy, 18, actor);
                }
                Action::Spell(index) => {
                    if index as usize != enemy {
                        return Err(RuleError::Target);
                    }
                    if tick < me.spell_at {
                        return Err(RuleError::Cooldown);
                    }
                    if me.x.abs_diff(target.x).max(me.y.abs_diff(target.y)) > 6 {
                        return Err(RuleError::Range);
                    }
                    if me.mana < 20 {
                        return Err(RuleError::Mana);
                    }
                    self.fighters[actor].mana -= 20;
                    self.fighters[actor].spell_at =
                        tick.checked_add(SPELL_TICKS).ok_or(RuleError::Overflow)?;
                    self.fighters[actor].melee_at = self.fighters[actor]
                        .melee_at
                        .max(tick.checked_add(CROSS_TICKS).ok_or(RuleError::Overflow)?);
                    self.damage(enemy, 26, actor);
                }
                _ => return Err(RuleError::Target),
            }
        }
        self.fighters[actor].nonce = nonce;
        self.last_tick = tick;
        self.revision = self.revision.checked_add(1).ok_or(RuleError::Overflow)?;
        Ok(())
    }
    fn damage(&mut self, target: usize, amount: u16, actor: usize) {
        self.fighters[target].hp = self.fighters[target].hp.saturating_sub(amount);
        if self.fighters[target].hp == 0 {
            self.phase = 2;
            self.winner = actor as u8;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn live() -> Duel {
        let mut d = Duel::new();
        d.apply(0, 1, 0, Action::Ready).unwrap();
        d.apply(1, 1, 0, Action::Ready).unwrap();
        d
    }
    fn reject(d: &mut Duel, actor: usize, nonce: u64, tick: u64, a: Action, e: RuleError) {
        let before = *d;
        assert_eq!(d.apply(actor, nonce, tick, a), Err(e));
        assert_eq!(*d, before);
    }
    #[test]
    fn authorization_replay_and_countdown() {
        let mut d = live();
        reject(&mut d, 2, 2, 60, Action::Melee, RuleError::Unauthorized);
        reject(&mut d, 0, 1, 60, Action::Move(2), RuleError::Replay);
        reject(&mut d, 0, 2, 59, Action::Move(2), RuleError::Countdown);
        d.apply(0, 2, 60, Action::Move(2)).unwrap();
        reject(&mut d, 0, 3, 60, Action::Move(2), RuleError::Cooldown);
        reject(&mut d, 0, 3, 59, Action::Move(2), RuleError::Clock);
    }
    #[test]
    fn range_target_and_cross_cooldown() {
        let mut d = live();
        reject(&mut d, 0, 2, 60, Action::Melee, RuleError::Range);
        reject(&mut d, 0, 2, 60, Action::Spell(0), RuleError::Target);
        reject(&mut d, 0, 2, 60, Action::Spell(1), RuleError::Range);
        d.apply(0, 2, 60, Action::Move(2)).unwrap();
        d.apply(0, 3, 64, Action::Spell(1)).unwrap();
        assert_eq!(d.fighters[1].hp, 94);
        reject(&mut d, 0, 4, 65, Action::Melee, RuleError::Cooldown);
        reject(&mut d, 0, 4, 80, Action::Spell(1), RuleError::Cooldown);
    }
    #[test]
    fn bounds_and_occupied() {
        let mut d = live();
        d.fighters[0].x = 1;
        reject(&mut d, 0, 2, 60, Action::Move(4), RuleError::Bounds);
        d.fighters[0].x = 10;
        d.fighters[0].heading = 4;
        d.apply(0, 2, 60, Action::Move(2)).unwrap();
        assert_eq!(d.fighters[0].x, 10);
        assert_eq!(d.fighters[0].heading, 2);
        d.apply(0, 3, 60, Action::Melee).unwrap();
        assert_eq!(d.fighters[1].hp, 102);
        reject(&mut d, 0, 4, 64, Action::Move(9), RuleError::Bounds);
    }
    #[test]
    fn mana_and_single_finish() {
        let mut d = live();
        d.fighters[0].x = 5;
        for n in 2..=6 {
            d.apply(0, n, 60 + (n - 2) * 17, Action::Spell(1)).unwrap();
        }
        assert_eq!(d.phase, 2);
        assert_eq!(d.winner, 0);
        reject(&mut d, 1, 2, 128, Action::Spell(0), RuleError::Finished);
        reject(&mut d, 0, 7, 129, Action::Forfeit, RuleError::Finished);
        let mut d = live();
        d.fighters[0].x = 5;
        d.fighters[0].mana = 19;
        reject(&mut d, 0, 2, 60, Action::Spell(1), RuleError::Mana);
    }
    #[test]
    fn first_lethal_action_wins() {
        let mut d = live();
        d.fighters[0].x = 5;
        d.fighters[0].hp = 1;
        d.fighters[1].hp = 1;
        d.apply(1, 2, 60, Action::Spell(0)).unwrap();
        assert_eq!(d.winner, 1);
        reject(&mut d, 0, 2, 60, Action::Spell(1), RuleError::Finished);
    }
    #[test]
    fn timeout_and_forfeit() {
        let mut d = live();
        reject(&mut d, 0, 2, 100, Action::Timeout, RuleError::NotExpired);
        d.apply(0, 2, 12060, Action::Timeout).unwrap();
        assert_eq!(d.winner, 2);
        let mut d = Duel::new();
        d.apply(1, 1, 0, Action::Forfeit).unwrap();
        assert_eq!(d.winner, 0);
    }
    #[test]
    fn overflow_is_atomic() {
        let mut d = Duel::new();
        d.apply(0, 1, 0, Action::Ready).unwrap();
        reject(&mut d, 1, 1, u64::MAX, Action::Ready, RuleError::Overflow);
    }
}
