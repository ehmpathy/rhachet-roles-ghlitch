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
# .note = for ANY child that RENDERS — a kin ghlitch skill, or a third-party tool that
#         draws its own headers and tree items. a render is framed whoever wrote it.
#
#         the one shape to leave at column 0 is a PAYLOAD: a data blob a named caller
#         parses verbatim (json, a schema diff, a live log stream). that exemption has
#         never yet applied in this repo — four skills claimed it (provision.database,
#         provision.declastruct, provision.terraform, deploy) and all four claims were
#         false: no caller read any of their stdout. open a claimed caller's file and
#         verify it before you honor it (rule.require.trust-but-verify).
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
  # the frame already supplies EXACTLY ONE blank spacer on each side, so a child that
  # emits a blank of its own at either edge renders a doubled gutter (`│` twice) there —
  # a visual blemish (rule.forbid.snapshot-visual-blemishes).
  #
  # kin ghlitch children dodge this by convention: they emit no seam of their own, and say
  # so (see the note atop uses._.check.sh). a THIRD-PARTY child cannot be held to that
  # convention — `rhx keyrack unlock` and `npx declastruct` both frame themselves with a
  # blank on each side — so the edge blanks are collapsed HERE, where the frame's own
  # spacer is known, rather than left to each child to get right.
  #
  # only the EDGES collapse. an interior blank is the child's own paragraph break and
  # renders as a bare gutter, exactly as before.
  local seen=0    # has a content line arrived yet? (a blank ahead of one is dropped)
  local held=0    # blanks banked since the last content line (a blank at the tail never flushes)
  "$@" 2>&1 | while IFS= read -r line; do
    if [[ -z "$line" ]]; then
      # bank it. it is emitted only if a content line follows — which is what proves it an
      # interior blank rather than one at the tail.
      [[ $seen -eq 1 ]] && held=$((held + 1))
      continue
    fi

    # a content line arrived, so every banked blank was interior after all: flush them as
    # bare gutters (no whitespace tail), then the line itself behind the "│  " gutter.
    while [[ $held -gt 0 ]]; do
      printf '%s│\n' "$indent"
      held=$((held - 1))
    done
    printf '%s│  %s\n' "$indent" "$line"
    seen=1
  done
  rc=${PIPESTATUS[0]}

  # blank spacer + close the bucket
  printf '%s│\n' "$indent"
  printf '%s└─\n' "$indent"
  return "$rc"
}

######################################################################
# .what = run a sub-skill in a bucket, and on failure close the PARENT's tree
#         before the run halts
#
# .why  = a bare `run_sub_bucket ... || exit $?` exits mid-frame. the bucket itself
#         closes (run_sub_bucket prints its own └─ before it returns), but the
#         COMPOSER's tree does not: its last line is the labeled branch item that
#         hosts the bucket, with no └─ ever printed for the tree that item belongs
#         to. the caller is left with a half-drawn tree, under a mascot that already
#         claimed the run was underway, and the verdict buried at the bucket's
#         gutter depth rather than stated at column 0.
#
#         so a composer that buckets a child which CAN fail uses this instead. it
#         closes the parent tree with a top-level item, states the belay at column
#         0, and forwards the child's own exit code.
#
# usage:
#   echo "   ├─ check the gate..."
#   run_sub_bucket_or_belay "   │  " "⛵ deploy" "blocked at the gate" \
#     bash "$DIR/uses._.check.sh" --meter deploy.uses --env prod
#
# args:
#   indent      the bucket frame column, as run_sub_bucket takes it
#   artifact    the composer's artifact header, for the belay block at column 0
#               (e.g. "⛵ deploy") — a mascot without one is a cat with no verdict
#   close_item  the text of the parent tree's final └─ item, which names the
#               OUTCOME ("blocked at the gate") — the cause is already in the bucket
#   rest        the sub-skill command + args
#
# guarantee:
#   - child exit 0 → returns 0, parent tree stays open to continue
#   - child exit N → closes the parent tree, belays at column 0 with a full artifact
#     block, exits N
#
# .note = the belay used to be a BARE `🐈 belay that...` with no block beneath it, so
#         five composers each ended a blocked run on a cat and no verdict at column 0 —
#         the outcome was stated only inside the tree, at the depth the reader is meant
#         to be able to skip. the artifact param exists to close that
#         (rule.require.status-feedback, `im_a.ghlitch_cat` mascot/artifact structure).
#
# .note = the mascot follows the EXIT CODE, never a fixed word. `belay that...` is the
#         constraint cat (exit 2, the caller has a fix to make); `wet paws...` is the
#         malfunction cat (any other non-zero, the run broke). the hardcoded
#         `belay that...` mislabeled every malfunction as the caller's fault
#         (rule.require.exit-code-semantics).
######################################################################

# run_sub_bucket_or_belay <indent> <artifact> <close_item> <command> [args...]
run_sub_bucket_or_belay() {
  local indent="$1"
  local artifact="$2"
  local close_item="$3"
  shift 3
  local rc=0

  # `|| rc=$?` rather than `|| exit $?` — the close below must run BEFORE the exit.
  run_sub_bucket "$indent" "$@" || rc=$?

  [[ $rc -eq 0 ]] && return 0

  local mascot="wet paws..."
  [[ $rc -eq 2 ]] && mascot="belay that..."

  echo "   └─ $close_item"
  echo ""
  echo "🐈 $mascot"
  echo ""
  echo "$artifact"
  echo "   └─ $close_item"
  exit "$rc"
}
