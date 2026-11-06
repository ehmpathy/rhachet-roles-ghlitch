# F9 — the init subcommand: `exec` init, or nest it in a bucket

## the fork

`rhx security.habitat.redteam init ...` validates its args, then `exec`s `init.sh`, so init's
own two-header render is the whole screen. on the apply path the skill captures init and nests
its output under `├─ init said` when init fails. a reviewer asks for one shape on both paths.

- (a) print a parent header, then nest init's render under a gutter on the init path too
- (b) keep `exec` on the init path

## taken, and why

(b). on the init path the parent has no content of its own: the subcommand IS init. a parent
header above a nested init render would stack two headers for one act, the shape
`rule.require.nest-subskill-output-in-buckets` exists to prevent. `exec` replaces the process,
so the operator sees exactly one skill's render and init's exit code passes through unchanged.
on the apply path the parent does have its own render (the plan, the handoff), so a nested
bucket is the right shape there. the reviewer graded this a nitpick and named the same ground.

## rework

clean. a switch to a bucket edits one branch of the dispatch; no caller reads the init render's
column.

## confidence

85%.

## where

- `src/domain.roles/guardian/skills/security.habitat.redteam.sh` (the `init` dispatch)

## verdict once ruled

_(awaits council)_
