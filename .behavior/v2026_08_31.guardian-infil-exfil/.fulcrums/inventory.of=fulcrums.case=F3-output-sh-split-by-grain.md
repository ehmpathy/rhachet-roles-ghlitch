# F3 — split output.sh by operation grain now, or on the second consumer

## the fork

`output.sh` holds transformers, rhx communicators, the live-claim scanner + dispatch gate, and
`print_*` render operations under one name.

- (a) split it within the skill now: `grains.sh`, `route.sh`, `security.sh`, `output.sh`
- (b) hold one file; split when a second skill reads the scanner or the route communicators

## taken, and why

(b), with a named trigger: the split lands when the hardener twin (`security.product.redteam`,
the wish's second consumer) starts — as that twin's first change, never after it. one skill
sources this file today, and every caller (`security.habitat.redteam.sh`, `init.sh`, the test)
sources it whole. `rule.prefer.most-common-denominator` places an operation at its leaf until
reuse proves the lift. the file holds no labeled grain sections; the seams follow its dependency
direction — render (no deps) → flags/args → {cycle ledger, lesson gate, sweep route}. the ledger
and the gate each have one inbound edge, so each lifts without a rewrite.

## rework

clean. a split moves functions between files; no function name or contract changes, so no caller
hardens against the single-file shape. the shape is recorded in
`.dream/2026_09_10.redteam-output-sh-decompose-render-route-modules.dream.md`.

## confidence

80%. the 20% is whether the council wants the split before the twin starts, given the file's
size (~2000 lines).

## where

- `src/domain.roles/guardian/skills/security.habitat.redteam/output.sh`

## verdict once ruled

_(awaits council)_
