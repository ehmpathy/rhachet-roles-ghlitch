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

the owner proofs, by path (cited in the suite header too):
- `radio.task.push --via gh.issues` → ehmpathy/rhachet-roles-bhuild
  `src/contract/cli/radioTaskPush.integration.test.ts` — the real cli under an isolated HOME;
  gh.issues auth failures held as `upstream:auth` (exit 2), and the `radio.uses` gate
- `route.bind.get|set` → ehmpathy/rhachet-roles-bhrain
  `src/domain.operations/route/bind/getRouteBindByBranch.integration.test.ts`,
  `setRouteBind.integration.test.ts`
- `route.stone.set` → ehmpathy/rhachet-roles-bhrain
  `src/domain.operations/route/stepRouteStoneSet.integration.test.ts`

the owner's real-cli test stops at auth: it proves the gate, the held record, and the auth
refusal, and it opens no live issue. no test anywhere opens a live github issue through
`radio.task.push`. that gap is the decision this fulcrum reserves, not an oversight: a live write
is a public issue on a shared repo, posted on every run, which a reader of that repo sees as spam.
the only safe shape is a sandbox repo with a scoped key and a cleanup, and that belongs to the
dispatcher role that owns the push, not to the guardian that calls it.

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

ruled by the director, 2026-11-02: neither (a) nor (b) as posed. no sandbox repo, no new key.
the live push gets one opt-in test, `[case9]` in
`src/blackbox/security.habitat.redteam.acceptance.test.ts`:

- it runs only under `REDTEAM_LIVE_PUSH=true`, so ci never runs it
- once named, an absent `GITHUB_TOKEN` throws a `ConstraintError` with its fix
- two dispatches of one fixed title must land (exit 0) under the same issue exid, so findsert
  holds and repeated live runs touch one issue

the vision states the exception in one line (`1.vision.yield.md` § groundwork).
