# F16 — peers and budget stay positional args in the shell procedures

## the fork

a peer notes that `is_scope_record_kept`, `as_reuse_state`, `as_scope_record`, and `print_plan` take
peers and budget as adjacent positional args of one shape, so a swap renders a plausible tree.

- (a) pass one `peers=<n> budget=<n>` token per pair, parsed in the callee
- (b) keep positional args; pin each label against its value in the snapshots

## taken, and why

(b). bash has no named args; a packed token adds a parse in every callee, which is the decode
friction the prior rounds removed. each callee binds its positionals to named locals on line one,
and every render that prints the pair is snapped with distinct values (`--peers 6 --budget 3`), so
a swap reddens a snapshot rather than ships.

## rework

clean. a token pack and a parse per callee; no render changes.

## confidence

80%. the 20% is whether the council wants the parse cost for a swap the snapshots already catch.

## where

- `src/domain.roles/guardian/skills/security.habitat.redteam/output.sh` (`is_scope_record_kept`,
  `as_reuse_state`, `as_scope_record`, `print_plan`)
- `src/domain.roles/guardian/skills/security.habitat.redteam.sh` (their call sites)

## verdict once ruled

_(awaits council)_
