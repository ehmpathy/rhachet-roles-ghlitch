# F7 — prove the gh.issues push here, or where it is owned

## the fork

`dispatch_fullsun_lesson` scans a drafted lesson, then hands it to
`rhx radio.task.push --via gh.issues --idem findsert`. this suite clamps the gate against a stub
`rhx` that logs the push. a reviewer asks for a real call that opens a github issue and asserts
its shape.

- (a) add a real push to this suite, against the role-package repo
- (b) clamp this skill's own half (the scan, the refusal, the findsert flag) and leave the push
  contract to the dispatcher role that owns it

## taken, and why

(b). the push is not this skill's contract. `radio.task.push` belongs to the bhuild dispatcher
role, which owns its github auth, its findsert semantics, and its test. a real push from this
suite would open a real issue in a shared repo on every CI run, or need a sandbox repo and a
cleanup no one here owns. what this skill owns is the gate: [case20] proves each marker kind
and the fail-toward-dirty grep break; [case21] proves a dirty title or body sends naught and a
clean one goes out with `--idem findsert`. the vision now names the github write as an external
contract and points at its owner.

## rework

clean. a real-call case is one more `given`, with a sandbox repo and its keyrack key; no code
moves.

## confidence

75%. the 25% is whether the council wants an end-to-end smoke here despite the shared-repo cost.

## where

- `src/domain.roles/guardian/skills/security.habitat.redteam/output.sh` (`dispatch_fullsun_lesson`)
- `src/domain.roles/guardian/skills/security.habitat.redteam.integration.test.ts` ([case20], [case21])
- `.behavior/v2026_08_31.guardian-infil-exfil/1.vision.yield.md` (groundwork)

## verdict once ruled

_(awaits council)_
