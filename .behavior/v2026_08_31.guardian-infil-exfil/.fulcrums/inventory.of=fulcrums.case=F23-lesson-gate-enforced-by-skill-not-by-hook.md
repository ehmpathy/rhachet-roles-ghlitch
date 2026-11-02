# F23 — the lesson gate is enforced inside the skill; a direct push is not yet blocked by a hook

## the fork

a peer shows that an agent can call `rhx radio.task.push --via gh.issues --into <teach repo>`
direct, past the `dispatch-lesson` scan gate, with no prompt. the stone forbids it in prose only.

- (a) ship a guardian PreToolUse hook now that refuses a direct push into the teach repo
- (b) ship a scan receipt the push must present
- (c) keep the gate in the skill this round; catch the hook as a dream with its shape

## taken, and why

(c). the gate's own push runs inside the skill process, never as an agent Bash call, so a
PreToolUse hook on agent commands is the right seam: it blocks the bypass and leaves the gate's
path open. that hook is new role infrastructure: a hook file, its registration in the role
manifest, its boot wire, and its own tests. it ripples beyond this stone's diff (dirty), so it
lands as its own change. two guards stand meanwhile: the dispatcher's `radio.uses` blocks every
push by default until a human allows the org, and the promote stone routes every lesson through
the gate behind a 🛑.

## rework

dirty. new role hook infra plus registration; caught as
`.dream/2026_11_01.guardian-lesson-push-hook.dream.md`.

## confidence

70%. the 30% is whether the council holds the merge for the hook, given the bypass is a
publication path.

## where

- `src/domain.roles/guardian/skills/security.habitat.redteam/output.sh` (`dispatch_fullsun_lesson`, `set_radio_lesson`)
- `src/domain.roles/guardian/skills/security.habitat.redteam/templates/5.promote.stone`

## verdict once ruled

_(awaits council)_
