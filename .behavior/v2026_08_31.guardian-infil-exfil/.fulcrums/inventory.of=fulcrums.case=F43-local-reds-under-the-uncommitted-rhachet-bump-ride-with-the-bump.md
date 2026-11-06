# F43 — local reds under another route's uncommitted rhachet 1.50 bump ride with that bump

## .the fork
5.3 demands every suite green. on the work tree, 6 of 1692 integration tests and the acceptance
build fail. each reads the installed rhachet, and the work tree holds 1.50.1 from
`.route/v2026_11_01.package.install/` (uncommitted). the pr pins 1.48.0; ci on the pr head passes
every suite.

- fix here: resnap the keyrack-tip and stdout snapshots, delete the self-boot onBoot hooks
- reinstall the committed lockfile here, to get a local green
- prove the pr head by ci, catch each fix as a dream owed to the bump

## .taken, why
the third. a resnap or hook removal here encodes 1.50 behavior against the 1.48 lockfile and turns
this pr's ci red. a reinstall clobbers another route's in-flight install. ci ran every suite whole
on the exact head under review.

## .rework
clean — if the council wants a local green, a worktree of `80b4487` with a frozen install runs it
with no change to either route.

## .confidence
80% — the npm `Unknown project config` lines are not proven to come from the bump; they may come
from this host's npm. either way they never show in ci and sit in a file this pr never touched.

## .where
`5.3.verification.yield.md` § tests executed; `review/self/for.5.3.verification._.has-all-tests-passed.md`;
dream `dreams/v2026_11_02.followup.rhachet-1-50-self-boot-hooks.md`

## .verdict
superseded. the director ruled the bump a driver-set act, to settle in this tree; F45 adopts it and
fixes each red at its cause. the dream this entry cited is done and retired.
