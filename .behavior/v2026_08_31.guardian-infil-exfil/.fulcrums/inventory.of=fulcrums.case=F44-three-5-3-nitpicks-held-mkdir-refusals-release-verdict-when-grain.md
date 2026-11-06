# F44 — three 5.3 i001 nitpicks held, not reshaped

## the fork

three nitpicks ask for a render or label reshape; each could be done, each would cost a signal:

- r005 nitpick.4 — mask every mkdir refusal one way. (a) one mask · (b) keep two renders
- r005 nitpick.5 — the release-break verdict opens on the write. (a) reopen it on the release ·
  (b) keep the rewind-level verdict
- r006 nitpick.1 — split when blocks whose thens cover one slip class. (a) split · (b) keep

## taken, and why

(b) on all three.
- mkdir: `File exists` (contention) and `No such file or directory` (a broken create) are two
  refusals with two remedies; one mask would hide which one the operator met. the second is
  stable under `LC_ALL=C`
- release verdict: a left lock blocks every later write to the record, so the rewind did not
  land as a unit; the leaf cause and the `fix:` item both name the release
- when labels: each when names a slip class; its thens are members of it. a split adds blocks of
  one then each and no coverage

## rework

clean. each is a render string or a test label; no caller depends on either form.

## confidence

80%. the 20% is a council that weighs label granularity above the class-level group.

## where

- `src/domain.roles/guardian/skills/security.habitat.redteam/output.sh` (`gen_lock_dir_exclusive`,
  `as_not_rewound_verdict`)
- `src/domain.roles/guardian/skills/security.habitat.redteam.integration.test.ts` ([case3][t8],
  [case5][t1], [case5][t7])

## verdict once ruled

_(awaits council)_
