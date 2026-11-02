# F10 — the self-dir resolves in each entry point, not via a shared `as_self_dir`

## the fork

both entry points open with `"$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"`, the dir the
entry point lives in. a peer asks for one named `as_self_dir` in `output.sh`.

- (a) move the resolution into `output.sh` as `as_self_dir`
- (b) keep one bootstrap line per entry point

## taken, and why

(b). the self-dir is what finds `output.sh`: `source "$SELF_DIR/$SKILL/output.sh"`. a transformer
inside `output.sh` cannot run before the file that holds it is sourced. and inside a sourced
function, `BASH_SOURCE[0]` names `output.sh`, not the caller, so the shared form would return the
wrong dir. the line is a bootstrap, the one statement that must precede the shared module.

## rework

clean. should a second module ever need the caller's dir, a `as_self_dir` that reads
`BASH_SOURCE[1]` can land in `output.sh` for post-source callers; the bootstrap line stays.

## confidence

85%. the 15% is whether the council would accept a bootstrap file sourced by a relative
path instead, which trades one inline line for a second file.

## where

- `src/domain.roles/guardian/skills/security.habitat.redteam.sh` (`SELF_DIR`)
- `src/domain.roles/guardian/skills/security.habitat.redteam/init.sh` (`INIT_DIR`)

## verdict once ruled

_(awaits council)_
