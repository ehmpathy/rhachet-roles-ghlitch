# F30 — surface a repair adds rides the slice globs, with no carry field of its own

## the fork

a repair can add a file (a new guard, an allowlist). r10 asks for a carry field so the next cycle
re-hunts that added surface.

- (a) add a `surface added` field to the cycle record and a guard that the next detect reads it
- (b) leave added surface to the slice globs: `1.ground` cuts slices as directory globs that cover
  the whole scope, so a file a repair adds under the scope falls inside some slice's glob, and the
  rewound `2.detect` re-hunts it

## taken, and why

(b). the cycle record is gate-written and holds keys only; a path field there would carry tree
detail into a second ledger the gate must read back. the slice globs already cover the scope, so
the added file is re-read by the peer whose slice holds its dir. the gap (a) closes is a repair
that adds a file outside the scope, which a repair confined to the scope should not do.

## rework

clean. one field in `0.cycle.md`'s block, one guard line in `2.detect.guard`.

## confidence

65%. the 35% is a slice set cut as file lists rather than dir globs, which would leave a new file
outside every slice.

## where

- `templates/1.ground.stone`, `templates/2.detect.stone`, `templates/4.repair.stone`

## verdict once ruled

_(awaits council)_
