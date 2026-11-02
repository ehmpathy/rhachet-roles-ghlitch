# F35 — the sweep's pre-spend guards stay inline in the entry; the hoist is caught as a dream

## the fork

r4 i018 nitpick.4: the sweep entry runs its guards as bare statements, interleaved with function
definitions, while `init.sh` names the same policy (`require_init_request_sound`, `set_init_anchor`).

- (a) name the sweep guards (`require_sweep_request_sound`, `set_sweep_anchor`) and hoist every
  definition above one executable tail, this round
- (b) leave the entry order as is, and catch the restructure as a dream

## taken, and why

(b). the restructure moves every definition and the dispatch order of the skill's entry point,
the file every gate and every case runs through. it is safe but not clean: it ripples through the
whole entry and its review diff, in a round where every l1 lane has spent its budget, so no
reviewer would grade it. the guards are each a named call already (`belay_on_foreign_flags`,
`get_sweep_request_fault`, `exit_unless_repo_root`); only the group they form lacks a name.

## rework

clean. the hoist is mechanical; behavior stays byte-identical under the suite.

## confidence

75%. the 25% is that the two-shape drift between init and sweep bites before the dream lands.

## where

- `src/domain.roles/guardian/skills/security.habitat.redteam.sh`
- dream: `.dream/2026_11_02.redteam-sweep-entry-hoist.dream.md`

## verdict once ruled

_(awaits council)_
