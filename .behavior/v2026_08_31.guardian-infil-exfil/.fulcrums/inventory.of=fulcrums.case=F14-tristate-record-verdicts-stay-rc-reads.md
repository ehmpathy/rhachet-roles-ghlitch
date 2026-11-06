# F14 — the cycle-record verdicts stay tri-state return codes, read by name at each site

## the fork

a peer reads `(( rc != CYCLE_BLOCK_ABSENT ))` as a double negative and asks for named yes/no guards
(`is_cycle_rewound`, `is_key_held`) that an orchestrator reads as `if is_x; then`.

- (a) wrap each read in a guard shaped for `if`: 0 = yes, 1 = no, a third code = a read break
- (b) keep the three named verdicts (`0`, `CYCLE_READ_BROKE`, `CYCLE_BLOCK_ABSENT`) and branch on
  the named constant at each site

## taken, and why

(b). a guard shaped for `if` invites `if is_cycle_rewound …; then … fi`, where a read break falls
into the else arm as "not rewound", and the gate then rewinds again: the exact fold
`rule.forbid.failhide` names. the three verdicts are each a named constant, and every site reads
the read-break arm first, so a break can never pass as either answer. the decode cost sits in one
header per guard, which states all three codes.

## rework

clean. a rename per site to a named guard; no render or contract a caller reads changes.

## confidence

75%. the 25% is whether the council prefers the `if`-shaped guard with a lint-like rule that every
caller checks the third code.

## where

- `src/domain.roles/guardian/skills/security.habitat.redteam/output.sh` (`set_cycle_carry_block`,
  `set_cycle_rewound_line`, `get_cycle_carry_absent`, `set_detect_rewound_with_cycle_carry`)

## verdict once ruled

_(awaits council)_
