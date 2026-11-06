# F27 — a route carries no skill version stamp

## the fork

a route's stones are copied at init; the gates (`rewind-detect`, `dispatch-lesson`) run from the
installed skill. a role upgrade mid-budget can skew the two.

- (a) stamp the skill version into `0.scope.md` at init, and have each gate belay on a mismatch
- (b) no stamp; the route's copied stones stand as the contract the drive walks

## taken, and why

(b). no shipped version of this skill precedes this one, so no skew can occur yet, and the first
stamp would have no prior version to compare. the gate contracts the stones name are pinned by
`[case12]` against the shipped templates, so a change to a gate that breaks a stone reddens there.
the stamp lands with the first change that alters a gate contract a stone names.

## rework

clean. one record line at init and one guard per gate.

## confidence

80%. the 20% is whether the council wants the stamp before the first version bump.

## where

- `src/domain.roles/guardian/skills/security.habitat.redteam/output.sh` (`as_scope_record`)

## verdict once ruled

_(awaits council)_
