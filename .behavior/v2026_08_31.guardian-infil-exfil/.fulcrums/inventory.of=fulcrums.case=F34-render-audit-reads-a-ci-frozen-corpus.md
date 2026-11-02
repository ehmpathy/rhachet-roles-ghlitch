# F34 — the render audit reads the snapshot corpus at collection; CI freezes that corpus

## the fork

r7 i018 blocker.1: `render.contract` walks every `src/**/*.snap` at describe time, while other
jest workers in the same run may write snapshots. a half-written file could throw, and a snapshot
written after the read goes ungraded in that run.

- (a) a post-jest audit task, or a read with a stat-before-and-after retry
- (b) keep the read at collection: the gated run passes `--ci` (package.json `test:integration`,
  `$([ -n "${CI:-}" ] && echo '--ci')`), under which jest writes no snapshot, so the corpus the
  gate grades is the committed one, frozen for the whole run

## taken, and why

(b). the harm the blocker names is a false green that ships. under `--ci` no worker writes a
`.snap`, so neither a torn read nor an ungraded new render can occur in the run that gates a
merge. the race reaches only a local run that writes snaps (`--resnap`, or a first snapshot), whose
next run, and CI, grade the settled corpus. a post-jest task is a second test harness for a hazard
the gate already excludes.

## rework

clean. move the walk into a `then`, or a `test:audit` step after `test:integration`.

## confidence

80%. the 20% is a local developer who trusts a green from a run that also wrote snaps.

## where

- `src/domain.roles/render.contract.integration.test.ts` (`[case1]`)
- `package.json` (`test:integration`)

## verdict once ruled

_(awaits council)_
