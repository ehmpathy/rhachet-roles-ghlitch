# F21 — the cycle-order guard reads the block count

## the fork

a peer notes that `is_cycle_in_order` compares `--cycle` against the count of `## cycle` blocks,
while `set_detect_rewound_with_cycle_carry` hedges a rewind that might archive `.claims/`. were
`.claims/` swept, the record would shrink to one re-carried block, and the count would no longer
equal the last cycle number.

- (a) read the last recorded cycle number, not the block count
- (b) drop the hedge, since the pinned rewind never sweeps `.claims/`
- (c) keep both; the mismatch halts loud and never passes a wrong cycle

## taken, and why

(c). the pinned `bhrain` rewind never sweeps `.claims/`, so the record stays contiguous (1..N) and
count equals the last number. under the hypothetical sweep, the next cycle meets
`cycle N+1 vs count 1` and the guard refuses it as out of order (exit 2) with the allowed cycles
named. that halt is loud, so no budget cap is skipped in silence. the hedge still earns its keep:
it re-carries keys after the rewind and reads them back, so a lost key halts.

## rework

clean. `get_cycle_last` (the last `## cycle N` header's number) in place of `get_cycle_count`, plus
its leaf-break cases and the `[case23]` order snapshots.

## confidence

75%. the 25% is whether the council prefers (a) now, before a future rewind starts to sweep.

## where

- `src/domain.roles/guardian/skills/security.habitat.redteam/output.sh` (`is_cycle_in_order`,
  `get_cycle_count`, `set_detect_rewound_with_cycle_carry`)

## verdict once ruled

_(awaits council)_
