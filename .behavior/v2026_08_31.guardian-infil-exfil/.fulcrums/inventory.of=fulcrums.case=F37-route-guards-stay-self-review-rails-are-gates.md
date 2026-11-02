# F37 — the route guards stay self-review; the critical rails are skill gates

## .the fork
every `*.guard` in the redteam route is a `reviews: self` prompt. an agent that skips a step can
pass its own review.

- add a peer or a deterministic judge to each guard
- keep the guards self-review, and move each critical rail into a skill gate the stone must
  invoke, with a guard blocker for a bypass

## .taken, why
the second. the acts that do irreversible harm already run through gates: `dispatch-lesson` (scan
before a public push), `rewind-detect` (carry + read back the open keys), `backup-before-rewrite`
(dirty-tree refusal + backup ref, read back). each guard blocks the raw command that bypasses its
gate. a peer reviewer per stone multiplies the per-cycle spend of a loop already priced per peer.

## .rework
clean — a guard gains a peer lane by a template edit; no caller depends on self-only review.

## .confidence
75% — whether a sweep needs a peer judge per stone is a cost call the wisher has not ruled.

## .where
`src/domain.roles/guardian/skills/security.habitat.redteam/templates/*.guard`

## .verdict
awaits council
