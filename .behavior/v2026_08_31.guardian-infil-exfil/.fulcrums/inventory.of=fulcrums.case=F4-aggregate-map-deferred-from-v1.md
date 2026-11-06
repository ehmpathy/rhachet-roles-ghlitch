# F4 — the aggregate-map leak is deferred from v1

## the fork

the wish's "publication as recon" claim is a property of the whole corpus. blind disjoint peers
cannot see it by construction.

- (a) add a non-blind union pass in v1 that reads every slice's claims together
- (b) ship blind v1; disclose the limit in every verdict; defer the union pass

## taken, and why

(b). blindness is the sweep's core mechanism: it is why 17 claims surfaced where a review found
none. a union pass is a second design with its own partition and cost model. the vision itself
defers it. `5.promote.stone` carries a "scope limit" section in every verdict, so "converged"
never reads as "clean", and `[case12]` clamps that section against removal.

## rework

clean. a union pass is an added stone after `2.detect`; no extant stone, guard, or caller
changes shape to admit it.

## confidence

85%. the 15% is whether the wisher wants the headline example caught in v1 rather than named as
a limit.

## where

- `src/domain.roles/guardian/skills/security.habitat.redteam/templates/2.detect.stone`
- `src/domain.roles/guardian/skills/security.habitat.redteam/templates/5.promote.stone` (scope limit)

## verdict once ruled

_(awaits wisher)_
