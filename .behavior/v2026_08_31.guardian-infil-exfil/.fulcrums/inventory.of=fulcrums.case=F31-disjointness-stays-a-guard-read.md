# F31 — slice coverage and disjointness stay a guard read, with no computed overlap residual

## the fork

r10 asks for a derived file count and overlap residual over the `1.ground` slice globs.

- (a) a gate subcommand that expands each slice's globs and prints coverage + overlap counts
- (b) the `1.ground` self-review guard reads the slice table for coverage and disjointness

## taken, and why

(b). blindness and disjointness are prompt-enforced by design (`1.ground.stone` says so): every
peer shares the filesystem, so a computed residual proves the table, never the peers' reads. a
gate subcommand is a new contract surface with its own parse, halts, and tests, for a check whose
input an agent writes and whose output an agent reads. the guard already holds a blocker for an
overlap or an uncovered path.

## rework

clean. one subcommand beside `dispatch-lesson` and `rewind-detect`; the guard cites its output.

## confidence

70%. the 30% is a large scope, where an agent's read of glob coverage drifts and a count would not.

## where

- `templates/1.ground.stone`, `templates/1.ground.guard`

## verdict once ruled

_(awaits council)_
