# F32 — stone and guard prose stays pinned by contract lines, not a whole-file snapshot

## the fork

r10 asks for a snapshot of each scaffolded stone and guard, beside the `[case12]` `toContain` pins.

- (a) snapshot each scaffolded template whole
- (b) pin each contract line (a rule, a blocker, a command) by `toContain`, and leave the prose free

## taken, and why

(b). the scaffold copies each template verbatim, so a whole-file snapshot is a second copy of the
template: every prose edit rewrites it, and a reviewer reads the diff twice. a `toContain` pin names
the one line a contract rests on, so a reorder keeps it green and a deletion reddens it. the chained
resume path (apply → rewind → apply) is driven by the gate cases (`[case38]` two cycles + a retry, `[case34]` reuse after a finished or reopened sweep), not by
template prose.

## rework

clean. one `toMatchSnapshot` per template in `[case12]`.

## confidence

75%. the 25% is a reword that keeps a pinned phrase but inverts the sentence around it.

## where

- `src/domain.roles/guardian/skills/security.habitat.redteam.integration.test.ts` (`[case12]`)

## verdict once ruled

_(awaits council)_
