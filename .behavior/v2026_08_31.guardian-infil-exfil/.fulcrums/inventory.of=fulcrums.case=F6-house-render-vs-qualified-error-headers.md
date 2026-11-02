# F6 — the ghlitch house render, or `✋ ConstraintError:` headers

## the fork

mechanic's `rule.require.qualified-error-headers` asks every human-read error to open with
`✋ ConstraintError:` or `💥 MalfunctionError:`. every ghlitch skill renders its errors in the
house shape instead: `🐈 belay that...` / `🐈 wet paws...`, then `<glyph> <command>`, then a tree
that closes on `└─ blocked:` or `└─ halted:`.

- (a) adopt the qualified header in this skill alone
- (b) keep the house render here; take the header question to the repo, for every skill at once

## taken, and why

(b). the house render already carries both halves of the rule's intent. the mascot line and the
close word are each keyed to the class: `belay that` + `blocked:` = constraint, exit 2;
`wet paws` + `halted:` = malfunction, exit 1 (`print_belay`, one source). the repo's
`rule.require.consistent-skill-contracts` and `im_a.ghlitch_cat` fix that vocabulary for every
kin skill, and `render.contract.integration.test.ts` audits it repo-wide. zero kin skills open
with `ConstraintError:`. a lone skill on a second header shape breaks the contract a caller
learns once, which is the harm the qualified-header rule exists to prevent.

## rework

clean. `print_belay` is the one render for every belay in the skill. a repo-wide switch edits
that function (and its kin in each role), then re-snaps; no caller hardens against the header text.

## confidence

80%. the 20% is whether the council reads the mechanic rule as one that overrides the repo's own
render contract.

## where

- `src/domain.roles/guardian/skills/security.habitat.redteam/output.sh` (`print_belay`)
- `src/domain.roles/render.contract.integration.test.ts`

## verdict once ruled

closed by a third option: fuse, rather than choose. the close line keeps the house close-word and
carries the qualified class behind its glyph: `└─ blocked: ✋ ConstraintError: <what>` (exit 2),
`└─ halted: 💥 MalfunctionError: <what>` (exit 1). `as_belay_close` is the one source. the house
shape a caller learns stays whole, and every human-read error names its class, so both
`rule.require.consistent-skill-contracts` and `rule.require.qualified-error-headers` hold. a
fork no longer stands; no council call is owed.
