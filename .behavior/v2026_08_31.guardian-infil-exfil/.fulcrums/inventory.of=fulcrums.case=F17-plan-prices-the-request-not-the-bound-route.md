# F17 — plan prices the request; it does not probe the bound route

## the fork

a peer notes that `--mode plan` prices the request's `--peers` even when a grounded route is bound,
while `--mode apply` of the same flags belays (peers are fixed once 1.ground cuts the slices).

- (a) plan probes the bound route, reads its record, and applies the grounded-peers lock
- (b) plan stays a pure price of the request; apply holds the lock

## taken, and why

(b). plan makes no route, takes no bind, and runs with no `rhx` on PATH; a bind probe in plan adds
an `rhx` dependency and a new malfunction path (a probe break) to the one mode an operator runs to
read before any spend. no harm ships: apply belays the same flags at once and names the fix. the
plan tree states that a bound route keeps its recorded counts (`a bound route` branch), so the
operator reads the rule before the apply enforces it.

## rework

clean. a probe plus a lock check in the plan branch; plan renders gain one branch.

## confidence

75%. the 25% is whether the council wants plan to mirror apply's bound-route reads at the cost of an
`rhx` dependency in plan.

## where

- `src/domain.roles/guardian/skills/security.habitat.redteam.sh` (the plan branch, the reuse branch)

## verdict once ruled

_(awaits council)_
