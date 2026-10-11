//! Local rules harness only. This executable is not a validator or wallet.
use aochain_arena_core::{Action, Duel};
use serde::Deserialize;
use std::io::{self, BufRead, Write};
use std::time::Instant;
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Command {
    actor: usize,
    nonce: u64,
    kind: String,
    #[serde(default)]
    value: u8,
}
fn main() {
    let mut duel = Duel::new();
    let started = Instant::now();
    for line in io::stdin().lock().lines() {
        let result = (|| -> Result<(), String> {
            let command: Command =
                serde_json::from_str(&line.map_err(|_| "Input")?).map_err(|_| "Invalid command")?;
            if command.kind == "snapshot" {
                return Ok(());
            }
            let action = match command.kind.as_str() {
                "ready" => Action::Ready,
                "move" => Action::Move(command.value),
                "melee" => Action::Melee,
                "spell" => Action::Spell(command.value),
                "forfeit" => Action::Forfeit,
                "timeout" => Action::Timeout,
                _ => return Err("Invalid action".into()),
            };
            duel.apply(
                command.actor,
                command.nonce,
                started.elapsed().as_millis() as u64 / 50,
                action,
            )
            .map_err(|e| format!("{:?}", e))
        })();
        let tick = started.elapsed().as_millis() as u64 / 50;
        println!(
            "{}",
            serde_json::json!({"state":duel,"tick":tick,"error":result.err()})
        );
        io::stdout().flush().unwrap();
    }
}
