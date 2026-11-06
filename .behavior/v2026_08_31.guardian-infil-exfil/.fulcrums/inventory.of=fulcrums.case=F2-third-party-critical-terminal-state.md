# F2 — a critical third-party disclosure has no terminal state

## the fork

a critical `third-party disclosure` claim is never repaired by design, so `5.promote` can never
reach convergence and its budget-out escalation ("add budget") misleads.

- (a) add a third terminal state now (draft name `blocked-on-third-party`), with a guess at its
  loop effect
- (b) defer it to a dream; ship the two mechanical template fixes this round

## taken, and why

(b). the state's name and whether the loop halts or continues on the other claims shape every
later sweep's verdict. that is the wisher's call, and a guessed state baked into the templates
would harden callers against it.

## rework

clean. the change lands in `5.promote.stone` §5.2 and `5.promote.guard` only; no caller reads a
terminal-state name today.

## confidence

85%. the deferral is safe: the gap fails toward an over-cautious verdict ("add budget"), never a
false "converged". the 15% is whether the wisher wants the state in v1.

## where

- `src/domain.roles/guardian/skills/security.habitat.redteam/templates/5.promote.stone` §5.2
- dream: `.dream/2026_09_13.redteam-sealed-stone-guard-gaps.dream.md`

## verdict once ruled

_(awaits wisher)_
