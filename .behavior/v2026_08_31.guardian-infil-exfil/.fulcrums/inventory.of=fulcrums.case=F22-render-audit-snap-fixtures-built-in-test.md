# F22 — the render audit's .snap fixtures are built in the test, never cloned

## the fork

a peer asks that the render-contract fixtures be checked in and cloned via `genTempDir({ clone })`,
per the rule against ad hoc temp-dir builds.

- (a) check in `.test/assets/render-contract-*/…` and clone them
- (b) keep the in-test build for any fixture that holds a `.snap`

## taken, and why

(b). a checked-in `.snap` under `src/` is read by jest as an obsolete snapshot, and the `-u` run
the suite uses to re-cut snapshots deletes it. observed: the cloned `[case2]` fixture lost its
`elsewhere.snap` on the first `--resnap` run, and the walk then found no `.snap` to collect. the
in-test build writes the `.snap` into the temp dir, out of jest's sweep.

## rework

clean. a fixture dir outside jest's roots, or a jest `modulePathIgnorePatterns` entry for it.

## confidence

85%. the 15% is whether the council prefers a jest config carve-out over the in-test build.

## where

- `src/domain.roles/render.contract.integration.test.ts` (`[case2]`, `[case3]`, `[case4]`)

## verdict once ruled

_(awaits council)_
