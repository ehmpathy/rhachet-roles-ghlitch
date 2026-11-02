# F38 — 1.ground cuts the per-peer slices at drive time, with no human pause

## .the fork
plan mode prints the grains, the prompts, and the projected spend. the per-peer slices are cut
later, by `1.ground`, inside the drive; the drive goes on to `2.detect` with no pause.

- pause after `1.ground` for a human to read the slices before peers dispatch
- cut and grade the slices in the drive, and let the plan be the human read before the spend

## .taken, why
the second. `1.ground` dispatches no peer: its guard grades the slices (disjoint, full coverage,
within the count, route dir excluded) before `2.detect` spends. a pause stone halts an autonomous
drive on every sweep for a read the guard already makes; the plan discloses this order in its
`per-peer slices` line.

## .rework
clean — a pause is one `.guard` that asks `--as approved` on `1.ground`; no caller depends on its
absence.

## .confidence
70% — whether a human must see the slices themselves, not only the grains, is a wisher call.

## .where
`src/domain.roles/guardian/skills/security.habitat.redteam/templates/1.ground.*`, the plan render

## .verdict
awaits council
