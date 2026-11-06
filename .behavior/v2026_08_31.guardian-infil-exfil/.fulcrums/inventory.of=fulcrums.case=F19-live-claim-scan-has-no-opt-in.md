# F19 — the live-claim scan has no opt-in for a false positive

## the fork

a peer notes that the dispatch-lesson scan flags public constants a lesson may want to cite
(`169.254.169.254`, `127.0.0.1`, `github.com`, `package.json`), and that no override exists, so such a
lesson can never leave.

- (a) add an opt-in (an allowlist, or a `--allow <marker>` flag) so a cited public constant can pass
- (b) keep the scan refuse-only; a lesson that cannot shed its specific stays in `.claims/`

## taken, and why

(b). the vision sets the line: a live claim is refused by default and leaves only on an argued
opt-in. the push is the one irreversible public act, and the agent that drafts the lesson is the one
that would grant its own opt-in, so an override is a hole of the exact shape the gate closes. a
fullsun-safe lesson names a class, and a class reads the same with the constant spelled in words
("the cloud metadata endpoint", "the loopback address"). a false positive costs one rewrite; a false
negative publishes a habitat's map.

## rework

clean. an allowlist file plus one grep `-v` stage in `scan_for_live_claim_markers`; one case per
allowed constant.

## confidence

80%. the 20% is whether the wisher wants a human-held opt-in (a flag only a human passes) for the
rare lesson whose constant is the lesson.

## where

- `src/domain.roles/guardian/skills/security.habitat.redteam/output.sh` (`scan_for_live_claim_markers`)
- `src/domain.roles/guardian/skills/security.habitat.redteam/templates/5.promote.stone` (§5.1)

## verdict once ruled

_(awaits council)_
