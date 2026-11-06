# F13 — a communicator's stdout carries its value on success, its cause on failure

## the fork

a peer reads `REPO_ROOT="$(get_repo_root)" || halt_with … "cause: $REPO_ROOT"` as one variable with
two senses, and asks to part the value from the cause.

- (a) each communicator prints its value on stdout and its cause on stderr, and each caller
  captures the two apart (`2>` into a temp file, or a second out-var)
- (b) keep one contract for every communicator in the skill: stdout is the value when it returns 0,
  the cause when it returns non-zero; the return code says which

## taken, and why

(b). the contract is uniform across every communicator in `output.sh` and stated in each header
(`stdout = the cause on failure (return 1)`). the return code is the discriminator, and the caller
reads it on the same line, so a reader holds one rule, not one per call. a bash function cannot
return two strings without a temp file or a global out-var; the prior round removed a `printf -v`
out-var for its decode cost, and a temp file per call adds an i/o path that can itself fail. the
`cause:` label at each halt names which sense the variable carries there.

## rework

clean. the change is mechanical per communicator (stderr for the cause, a capture per caller), no
contract a user reads changes, and no render shifts.

## confidence

75%. the 25% is whether the council prefers the stderr split despite its temp-file cost in bash.

## where

- `src/domain.roles/guardian/skills/security.habitat.redteam.sh` (repo root, scope reads)
- `src/domain.roles/guardian/skills/security.habitat.redteam/init.sh` (same)
- `src/domain.roles/guardian/skills/security.habitat.redteam/output.sh` (every communicator)

## verdict once ruled

_(awaits council)_
