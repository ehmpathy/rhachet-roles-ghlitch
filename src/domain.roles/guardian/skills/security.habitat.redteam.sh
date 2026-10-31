#!/usr/bin/env bash
######################################################################
# 🧿 security.habitat.redteam — hunt a habitat the way an adversary would
#
# .what = a route-backed ward loop that reads a habitat through three
#         grains — infil (ways in), exfil (ways out), leak (already out) —
#         dispatches blind, disjoint-scope peers, fans their claims in,
#         verifies, repairs (gated), and promotes the lessons. it does NOT
#         attack; it figures out where wards are needed via empathy of the
#         adversary.
#
# .why  = a code review asks "is this code good?"; a redteam asks "what
#         reaches in, what could get out, and what's already out?". the
#         grain does the work a review is blind to — an aggregate map, an
#         open exfil channel, a compositional infil chain.
#
# usage:
#   rhx security.habitat.redteam init --scope . --grain all
#   rhx security.habitat.redteam --scope . --grain all --peers 6 --budget 3 --mode plan
#   rhx security.habitat.redteam --scope . --grain all --peers 6 --budget 3 --mode apply
#   rhx security.habitat.redteam help
#
# options:
#   --scope PATH    the habitat surface to sweep (a repo, a subtree)   (required)
#   --grain GRAIN   infil | exfil | leak | all                         (required)
#                     infil  — inbound channels (ways in)
#                     exfil  — outbound channels (ways out, every exit)
#                     leak   — exposed values (already out)
#                     all    — three disjoint partitions, one per grain
#   --peers N       blind peers per grain-partition (breadth)          (default: 3)
#   --budget N      the loop's spend allowance (drawn per cycle)       (default: 1)
#   --mode MODE     plan | apply                                       (required)
#                     plan   — emit the partition + prompts + cost, drive no peer
#                     apply  — scaffold the route + hand off to route.drive
#                              (the ward loop itself runs under route.drive — the
#                               blind-peer dispatch/detect/verify/repair/promote is
#                               agent work driven through the stones, not this shell)
#   --skip-route-bind   scaffold WITHOUT a route bind to this branch (an escape
#                       hatch; the drive then needs a manual bind first)
#
# guarantee:
#   - exit 0 = plan emitted, or apply scaffolded the route + handed off to route.drive
#              (the ward loop itself runs under route.drive, not in this shell)
#   - exit 1 = malfunction (a peer/tool broke, an unexpected state)
#   - exit 2 = constraint (absent/invalid args, absent scope)
#
# note: informational only — NOT professional security advice. every
#       guidance output carries the disclaimer; live claims are never
#       published (the dispatch tool is itself an exfil channel).
######################################################################
set -euo pipefail

SKILL="security.habitat.redteam"
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# the shared ghlitch vibes + route-probe/render operations — so this
# orchestrator reads as narrative (get_bound_route / extract_redteam_route_path
# / print_nested_lines) and the not-security-advice disclaimer lives in ONE
# place (print_disclaimer), sourced by init.sh too.
source "$SELF_DIR/$SKILL/output.sh"

show_help() {
  echo "🐈 heres the deal..."
  echo ""
  echo "🧿 $SKILL — hunt a habitat the way an adversary would"
  echo ""
  echo "   the ward loop: ground → detect → verify → repair → promote → (loop | terminate)"
  echo ""
  echo "usage:"
  echo "  rhx $SKILL init --scope <path> --grain <grain>"
  echo "  rhx $SKILL --scope <path> --grain <grain> --peers <n> --budget <n> --mode plan"
  echo "  rhx $SKILL --scope <path> --grain <grain> --peers <n> --budget <n> --mode apply"
  echo ""
  echo "options:"
  echo "  --scope   habitat surface to sweep (a repo, a subtree)   (required)"
  echo "  --grain   infil | exfil | leak | all                     (required)"
  echo "  --peers   blind peers per grain-partition (breadth)      (default: 3)"
  echo "  --budget  the loop's spend allowance (drawn per cycle)   (default: 1)"
  echo "  --mode    plan | apply                                   (required)"
  echo "  --skip-route-bind   scaffold without a branch bind (escape hatch)"
  print_disclaimer
  exit 0
}

# require a value for a flag — belay fast when the next token cannot serve as
# the value (absent, or a FLAG token that would eat the next flag whole). the
# same shape + hint as every kin skill (rule.require.consistent-skill-contracts).
# NOTE: $3 is a HINT only — it is printed on an absent/flag-shaped value, NOT an
# enum check. an invalid-but-present value (e.g. --grain bogus) passes here and is
# caught by the dedicated enum validation below (is_valid_grain / the --mode case).
require_val() {
  # $1 = flag name, $2 = candidate value, $3 = optional comma-joined valid set (hint)
  if [[ -z "$2" || "$2" == --* ]]; then
    echo "🐈 belay that..."
    echo ""
    echo "🧿 $SKILL"
    [[ -n "${3:-}" ]] && echo "   ├─ fix: pass one of $3"
    echo "   ├─ hint: rhx $SKILL help"
    echo "   └─ blocked: absent value for $1"
    exit 2
  fi
}

# parse arguments. rhx prepends --skill/--repo/--role, so a subcommand like
# `init` arrives mid-stream, never as $1 — detect it IN the loop.
SUBCOMMAND=""
SKIP_ROUTE_BIND=""
SCOPE=""
GRAIN=""
PEERS="3"
BUDGET="1"
MODE=""
while [[ $# -gt 0 ]]; do
  case $1 in
    init)
      SUBCOMMAND="init"
      shift
      ;;
    --skip-route-bind)
      SKIP_ROUTE_BIND="1"
      shift
      ;;
    --scope)
      require_val --scope "${2:-}"
      SCOPE="$2"
      shift 2
      ;;
    --grain)
      require_val --grain "${2:-}" "$(as_grain_hint)"
      GRAIN="$2"
      shift 2
      ;;
    --peers)
      require_val --peers "${2:-}"
      PEERS="$2"
      shift 2
      ;;
    --budget)
      require_val --budget "${2:-}"
      BUDGET="$2"
      shift 2
      ;;
    --mode)
      require_val --mode "${2:-}" "plan,apply"
      MODE="$2"
      shift 2
      ;;
    --skill|--repo|--role)
      # skip rhx passthrough args. shift the flag, then its value IF one comes next
      # AND that token is not itself a flag — a blind `shift 2` both aborts on a
      # final-token flag (set -e) and eats the next legit flag as a phantom value.
      shift
      [[ $# -gt 0 && "$1" != --* ]] && shift
      ;;
    --)
      shift
      ;;
    help|--help|-h)
      show_help
      ;;
    *)
      echo "🐈 belay that..."
      echo ""
      echo "🧿 $SKILL"
      echo "   ├─ hint: rhx $SKILL help"
      echo "   └─ blocked: unknown argument: $1"
      exit 2
      ;;
  esac
done

# validate --scope (required, must exist)
if [[ -z "$SCOPE" ]]; then
  echo "🐈 belay that..."
  echo ""
  echo "🧿 $SKILL"
  echo "   ├─ hint: rhx $SKILL help"
  echo "   └─ blocked: absent required arg: --scope"
  exit 2
fi
if [[ ! -e "$SCOPE" ]]; then
  echo "🐈 belay that..."
  echo ""
  echo "🧿 $SKILL"
  echo "   ├─ fix: pass a path that exists (a repo or a subtree)"
  echo "   └─ blocked: scope not found: $SCOPE"
  exit 2
fi
# canonicalize the surface so a reuse request spelled `./` matches a route bound for `.`
# (and `src/` matches `src`) — one form feeds the header, the match-assert, and INIT_ARGS.
SCOPE="$(as_normalized_scope "$SCOPE")"

# validate --grain (required, enum — membership via the ONE is_valid_grain check)
if [[ -z "$GRAIN" ]]; then
  echo "🐈 belay that..."
  echo ""
  echo "🧿 $SKILL"
  echo "   ├─ fix: pass one of $(as_grain_hint)"
  echo "   └─ blocked: absent required arg: --grain"
  exit 2
fi
if ! is_valid_grain "$GRAIN"; then
  echo "🐈 belay that..."
  echo ""
  echo "🧿 $SKILL"
  echo "   ├─ fix: pass one of $(as_grain_hint)"
  echo "   └─ blocked: invalid grain: $GRAIN"
  exit 2
fi

# validate --peers / --budget (positive integers, via the one named guard)
if ! is_positive_integer "$PEERS"; then
  echo "🐈 belay that..."
  echo ""
  echo "🧿 $SKILL"
  echo "   ├─ fix: pass a positive integer (blind peers per grain-partition)"
  echo "   └─ blocked: invalid --peers: $PEERS"
  exit 2
fi
if ! is_positive_integer "$BUDGET"; then
  echo "🐈 belay that..."
  echo ""
  echo "🧿 $SKILL"
  echo "   ├─ fix: pass a positive integer (the loop's spend allowance)"
  echo "   └─ blocked: invalid --budget: $BUDGET"
  exit 2
fi

# the active grains (all → the three GRAIN_LIST partitions, from the one source)
if [[ "$GRAIN" == "all" ]]; then
  GRAINS=("${GRAIN_LIST[@]}")
else
  GRAINS=("$GRAIN")
fi
GRAIN_COUNT="${#GRAINS[@]}"
# the peers → total → projected arithmetic chain, each link a named transformer
PEER_TOTAL="$(compute_peer_total "$PEERS" "$GRAIN_COUNT")"

# init subcommand — scaffold the route (delegated)
if [[ "$SUBCOMMAND" == "init" ]]; then
  INIT_SH="$SELF_DIR/$SKILL/init.sh"
  if [[ -x "$INIT_SH" ]]; then
    # thread --peers/--budget through to init — a value validated here but dropped
    # from INIT_ARGS is a silent no-op the operator never sees (the loop cannot read it).
    INIT_ARGS=(--scope "$SCOPE" --grain "$GRAIN" --peers "$PEERS" --budget "$BUDGET")
    [[ -n "$SKIP_ROUTE_BIND" ]] && INIT_ARGS+=(--skip-route-bind)
    exec bash "$INIT_SH" "${INIT_ARGS[@]}"
  fi
  echo "🐈 wet paws..."
  echo ""
  echo "🧿 $SKILL init"
  echo "   ├─ the route scaffold (init.sh) is absent: $INIT_SH"
  echo "   └─ halted: the skill install is broken"
  exit 1
fi

# --mode is required + enum-validated for a non-init run. an invalid value must
# belay (exit 2), never fall through both branches to a silent exit-0 success.
case "$MODE" in
  plan|apply) ;;
  "")
    echo "🐈 belay that..."
    echo ""
    echo "🧿 $SKILL"
    echo "   ├─ fix: pass plan or apply"
    echo "   └─ blocked: absent required arg: --mode"
    exit 2
    ;;
  *)
    echo "🐈 belay that..."
    echo ""
    echo "🧿 $SKILL"
    echo "   ├─ fix: pass plan or apply"
    echo "   └─ blocked: invalid --mode: $MODE"
    exit 2
    ;;
esac

# the projected cost — deterministic, printed before any spend. the arithmetic
# (peer-total × budget-cycles) lives behind a named transformer so the plan emitter
# reads as narrative (rule.require.named-transformers). the chain's second link:
# PEER_TOTAL (compute_peer_total, above) → projected (here).
PROJECTED="$(compute_projected_cost "$PEER_TOTAL" "$BUDGET")"

emit_plan() {
  echo "🧿 $SKILL --scope $SCOPE --grain $GRAIN --peers $PEERS --budget $BUDGET"
  echo "   ├─ scope: $SCOPE"
  echo "   ├─ grains: ${GRAINS[*]}  ($GRAIN_COUNT partition(s), disjoint by grain-surface)"
  echo "   ├─ peers: $PEERS per grain-partition  ⇒ $PEER_TOTAL blind peers total"
  echo "   ├─ budget: $BUDGET loop cycle(s) — each draws one detect → verify → repair pass"
  echo "   ├─ projected: $PEER_TOTAL peers × $BUDGET cycle(s) = up to $PROJECTED peer-dispatch runs"
  echo "   ├─ the ward loop: ground → detect → verify → repair → promote → (loop | terminate)"
  echo "   └─ per-grain prompts (each peer is blind to the others' slice + theory)"
  print_grain_prompts "${GRAINS[@]}"
  echo "      └─ each claim = a chain (entry/exit → mechanism → blast radius|audience), keyed on channel+mechanism"
}

# plan mode — emit the partition + prompts + projected cost, drive NO peer
if [[ "$MODE" == "plan" ]]; then
  echo "🐈 chartin course..."
  echo ""
  emit_plan
  print_disclaimer
  exit 0
fi

# apply mode — the ward loop runs through the route stones. the blind-peer
# dispatch, detect, verify, repair, and promote are LLM-agent work, driven
# through the route's stones + guards (like cicd.deflake / declapract.upgrade),
# NOT a shell engine. so apply scaffolds the route (idempotent) and hands the
# operator into the drive — and only ever promises a drive the route can take.
if [[ "$MODE" == "apply" ]]; then
  echo "🐈 chartin course..."
  echo ""
  emit_plan
  echo ""

  # is a redteam route already bound? get_bound_route surfaces a genuine probe
  # malfunction — it never treats a tool break as a "no route bound" verdict.
  if ! BOUND_ROUTE="$(get_bound_route)"; then
    echo "🐈 wet paws..."
    echo ""
    echo "🧿 $SKILL --mode apply"
    echo "   ├─ fix the cause above, then re-run"
    echo "   └─ halted: could not probe the bound route (rhx route.bind.get malfunctioned)"
    exit 1
  fi

  if [[ -n "$BOUND_ROUTE" ]]; then
    # the bind is a persisted STRING that can outlive the route dir (a deleted dir, a
    # changed checkout). confirm the route is actually driveable on disk BEFORE the clean
    # "drive it" handoff — else apply exits 0 and promises a drive with no route to walk
    # (rule.forbid.failhide). the scaffold branch already re-probes; this closes the reuse
    # branch's twin gap.
    if ! is_route_on_disk "$BOUND_ROUTE"; then
      echo "🐈 wet paws..."
      echo ""
      echo "🧿 $SKILL --mode apply"
      echo "   ├─ bound route is absent on disk: $BOUND_ROUTE"
      echo "   ├─ fix: unbind (rhx route.bind.del), then re-run to scaffold fresh"
      echo "   └─ halted: the bind persists but its route dir + stones are gone"
      exit 1
    fi
    # is_route_on_disk proves the dir + at least one stone survive — it does NOT prove the
    # COMPLETE required set. a bound route partly deleted after bind (a checkout change or a
    # manual cleanup dropped 3.verify.stone/.guard while 0.scope.md + one stone survive) would
    # pass is_route_on_disk AND the scope-record assert (which reads only 0.scope.md), so apply
    # would exit 0 and promise a drive that walks an incomplete route and fails partway for an
    # invisible reason. verify the WHOLE required set here, exactly as the scaffold branch does
    # via get_route_absent_files, so a partial reuse halts loud (rule.forbid.failhide).
    REUSE_ABSENT="$(get_route_absent_files "$BOUND_ROUTE")"
    if [[ -n "$REUSE_ABSENT" ]]; then
      echo "🐈 wet paws..."
      echo ""
      echo "🧿 $SKILL --mode apply"
      echo "   ├─ bound route is incomplete on disk: $BOUND_ROUTE"
      echo "   ├─ absent required file(s):"
      print_nested_lines "   │  " <<< "$REUSE_ABSENT"
      echo "   ├─ fix: unbind (rhx route.bind.del), then re-run to scaffold fresh"
      echo "   └─ halted: a partial route cannot be driven to terminal"
      exit 1
    fi
    # a route is already bound — but it may have been scaffolded for a DIFFERENT
    # scope/grain, or a different breadth/spend than the plan just printed. drive the
    # WRONG surface silently and the operator believes the requested sweep ran when it
    # did not. assert the bound route's recorded scope + grain + peers + budget match
    # this request, and belay on a mismatch (rule.forbid.friction-hazards — silent
    # wrong-sweep). the assert prints its own belay and exits on mismatch.
    assert_bound_route_matches_request "$BOUND_ROUTE" "$SCOPE" "$GRAIN" "$PEERS" "$BUDGET"
    ROUTE_STATE="reused the bound route"
    ROUTE_BOUND=yes
  else
    # none bound — scaffold one. the scaffold (init.sh) is the named operation;
    # capture its output (never stream a sub-skill's own headers at column 0 —
    # rule.require.nest-subskill-output-in-buckets) and CHECK the result.
    if [[ ! -x "$SELF_DIR/$SKILL/init.sh" ]]; then
      echo "🐈 wet paws..."
      echo ""
      echo "🧿 $SKILL --mode apply"
      echo "   ├─ fix the skill install, then re-run"
      echo "   └─ halted: the route scaffold (init.sh) is absent or not executable"
      exit 1
    fi
    INIT_ARGS=(--scope "$SCOPE" --grain "$GRAIN" --peers "$PEERS" --budget "$BUDGET")
    [[ -n "$SKIP_ROUTE_BIND" ]] && INIT_ARGS+=(--skip-route-bind)
    # a CLEAN init (exit 0) is the ONLY green light to proceed. any non-zero init —
    # a refuse-to-clobber (exit 2, whose message NAMES an extant route path), a broken
    # install, a bind that did not take (exit 1) — is halted here, with init's own
    # output surfaced. never infer "scaffolded" by a parse of a route path out of
    # init's text: that path also appears in the "route already exists" refusal, so a
    # same-day foreign route would be reused (wrong-sweep) if we trusted the parse.
    INIT_RC=0
    INIT_SAID="$(scaffold_route "$SELF_DIR/$SKILL/init.sh" "${INIT_ARGS[@]}")" || INIT_RC=$?
    if [[ "$INIT_RC" -ne 0 ]]; then
      echo "🐈 wet paws..."
      echo ""
      echo "🧿 $SKILL --mode apply"
      echo "   ├─ init did not cleanly scaffold a fresh route:"
      print_nested_lines "   │  " <<< "$INIT_SAID"
      echo "   └─ halted: fix the cause above, then re-run"
      exit 1
    fi
    # re-probe the ACTUAL bind state — never fabricate "bound" from init's echo.
    # a probe malfunction HERE is the same failure as the first probe: surface it
    # (exit 1), never fold a broken tool into a "no route bound" verdict — that is
    # the failhide the first probe already refuses (rule.forbid.failhide).
    if ! BOUND_ROUTE="$(get_bound_route)"; then
      echo "🐈 wet paws..."
      echo ""
      echo "🧿 $SKILL --mode apply"
      echo "   ├─ the scaffold landed, but the re-probe of the bound route broke"
      echo "   ├─ fix the cause above, then re-run"
      echo "   └─ halted: could not probe the bound route (rhx route.bind.get malfunctioned)"
      exit 1
    fi
    if [[ -n "$BOUND_ROUTE" ]]; then
      ROUTE_STATE="scaffolded + bound a fresh route"
      ROUTE_BOUND=yes
    else
      # a clean init produced no bound route — the only such path is --skip-route-bind
      # (a bind that FAILED would have exited init non-zero, halted above). name the
      # path from init's SUCCESS output, and be honest the drive needs a bind first —
      # never promise a drive the route cannot take.
      #
      # guard the extract like its sibling get_bound_route above: under set -e a bare
      # failing assignment aborts the whole run (~exit 128) with no belay, so a grep
      # malfunction (rc>=2) here would halt mute. name the failure, exit 1.
      if ! BOUND_ROUTE="$(extract_redteam_route_path <<< "$INIT_SAID")"; then
        echo "🐈 wet paws..."
        echo ""
        echo "🧿 $SKILL --mode apply"
        echo "   ├─ the scaffold landed, but the scan of its own output for a route path broke"
        echo "   ├─ fix the cause above, then re-run"
        echo "   └─ halted: could not extract the scaffolded (unbound) route path"
        exit 1
      fi
      ROUTE_STATE="scaffolded, NOT bound"
      ROUTE_BOUND=no
    fi
  fi

  echo "🐈 anchors away!"
  echo ""
  echo "🧿 $SKILL --mode apply"
  echo "   ├─ route: ${BOUND_ROUTE:-<unknown — run: rhx $SKILL init>} ($ROUTE_STATE)"
  echo "   ├─ the ward loop runs through the route stones (blind peers are agent work):"
  echo "   │  ├─ 1.ground   — map the focus-surface per grain"
  echo "   │  ├─ 2.detect   — dispatch blind peers, fan claims in (keyed channel+mechanism)"
  echo "   │  ├─ 3.verify   — confirm vs tree, classify, sort by permanence trigger"
  echo "   │  ├─ 4.repair   — gated, disposition-aware, PENDING-REDETECT until confirmed"
  echo "   │  └─ 5.promote  — teach the kin (fullsun-safe), then loop or terminate"
  # branch on the explicit ROUTE_BOUND flag set beside each ROUTE_STATE assignment —
  # never a glob decode of the human display string. a glob on ROUTE_STATE would
  # silently fall through to the clean handoff if a future edit renamed the label
  # (e.g. "unbound"), and promise a drive the route cannot take
  # (rule.forbid.inline-decode-friction).
  if [[ "$ROUTE_BOUND" == "no" ]]; then
    echo "   ├─ ⚠️ the route is NOT bound — bind it before you drive:"
    echo "   │  └─ rhx route.bind.set --route $BOUND_ROUTE"
    echo "   └─ then drive it: rhx route.drive"
  else
    echo "   └─ drive it: rhx route.drive"
  fi
  print_disclaimer
  exit 0
fi
