# F11 — a cycle-lock time-out exits as a malfunction (1), not a constraint (2)

## the fork

`gen_cycle_record_lock` waits ~5s for the cycle record's lock, then gives up and names the lock,
its holder, and `rm -r <lock>`. a peer asks for exit 2: the remedy names an operator act.

- (a) exit 2 (`✋ ConstraintError`) on a time-out; thread a distinct rc through four layers
- (b) keep exit 1 (`💥 MalfunctionError`); the cause names the holder and the remedy

## taken, and why

(b). the time-out cannot tell its two causes apart with certainty. a holder that still runs is
contention, and a retry clears it: exit 1's sense ("a retry may help"). a holder whose pid is gone
is likely stale, but pid reuse makes `kill -0` a hint, not a proof. a constraint would tell the
operator "your input is wrong" for a run that only met a concurrent drive. the cause line names
the holder state either way, so the operator who must act reads why.

## rework

clean. one distinct return code from `gen_cycle_record_lock`, passed up through
`set_under_cycle_record_lock`, `set_cycle_carry`, `set_cycle_carry_confirmed`, and the rewind core
to `print_gate_verdict`. no caller outside the rewind reads it.

## confidence

80%. the 20% is whether the council reads "the holder is gone" as certain enough to blame the
operator.

## where

- `src/domain.roles/guardian/skills/security.habitat.redteam/output.sh` (`gen_cycle_record_lock`)

## verdict once ruled

_(awaits council)_
