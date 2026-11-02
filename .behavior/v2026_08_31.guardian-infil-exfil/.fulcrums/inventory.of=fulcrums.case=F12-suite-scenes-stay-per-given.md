# F12 — suite scenes stay one per given; a shell prelude stays a named constant

## the fork

a peer asks to split `[case4]`'s scene into three builders (scaffold, params, slash scope), and to
turn `[case23]`'s `AFTER_CARRY_BREAKS_ONCE` prelude into a named function.

- (a) split each multi-concern scene into per-concern builders; wrap the prelude in a function
- (b) keep one `useBeforeAll` scene per `given`; keep the prelude a named constant with its intent

## taken, and why

(b). a `given` names one situation, and its scene is the setup of that situation; each `when`
reads the fixture it needs by a named key. a split adds three builders a reader must jump between
for one given. the prelude already carries a name and a one-line intent comment, the two things
the ask names; a function with no arguments adds a call and no sense.

## rework

clean. the split is local to the suite: three builders and three `useBeforeAll` calls, no
production code touched.

## confidence

80%. the 20% is whether the council prefers one scene per `when` as a suite-wide norm.

## where

- `src/domain.roles/guardian/skills/security.habitat.redteam.integration.test.ts` (`[case4]`,
  `[case23]`)

## verdict once ruled

_(awaits council)_
