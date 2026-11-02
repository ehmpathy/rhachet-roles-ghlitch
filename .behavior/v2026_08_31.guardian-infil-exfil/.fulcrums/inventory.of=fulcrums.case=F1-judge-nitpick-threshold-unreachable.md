# F1 — judge `--allow-nitpicks 7` is structurally unreachable

## the fork, stated fairly

the stone `5.1.execution.from_vision` sits at **0 blockers across all 11 review lanes**, blocked
only by the judge `j1: --allow-blockers 0 --allow-nitpicks 7`, which tallies **one global
aggregate** and reports `nitpicks exceed threshold (41 > 7)`.

three ways forward were weighed:

1. **reduce the aggregate to ≤7 by fixes** — rejected: arithmetically impossible by any permitted
   driver action (see below).
2. **lift `--allow-nitpicks` to reflect the genuine residual** — the driver's preferred settle, but
   the guard is sealed and no mutate privilege exists, so a driver cannot do it → escalate.
3. **grant mutate privilege** (`rhx route.mutate grant allow`) so the driver lifts the threshold AND
   lands the three sealed stone/guard fixes (dream: sealed-stone-guard-gaps) — the higher-value
   settle → escalate.

## why option 1 is impossible (the arithmetic)

- the 41 splits: l1 = 20 (r1:2, r3:2, r4:5, r6:2, r7:4, r8:2, r9:3), l3 = 21 (r10:9, r11:12).
- **l1 is terminal + approved + cached by artifact hash.** its 20 nitpicks are frozen unless the
  hash changes and all 9 l1 lanes re-run. so **even a perfect l3 (0 nitpicks) leaves 20 > 7.**
- to move l1 down means an edit → a full l1 re-run on the **last** budgeted round (15/16), which
  (a) is stochastic (a fresh run reliably surfaces some nitpicks; 0.6/lane aggregate is
  unrealistic), (b) risks a fresh **blocker** on an otherwise-clean stone, and (c) still cannot
  touch the three genuine gaps that live in sealed `.stone`/`.guard` files.
- ⇒ no permitted change **would** close `41 > 7`. this is `rule.always.raise-a-blocker-a-taken-
  cannot-close`: a rejection an answer cannot converge, keyed on an absent grant.

## taken, and why — at the time

`--as blocked` with a runnable ask, after every r10/r11 point was answered in its `.taken` and
both lanes were contemplated. the 41 are **all reviewer-graded nitpicks (0 blockers)**; per
`rule.forbid.overzealous-blockers` a nitpick names no ship-harm, and `7` aggregate across 11 lanes
(0.6/lane) is a threshold calibrated for a far smaller artifact than a 5-shell-file + 5-stone/guard
+ integration-test skill. the residual is heavily cross-lane-duplicated (the vision-doc clause, the
`--peers/--budget` defaults, the bijection, the bind-race each recur across 3–4 lanes) and several
items are vision-scoped as separate deliverables.

## rework — why clean

both settles are one-field, no-ripple, reversible: a human edits the sealed guard's
`--allow-nitpicks` (suggest ~45 — the observed 41 residual + margin for l3 per-run variance), or
runs `rhx route.mutate grant allow` once. to lower the threshold back, or revoke the grant, is
equally trivial. no caller, contract, or artifact depends on the value.

## confidence — 80%, and why below 93%

- the **wall itself** is near-certain (~97%): `20 > 7` frozen is arithmetic, the guard is sealed,
  no `.privilege.mutate.flag` exists.
- the **80%** is the *settle*: which of option 2 vs 3 the wisher prefers, and the exact recalibrated
  number, is a judgment only the wisher owns — hence a fulcrum, not a unilateral driver edit even
  were privilege present.

## where

- judge: `5.1.execution.from_vision.guard` j1 (sealed) · stamp: `5.1.execution.from_vision.stamp`
- the sealed fixes that a mutate grant would also unblock: `.dream/2026_09_13.redteam-sealed-stone-guard-gaps.dream.md`

## verdict once ruled

refused, by the director (seed S1). no mutate grant; `--allow-nitpicks` stays 7. the tally drops
via per-concern absorption instead: a disputed concern sheds from the tally, cached lanes included.
the sealed-file fixes stay caught as dreams.
