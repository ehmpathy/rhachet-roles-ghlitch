# F15 — the route date reads the host clock; the suite does not pin it

## the fork

a peer notes that `as_route_slug` reads `date +%Y_%m_%d`, so a scene that spans midnight derives
two slugs and a "route already stands today" case can redden (or, in [case35], pass for the wrong
reason).

- (a) add a clock seam: a `date` shim on the suite PATH, or an env override `as_route_slug` reads
- (b) keep the host clock; accept the midnight window as a rare loud red

## taken, and why

(b). an env override is a test seam in the shipped contract: a caller could set it and name a
route for another day. a `date` shim on PATH changes every `date` call the skill makes, not only
the slug. the window is the seconds a scene spans across midnight; a red there names its cause in
the slug diff. the one false-green path ([case35]) still asserts three routes and an exit-2 belay,
both of which hold on a same-day run.

## rework

clean. a `date` stub in `stub.bin` plus a PATH entry per scene; no contract change.

## confidence

80%. the 20% is whether the council weighs the midnight window as worth a stub.

## where

- `src/domain.roles/guardian/skills/security.habitat.redteam/output.sh` (`as_route_slug`)
- `src/domain.roles/guardian/skills/security.habitat.redteam.integration.test.ts` ([case5] [t7],
  [case28], [case35])

## verdict once ruled

_(awaits council)_
