# F33 — the sweep's render ops read the parsed request; a grain list rides the argv tail

## the fork

two i018 reviewers grade the same render signatures from opposite sides:

- r3 nitpick.1: `print_plan`'s eight named locals, then `shift 8` and a grain array, still couple
  by position; asks for fewer positionals (a render record, or a split grain renderer)
- r4 nitpick.3: `print_sweep_plan`, `halt_scope_record_unread`, and `print_init_render` read the
  parsed request (`SCOPE`, `GRAIN`, `PEERS`, `BUDGET`, `RUN_CMD`) from globals; asks for each value
  as a positional (`print_sweep_plan "$next" "$SCOPE" "$GRAIN" "$PEERS" "$BUDGET" "$RUN_CMD" …`)

- (a) pass every value positionally (r4), which lengthens the positional lists r3 objects to
- (b) bundle into a render record (r3), which bash holds only as a global or a nameref
- (c) keep the shape: the request, parsed once at the entry and never mutated after the reuse
  adoption, is read by the render ops of that entry; leaf renders (`print_plan`) take named locals
  bound on line 1 and a grain list as the argv tail, the one variadic bash allows

## taken, and why

(c). bash has no record type; (b) lands as a global by another name. (a) and r3 pull opposite
ways on the same signatures, so either fix re-raises the other. the leaf (`print_plan`) already
binds each positional to a named local on its first line, and the entry ops read a request that
the entry owns. a reader of a render op finds each input named at its first use.

## rework

clean. `print_plan_grains` split, or a positional pass at the three entry ops; no contract change.

## confidence

65%. the 35% is that a split grain renderer would satisfy r3 and leave r4's ask moot.

## where

- `security.habitat.redteam/output.sh` (`print_plan`, `print_grain_prompts`)
- `security.habitat.redteam.sh` (`print_sweep_plan`, `halt_scope_record_unread`), `init.sh` (`print_init_render`)

## verdict once ruled

_(awaits council)_
