# F26 — init stays create-or-refuse for a same-day route; it does not adopt one

## the fork

a same-day re-init for the same grain + scope meets an extant route dir.

- (a) adopt it: when the dir is whole and its record matches, bind if unbound and copy naught
- (b) refuse (exit 2), name the route, and name both remedies — drive it (bound first if unbound),
  or remove it and lose its `.claims/`

## taken, and why

(b). the route dir is the only home of a live sweep's `.claims/`. an adopt path must decide which
record wins when the request's peers or budget differ, which the apply reuse path already owns
(with its peers lock past `1.ground`). two adopt paths would drift. apply is the idempotent entry
(it reuses a bound route and adopts its counts); init is the explicit scaffold, and a scaffold
that silently re-uses a route hides that a sweep already ran today. the refusal's fix now names
the bind step for an unbound route and the `.claims/` loss, so neither remedy surprises.

## rework

clean. one branch in `exit_on_route_dir_verdict`: on `ROUTE_DIR_EXTANT`, check completeness and
the record, then bind.

## confidence

75%. the 25% is whether the council prefers init itself idempotent over the apply path.

## where

- `src/domain.roles/guardian/skills/security.habitat.redteam/init.sh` (`exit_on_route_dir_verdict`, `as_route_extant_fix`)

## verdict once ruled

_(awaits council)_
