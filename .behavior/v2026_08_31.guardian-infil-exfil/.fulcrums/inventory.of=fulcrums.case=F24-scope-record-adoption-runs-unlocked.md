# F24 — an apply's peers/budget adoption into the scope record runs unlocked

## the fork

`run_apply_reuse` reads the bound route's `0.scope.md`, decides whether the request's counts are
adoptable, then writes it. each write is atomic (`set_file_atomically`); the read → decide → write
is not. two overlapped applies on one bound route: the last writer wins, and the loser has printed
its own price.

- (a) hold a scope-record lock across the read, the decision, and the write
- (b) re-read the record right before the write; abort the adoption if it moved
- (c) leave it unlocked: the record holds the operator's own choice, written by one apply at a time

## taken, and why

(c). the two racers are two operator commands on one branch's bound route, each a deliberate
spend decision; no drive writes `0.scope.md` (the ward loop reads it). the cycle record differs:
its writers are agent steps a retry reflex can double, which is why it holds a lock. the worst
case here is a record that holds the second operator's counts, readable at once in the
handoff's state line — a visible last-writer-wins, never a torn record. a lock adds a stale-lock
remedy path to the apply surface for a race only a human can start.

## rework

clean. the extant `gen_cycle_record_lock` / `del_cycle_record_lock` pair takes any lock path, so
(a) is one wrapper around `run_apply_reuse`'s read-decide-write.

## confidence

75%. the 25% is whether a council reads two concurrent operator applies as a real path.

## where

- `src/domain.roles/guardian/skills/security.habitat.redteam.sh` (`run_apply_reuse`)

## verdict once ruled

_(awaits council)_
