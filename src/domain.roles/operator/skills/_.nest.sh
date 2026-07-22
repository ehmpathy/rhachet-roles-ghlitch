#!/usr/bin/env bash
######################################################################
# .what = run a sub-skill inside a prescribed treestruct sub.bucket
#
# .why  = composed ghlitch skills (provision.database → use.rds.capacity →
#         use.vpc.tunnel) each print their own two-header block. streamed raw at
#         column 0 they run together, undelineated. run_sub_bucket frames each
#         sub-skill's full stdout inside its OWN treestruct sub.bucket — a labeled
#         item (e.g. "let's connect...") whose content is that child's full
#         output — so every invocation is clearly delineated under its own
#         header. each caller wraps each of its direct sub-skill calls, so the
#         nesting mirrors the call hierarchy. see the ergonomist brief
#         rule.require.treestruct-output for the bucket shape.
#
# .note = ONLY for ghlitch sub-skill invocations. NEVER wrap a pass-through
#         payload whose stdout is a forward contract (e.g. sql-schema-control
#         plan/apply output that CI greps for its up-to-date marker) — that must
#         reach the caller verbatim at column 0, unindented.
#
# usage:
#   source "$DIR/_.nest.sh"
#   # caller prints the branch line for the bucket item, then run_sub_bucket
#   # emits the ├─ … └─ frame + the child's full stdout at <indent>:
#   echo "   └─ lets get some sun..."
#   run_sub_bucket "      " "$SKILL_DIR/use.rds.capacity.sh" --env "$ENV" || exit $?
#
# args:
#   indent  the column at which the bucket frame (├─ │ └─) is drawn — line up
#           under the item's branch (a └─ item at 3 spaces → 6-space indent)
#   rest    the sub-skill command + args to run
#
# guarantee:
#   - emits a prescribed sub.bucket: open ├─, blank │, the child's full stdout
#     (each line prefixed "│  "), blank │, close └─
#   - streams the child output live (merged stdout+stderr)
#   - preserves the child exit code via PIPESTATUS
#
# .note = callers MUST invoke as `run_sub_bucket ... || exit $?`. the child runs in
#         a pipe (to the gutter formatter), and set -e will not fail-fast on a pipe
#         member on its own; the `|| exit $?` forwards the captured child exit so a
#         failure halts exactly like a direct invocation would.
######################################################################

# run_sub_bucket <indent> <command> [args...]
run_sub_bucket() {
  local indent="$1"
  shift
  local rc=0

  # open the bucket + the required blank spacer line
  printf '%s├─\n' "$indent"
  printf '%s│\n' "$indent"

  # stream the child live through the gutter formatter, then read the child's real
  # exit code from PIPESTATUS[0].
  # .note = the child exit MUST come from PIPESTATUS, not a sentinel echoed inside a
  #         process-substitution subshell: that subshell inherits the caller's set -e,
  #         so a non-zero child aborts it BEFORE the sentinel runs — the exit code is
  #         lost and a failfast leaks through. PIPESTATUS reads the child exit directly.
  # .note = callers MUST invoke as `run_sub_bucket ... || exit $?`; the `||` suppresses
  #         set -e across this whole function, so the pipe failure never aborts before
  #         PIPESTATUS is captured. the appended exit then fail-fasts like a direct call.
  "$@" 2>&1 | while IFS= read -r line; do
    # a bare child blank line becomes a bare gutter (no whitespace tail);
    # a content line is prefixed with the "│  " gutter.
    if [[ -z "$line" ]]; then
      printf '%s│\n' "$indent"
    else
      printf '%s│  %s\n' "$indent" "$line"
    fi
  done
  rc=${PIPESTATUS[0]}

  # blank spacer + close the bucket
  printf '%s│\n' "$indent"
  printf '%s└─\n' "$indent"
  return "$rc"
}
