#!/usr/bin/env bash
######################################################################
# 🧿 security.habitat.redteam — hunt a habitat the way an adversary would
#
# .what = a route-backed ward loop that reads a habitat through three
#         grains — infil (ways in), exfil (ways out), leak (already out) —
#         dispatches blind, disjoint-scope peers, fans their claims in,
#         verifies, repairs (gated), and promotes the lessons. it does not
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
#   --peers N       blind peers per grain-partition (breadth)          (default: 3; an apply
#                   to a bound route keeps the route's recorded value)
#   --budget N      the loop's spend allowance (drawn per cycle)       (default: 1; an apply
#                   to a bound route keeps the route's recorded value)
#   --mode MODE     plan | apply                                       (required, except for init)
#                     plan   — emit the partition + prompts + cost, drive no peer
#                     apply  — scaffold the route + hand off to route.drive
#                              (the ward loop itself runs under route.drive — the
#                               blind-peer dispatch/detect/verify/repair/promote is
#                               agent work driven through the stones, not this shell)
#   --skip-route-bind   scaffold without a route bind to this branch (an escape
#                       hatch for apply + init; the drive then needs a manual bind)
#
# guarantee:
#   - plan and apply name one surface: both read --scope from the repo root, from any cwd
#   - exit 0 = plan emitted, or apply scaffolded the route + handed off to route.drive
#              (the ward loop itself runs under route.drive, not in this shell)
#   - exit 1 = malfunction (a peer/tool broke, an unexpected state)
#   - exit 2 = constraint (absent/invalid args, absent scope)
#
# note: informational only — not professional security advice. every
#       guidance output carries the disclaimer; live claims are never
#       published (the dispatch tool is itself an exfil channel).
######################################################################
set -euo pipefail

SKILL="security.habitat.redteam"
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# the shared ghlitch vibes + route-probe/render operations — so this
# orchestrator reads as narrative and the not-security-advice disclaimer lives
# in one place (print_disclaimer), sourced by init.sh too.
source "$SELF_DIR/$SKILL/output.sh"

# print one help option row: the flag, its sense, and its note, each in a fixed column. a row
# with no note ends on its sense, so no line ends in pad space.
# $1 = the flag (empty for a continuation row), $2 = the sense, $3 = the note.
print_help_option() {
  local flag="$1" sense="$2" note="$3"
  [[ -z "$note" ]] && { printf '  %-18s %s\n' "$flag" "$sense"; return 0; }
  printf '  %-18s %-52s %s\n' "$flag" "$sense" "$note"
}

show_help() {
  print_cat_header "heres the deal..."
  print_tree_start "$SKILL — hunt a habitat the way an adversary would"
  echo ""
  echo "   the ward loop: ground → detect → verify → repair → promote → (loop | terminate)"
  echo ""
  echo "usage:"
  echo "  rhx $SKILL init --scope <path> --grain <grain> [--peers <n>] [--budget <n>] [--skip-route-bind]"
  echo "  rhx $SKILL --scope <path> --grain <grain> [--peers <n>] [--budget <n>] --mode plan"
  echo "  rhx $SKILL --scope <path> --grain <grain> [--peers <n>] [--budget <n>] [--skip-route-bind] --mode apply"
  echo ""
  echo "ward-loop gates (the stones invoke these; never the raw command they guard):"
  echo "  rhx $SKILL backup-before-rewrite                     (4.repair, before each history rewrite)"
  echo "  printf '%s' \"\$body\" | rhx $SKILL dispatch-lesson --title <title>"
  echo "  rhx $SKILL rewind-detect --route <route> --cycle <n> <<'KEYS'"
  echo "  <each open key, one per line, written out in full>"
  echo "  KEYS"
  echo ""
  # one printf shape for both option blocks, so the flag, sense, and note columns align whatever
  # the flag length or COUNT_MAX renders as
  echo "options:"
  print_help_option '--scope' 'habitat surface to sweep (a repo, a subtree)' '(required)'
  print_help_option '--grain' 'infil | exfil | leak | all' '(required)'
  print_help_option '' "$GRAIN_GLOSS" ''
  print_help_option '--peers' "blind peers per grain-partition, 1 to $COUNT_MAX" '(default: 3; apply to a bound route: its own; fixed once 1.ground cuts the slices)'
  print_help_option '--budget' "loop spend allowance, 1 to $COUNT_MAX cycles" '(default: 1 — one pass, no re-detect; apply to a bound route: its own)'
  print_help_option '--mode' 'plan | apply' '(required, except for init)'
  print_help_option '--skip-route-bind' 'scaffold without a branch bind' '(apply + init only)'
  echo ""
  echo "gate options (each gate reads only its own; any other flag belays):"
  print_help_option '--title' "dispatch-lesson: the lesson's title, '<class>: <fix>'" '(required)'
  print_help_option '--route' 'rewind-detect: the route dir under .behavior/' '(required)'
  print_help_option '--cycle' "rewind-detect: the cycle just walked, 1 to $COUNT_MAX" '(required)'
  echo ""
  echo "exit: 0 = done · 1 = malfunction · 2 = constraint"
  print_disclaimer
  exit 0
}

# orchestrator: bind the shared require_flag_val (output.sh; belays + exits on an absent value)
# to the header and help hint of the command the caller typed (rule.require.consistent-skill-contracts).
# $1 = flag name, $2 = candidate value, $3 = the fix item.
require_val() {
  require_flag_val "$PARSE_HEADER" "$1" "$2" "$3" "$PARSE_HINT"
}

# show the help page for the command at hand: init's own page for the init subcommand (so
# `init --help` renders what an init hint promises), else this skill's page.
show_help_for() {
  local subcommand="$1"
  [[ "$subcommand" != "init" ]] && { show_help; exit 0; }
  require_init_sh "$SKILL init"
  exec_route_scaffold --help
}

# hand the whole process to the route scaffold (init.sh): exec replaces this shell, so the
# scaffold's own render and exit code pass through unchanged. the capture variant, for a
# caller that reads init's result, is scaffold_route (output.sh). args = init.sh's argv.
exec_route_scaffold() {
  exec bash "$INIT_SH" "$@"
}

# set HAVE_SCOPE / HAVE_GRAIN / HAVE_PEERS / HAVE_BUDGET from a bound route's scope record, or
# halt on the first field the record cannot answer. $1 = the route.
require_route_scope_record() {
  local route="$1"
  require_route_scope_field "$route" scope HAVE_SCOPE
  require_route_scope_field "$route" grain HAVE_GRAIN
  require_route_scope_field "$route" peers HAVE_PEERS
  require_route_scope_field "$route" budget HAVE_BUDGET
}

# orchestrator: set one field of a bound route's scope record into a named var, or halt with
# its fault. the fault rides in field_rc, a named verdict of get_route_scope_field (SCOPE_*), so
# the halt shows the remedy that fits it. it runs in the caller's shell, never a capture, so the
# halt ends the run. $1 = the route, $2 = the field, $3 = the var to set.
require_route_scope_field() {
  local route="$1" field="$2" var="$3" value field_rc=0
  value="$(get_route_scope_field "$route" "$field")" || field_rc=$?
  is_scope_field_read "$field_rc" || halt_scope_record_unread "$value" "$field_rc" "$route" "$field"
  printf -v "$var" '%s' "$value"
}

# set INIT_SH to the route scaffold, or halt on a broken install: one check, one message, for
# every path that runs init.sh. $1 = the header of the halt.
require_init_sh() {
  local cmd="$1"
  INIT_SH="$SELF_DIR/$SKILL/init.sh"
  [[ -x "$INIT_SH" ]] || halt_with "$cmd" "the skill install is broken" \
    "cause: $(as_qualified_cause "the route scaffold (init.sh) is absent or not executable: $INIT_SH")" "$FIX_REINSTALL"
}

# belay on a flag this command does not read: a dropped flag reads as obeyed, so it never drops
# in silence. $1 = the header, $2 = the flags the command reads, $3 = the command's help hint.
belay_on_foreign_flags() {
  local header="$1" reads="$2" hint="$3" foreign
  foreign="$(as_foreign_flags "$reads" "${GIVEN_FLAGS[@]}")"
  [[ -z "$foreign" ]] && return 0
  belay_with "$header" "flag not read by this command: $foreign" "fix: drop $foreign (this command reads $reads)" "$hint"
}

# parse arguments. rhx prepends --skill/--repo/--role, so a subcommand like
# `init` arrives mid-stream, never as $1 — detect it in the loop.
SUBCOMMAND=""
SKIP_ROUTE_BIND=""
SCOPE=""
GRAIN=""
PEERS="3"
BUDGET="1"
PEERS_GIVEN=""
BUDGET_GIVEN=""
MODE=""
TITLE=""
ROUTE=""
CYCLE=""
HINT="hint: rhx $SKILL help"
FIX_TITLE="fix: pass the lesson's title (--title '<class>: <fix>')"
FIX_ROUTE="fix: pass the route path (--route .behavior/v<date>.guardian-redteam...)"
FIX_CYCLE="fix: pass the cycle just walked (--cycle 1, 2, ...)"
FIX_CYCLE_COUNT="fix: pass the cycle just walked as a count, 1 to $COUNT_MAX, no lead zero (--cycle 1, 2, ...)"
FIX_ROUTE_ABSENT="fix: scaffold a route first (rhx $SKILL init --scope <path> --grain <grain>), or pass the path of one that stands"
FIX_ROUTE_KIND="fix: pass a guardian-redteam route (--route .behavior/v<date>.guardian-redteam...); this gate rewinds no other skill's route"
# a parse slip renders under the command the caller typed (its subcommand read ahead of the
# parse) and that command's own help page, as every later belay of the same command does.
# a sweep's header stays bare until --mode validates, then names the mode (RUN_CMD).
PARSE_SUBCOMMAND="$(as_subcommand_from_args "$@")"
PARSE_HEADER="$(as_command_header "$SKILL" "$PARSE_SUBCOMMAND")"
PARSE_HINT="$(as_command_hint "$SKILL" "$PARSE_SUBCOMMAND")"
GIVEN_FLAGS=()
while [[ $# -gt 0 ]]; do
  # record each skill flag given, so a command belays on one it does not read (never drops it)
  is_skill_flag "$1" && GIVEN_FLAGS+=("$1")
  case $1 in
    init|dispatch-lesson|rewind-detect|backup-before-rewrite)
      SUBCOMMAND="$1"
      shift
      ;;
    --title)
      require_val --title "${2:-}" "$FIX_TITLE"
      TITLE="$2"
      shift 2
      ;;
    --route)
      require_val --route "${2:-}" "$FIX_ROUTE"
      ROUTE="$2"
      shift 2
      ;;
    --cycle)
      require_val --cycle "${2:-}" "$FIX_CYCLE"
      CYCLE="$2"
      shift 2
      ;;
    --skip-route-bind)
      SKIP_ROUTE_BIND="1"
      shift
      ;;
    --scope)
      require_val --scope "${2:-}" "$FIX_SCOPE"
      SCOPE="$2"
      shift 2
      ;;
    --grain)
      require_val --grain "${2:-}" "$(as_grain_fix)"
      GRAIN="$2"
      shift 2
      ;;
    --peers)
      require_val --peers "${2:-}" "$FIX_PEERS"
      PEERS="$2"
      PEERS_GIVEN="1"
      shift 2
      ;;
    --budget)
      require_val --budget "${2:-}" "$FIX_BUDGET"
      BUDGET="$2"
      BUDGET_GIVEN="1"
      shift 2
      ;;
    --mode)
      require_val --mode "${2:-}" "$FIX_MODE"
      MODE="$2"
      shift 2
      ;;
    --skill|--repo|--role)
      # skip rhx passthrough args: the flag, then its value when one comes next and that
      # token is not itself a flag — a blind `shift 2` both aborts on a final-token flag
      # (set -e) and eats the next legit flag as a phantom value.
      shift
      is_passthrough_value "$@" && shift
      ;;
    --)
      shift
      ;;
    help|--help|-h)
      show_help_for "$SUBCOMMAND"
      ;;
    --*=*)
      # a known flag in `--flag=value` form is no unknown flag: name the slip and its fix
      belay_with "$PARSE_HEADER" "flag and value joined by '=': $1" "$(as_split_flag_fix "$1")" "$PARSE_HINT"
      ;;
    *)
      belay_with "$PARSE_HEADER" "unknown argument: $1" \
        "fix: drop $1 (this command reads $(as_flags_read_by "$PARSE_SUBCOMMAND"))" "$PARSE_HINT"
      ;;
  esac
done

# the two ward-loop gates 5.promote invokes: each is the only sanctioned path to its act (a
# push upstream, a rewind of 2.detect), exposed here so a fresh agent on the route reaches it
# by command, never by a sourced file whose path it cannot know. stdin carries the body / keys.
# orchestrator: the dispatch-lesson gate — belay a request it cannot honor, else scan and push.
# exits with the gate's own code.
run_dispatch_lesson_gate() {
  belay_on_foreign_flags "$SKILL dispatch-lesson" "$FLAGS_READ_BY_DISPATCH" "$HINT"
  [[ -z "$TITLE" ]] && belay_with "$SKILL dispatch-lesson" "absent required arg: --title" "$FIX_TITLE" "$HINT"
  # a blank title is no title: the push keys its findsert on it, so a later real title would twin
  is_blank_text "$TITLE" && belay_with "$SKILL dispatch-lesson" "blank --title (only whitespace)" "$FIX_TITLE" "$HINT"
  is_stdin_a_terminal && belay_with "$SKILL dispatch-lesson" "no lesson body on stdin (stdin is a terminal)" \
    "fix: pipe the drafted lesson: printf '%s' \"\$body\" | rhx $SKILL dispatch-lesson --title <title>" "$HINT"
  local gate_rc=0
  dispatch_fullsun_lesson "$TITLE" || gate_rc=$?
  exit "$gate_rc"
}

# orchestrator: the rewind-detect gate — belay a request it cannot honor, anchor at the repo root,
# confirm one whole redteam route, then carry the keys and rewind. exits with the gate's own code.
run_rewind_detect_gate() {
  belay_on_foreign_flags "$SKILL rewind-detect" "$FLAGS_READ_BY_REWIND" "$HINT"
  [[ -z "$ROUTE" ]] && belay_with "$SKILL rewind-detect" "absent required arg: --route" "$FIX_ROUTE" "$HINT"
  [[ -z "$CYCLE" ]] && belay_with "$SKILL rewind-detect" "absent required arg: --cycle" "$FIX_CYCLE" "$HINT"
  is_positive_integer "$CYCLE" || belay_with "$SKILL rewind-detect" "invalid --cycle: $CYCLE" "$FIX_CYCLE_COUNT" "$HINT"
  is_stdin_a_terminal && belay_with "$SKILL rewind-detect" "no carried keys on stdin (stdin is a terminal)" \
    "fix: pass the PENDING-REDETECT keys on stdin in a quoted heredoc, one per line, written out in full (an empty heredoc when none are open): rhx $SKILL rewind-detect --route <route> --cycle <n> <<'KEYS' … KEYS" "$HINT"

  # the rewind writes into a route, so it earns the same anchor every other write does: the
  # repo root, then one route dir under .behavior/ that stands on disk
  exit_unless_repo_root "$SKILL rewind-detect" "$HINT"
  cd "$REPO_ROOT"
  ROUTE="$(as_normalized_route_path "$ROUTE")"
  is_route_dir_path "$ROUTE" || belay_with "$SKILL rewind-detect" "not a route under .behavior/: $ROUTE" "$FIX_ROUTE" "$HINT"
  is_route_on_disk "$ROUTE" || belay_with "$SKILL rewind-detect" "no route stands at $ROUTE (from the repo root)" "$FIX_ROUTE_ABSENT" "$HINT"
  is_redteam_route_path "$ROUTE" || belay_with "$SKILL rewind-detect" "not a $ROUTE_KIND route: $ROUTE" "$FIX_ROUTE_KIND" "$HINT"
  # a partial route cannot be driven to terminal, so no cycle is spent on one
  exit_on_route_partial "$SKILL rewind-detect" "$ROUTE" "route: $ROUTE (not rewound)" "$FIX_ROUTE_RESTORE"
  local gate_rc=0
  rewind_detect_with_cycle_carry "$ROUTE" "$CYCLE" || gate_rc=$?
  exit "$gate_rc"
}

# orchestrator: the backup-before-rewrite gate 4.repair invokes before a history rewrite. it
# refuses uncommitted work outside this skill's route dirs (a rewrite over it can drop it), then
# findserts a backup ref at HEAD, outside refs/heads/, and reads it back, so every rewrite has a
# ref to restore from that `git push --all` never publishes. exit 0 =
# the rewrite may proceed; 2 = it may not (hand it to the human); 1 = a git break.
run_backup_before_rewrite_gate() {
  local header="$SKILL backup-before-rewrite" branch head uncommitted backup held said rc=0
  (( ${#GIVEN_FLAGS[@]} == 0 )) || belay_with "$header" "flag not read by this command: ${GIVEN_FLAGS[*]}" \
    "fix: drop ${GIVEN_FLAGS[*]} (this command reads no flag; it backs up the checked-out branch)" "$HINT"
  exit_unless_repo_root "$header" "$HINT"
  cd "$REPO_ROOT"

  # the backup names the branch the rewrite touches; a detached HEAD names none
  branch="$(get_current_branch)" || halt_with "$header" "could not read the current branch" "cause: $(as_qualified_cause "$branch")" "$FIX_TOOL_RETRY"
  is_branch_detached "$branch" && belay_with "$header" "no branch is checked out (a detached HEAD)" \
    "fix: check out the branch whose commits the rewrite touches, then re-run" "$HINT"
  head="$(get_ref_commit HEAD)" || rc=$?
  (( rc == REF_ABSENT )) && belay_with "$header" "the branch holds no commit, so no rewrite is owed" \
    "fix: skip the rewrite; redact the value in the tree alone" "$HINT"
  (( rc != 0 )) && halt_with "$header" "could not read HEAD" "cause: $(as_qualified_cause "$head")" "$FIX_TOOL_RETRY"

  # a rewrite over uncommitted work can drop it, so that rewrite is the human's call
  uncommitted="$(get_tree_uncommitted)" || halt_with "$header" "could not read the tree's status" "cause: $(as_qualified_cause "$uncommitted")" "$FIX_TOOL_RETRY"
  [[ -n "$uncommitted" ]] && belay_with "$header" "the tree holds uncommitted work; a rewrite over it can drop it" \
    "$(as_uncommitted_item "$uncommitted")" \
    "fix: do not rewrite — hand the rewrite to the human (the drafted command, the branch, the commits), and hold the claim open" "$HINT"

  # findsert the backup at HEAD, then read it back: a rewrite proceeds only on a ref that holds HEAD
  backup="$(as_backup_ref "$branch" "$head")"
  rc=0
  held="$(get_ref_commit "$backup")" || rc=$?
  (( rc == REF_ABSENT )) && { said="$(set_backup_ref "$backup" "$head")" \
    || halt_with "$header" "could not create the backup ref $backup" "cause: $(as_qualified_cause "$said")" "$FIX_TOOL_RETRY"; }
  (( rc != 0 && rc != REF_ABSENT )) && halt_with "$header" "could not read the backup ref $backup" "cause: $(as_qualified_cause "$held")" "$FIX_TOOL_RETRY"
  # the read-back branches on its rc like the first read: a git break is a tool break, never "no commit"
  rc=0
  held="$(get_ref_commit "$backup")" || rc=$?
  (( rc != 0 && rc != REF_ABSENT )) && halt_with "$header" "could not read back the backup ref $backup" "cause: $(as_qualified_cause "$held")" "$FIX_TOOL_RETRY"
  (( rc == REF_ABSENT )) && held="no commit"
  [[ "$held" == "$head" ]] || halt_with "$header" "the backup ref does not read back at HEAD, so no rewrite" \
    "cause: $(as_qualified_cause "the backup ref $backup holds $held, where HEAD is ${head:0:12}")" \
    "fix: check git update-ref (the repo's refs are writable, no hook rewrites them), then re-run"

  print_gate_verdict "$header" 0 "backed up — the rewrite may proceed on $branch" \
    "branch: $branch at ${head:0:12}" "backup: $backup" "restore: git reset --hard $backup"
  exit 0
}

[[ "$SUBCOMMAND" == "dispatch-lesson" ]] && run_dispatch_lesson_gate
[[ "$SUBCOMMAND" == "rewind-detect" ]] && run_rewind_detect_gate
[[ "$SUBCOMMAND" == "backup-before-rewrite" ]] && run_backup_before_rewrite_gate

# init takes no --mode (it always scaffolds): a mode there would drop in silence, so it belays
# with the run the caller likely meant
is_init_with_mode "$SUBCOMMAND" "$MODE" && belay_with "$SKILL init" "init takes no --mode (it always scaffolds)" \
  "fix: drop --mode, or run without init: rhx $SKILL --mode $MODE ..." "$(as_command_hint "$SKILL" init)"

# the sweep's belays name the command the caller ran (init or the bare sweep) and its own help
# page, so one slip reads the same render whether init came via this skill or init.sh direct
SWEEP_HEADER="$(as_command_header "$SKILL" "$SUBCOMMAND")"
SWEEP_HINT="$(as_command_hint "$SKILL" "$SUBCOMMAND")"

# a sweep reads no gate flag; a --title/--route/--cycle here would drop
belay_on_foreign_flags "$SWEEP_HEADER" "$(as_sweep_flags_read "$SUBCOMMAND")" "$SWEEP_HINT"

# validate the sweep request — the one check init.sh runs too. every belay names its fix, then
# the help page
SWEEP_FAULT="$(get_sweep_request_fault "$SCOPE" "$GRAIN" "$PEERS" "$BUDGET")" \
  || belay_with "$SWEEP_HEADER" "$(as_fault_message "$SWEEP_FAULT")" "$(as_fault_fix "$SWEEP_FAULT")" "$SWEEP_HINT"
SCOPE="$(as_normalized_scope "$SCOPE")"

# the active grains (all → the three GRAIN_LIST partitions, from the one source)
mapfile -t GRAINS < <(as_active_grains "$GRAIN")

# print the priced plan for this sweep at its effective peers + budget: the peer total and the
# projected cost derive here, in one place, from the values the drive will pay.
# $1 = the next step the plan closes on (empty when the apply runs at once).
print_sweep_plan() {
  local next="$1" peer_total projected
  peer_total="$(compute_peer_total "$PEERS" "${#GRAINS[@]}")"
  projected="$(compute_projected_cost "$peer_total" "$BUDGET")"
  print_cat_header "chartin course..."
  print_plan "$RUN_CMD" "$SCOPE" "$PEERS" "$BUDGET" "$peer_total" "$projected" "$GRAIN" "$next" "${GRAINS[@]}"
}

# halt: the bound route's scope record could not answer one field. the remedy fits the fault
# (as_scope_record_fix): a retry, an in-place edit, or a fresh scaffold for a record that is gone.
# $1 = the cause, $2 = get_route_scope_field's return, $3 = the route, $4 = the field.
halt_scope_record_unread() {
  halt_with "$RUN_CMD" "could not read the bound route's scope record" "cause: $1" "$(as_scope_record_fix "$2" "$3" "$4")"
}

# orchestrator: the init arm — scaffold the route, delegated to init.sh (exec; never returns).
run_sweep_init() {
  local init_args
  require_init_sh "$SKILL init"
  mapfile -t init_args < <(as_init_args "$SCOPE" "$GRAIN" "$PEERS" "$BUDGET" "$SKIP_ROUTE_BIND")
  exec_route_scaffold "${init_args[@]}"
}

# init subcommand — scaffold the route (delegated)
[[ "$SUBCOMMAND" == "init" ]] && run_sweep_init

# --mode is required + enum-validated for a non-init run. an invalid value must
# belay (exit 2), never fall through both branches to a silent exit-0 success.
MODE_FAULT="$(as_mode_fault "$MODE")"
[[ -n "$MODE_FAULT" ]] && belay_with "$SKILL" "$MODE_FAULT" "$FIX_MODE" "$HINT"
RUN_CMD="$SKILL --mode $MODE"

# --skip-route-bind means naught to a plan: no route is made, so no bind is skipped
is_plan_with_skipped_bind "$MODE" "$SKIP_ROUTE_BIND" && belay_with "$RUN_CMD" \
  "--skip-route-bind applies to apply and init only (a plan makes no route)" "fix: drop --skip-route-bind from the plan" "$HINT"

# anchor at the repo root, where route.drive looks: plan and apply both name the surface from
# the root, so a plan from a subtree prices the same surface its apply would sweep
exit_unless_repo_root "$RUN_CMD" "$HINT"
SCOPE_SAID="$(get_scope_from_repo_root "$SCOPE" "$REPO_ROOT")" || halt_with "$RUN_CMD" "could not name the scope from the repo root" \
  "cause: $SCOPE_SAID" "$FIX_SCOPE_ENTER"
SCOPE="$SCOPE_SAID"
cd "$REPO_ROOT"

# orchestrator: the plan arm — emit the partition + prompts + projected cost, drive no peer. exits 0.
run_sweep_plan() {
  print_sweep_plan "$(as_plan_next_step "$SCOPE" "$GRAIN" "$PEERS" "$BUDGET")"
  print_disclaimer
  exit 0
}

# plan mode — price the sweep, spend naught
[[ "$MODE" == "plan" ]] && run_sweep_plan

# apply mode — the ward loop runs through the route stones. the blind-peer dispatch, detect,
# verify, repair, and promote are agent work, driven through the route's stones + guards
# (like cicd.deflake / declapract.upgrade), not a shell engine. so apply scaffolds the route
# (idempotent) and hands the operator into the drive — and only ever promises a drive the
# route can take. the plan prints once the effective peers + budget are known, so the price
# an operator reads is the price the drive pays.

# orchestrator: the apply arm. probe the bind once — a probe break and a foreign bind each halt,
# never fold into "none bound"; under --skip-route-bind a foreign bind is left alone — then reuse
# the bound route, or scaffold one. the route the reuse drives is passed, never read from a global.
run_sweep_apply() {
  local bound probe_rc=0
  bound="$(get_bound_route_for_scaffold "$SKIP_ROUTE_BIND")" || probe_rc=$?
  exit_on_bound_probe_verdict "$RUN_CMD" "$probe_rc" "$bound" "could not probe the bound route"
  [[ -n "$bound" ]] && run_apply_reuse "$bound"
  run_apply_scaffold
}

# orchestrator: may a re-run drive this bound route? a sweep its promote already ended drives
# naught on a re-run, so an operator would read a fresh sweep that never ran. the promote yield
# keeps its terminate until the next promote, so a rewind since then reopens it; else only a
# raised budget reopens it (the add-budget resume), through the rewind the verdict names. halts
# on a read break, belays a finished sweep with no raise. runs in this shell (never a $(…)), so
# its halts close the run; the note for the handoff lands in the variable $5 names.
# $1 = the route, $2 = the effective budget, $3/$4 = the recorded peers/budget, $5 = the out var.
require_sweep_live_or_reopened() {
  local route="$1" budget="$2" have_peers="$3" have_budget="$4" note_var="$5"
  local decision decision_rc=0 reopen_rc=0 reopen_said=""
  printf -v "$note_var" '%s' ""
  decision="$(get_route_promote_decision "$route")" || decision_rc=$?
  is_promote_read_broke "$decision_rc" && halt_with "$RUN_CMD" "could not read whether the bound route's sweep has ended" \
    "cause: $decision" "$FIX_TOOL_RETRY"
  is_sweep_finished "$decision" || return 0
  reopen_said="$(get_route_reopen_verdict "$route")" || reopen_rc=$?
  is_promote_read_broke "$reopen_rc" && halt_with "$RUN_CMD" "could not read whether the bound route's sweep was reopened" \
    "cause: $reopen_said" "$FIX_TOOL_RETRY"
  is_route_reopened "$reopen_rc" && return 0
  # the reopen compares against the recorded budget, so a damaged record halts on its own name,
  # never as an arithmetic error and a nonsense remedy
  # a flag cannot repair it here: the reopen reads the recorded budget, so the record itself is the fix
  are_positive_counts "$have_peers" "$have_budget" || halt_with "$RUN_CMD" "the bound route's scope record holds an invalid count, so its ended sweep cannot reopen" \
    "recorded: peers=$have_peers budget=$have_budget" "fix: set '- peers:' and '- budget:' to counts from 1 to $COUNT_MAX in $route/0.scope.md, then re-run"
  is_budget_raised "$budget" "$have_budget" || belay_with "$RUN_CMD" "$(as_sweep_finished_verdict "$decision")" \
    "route: $route" "$(as_sweep_finished_fix "$decision" "$have_budget")" "$HINT"
  printf -v "$note_var" '%s' "$(as_sweep_reopen_note "$decision")"
}

# orchestrator: the reuse path — a redteam route is already bound. confirm it stands whole and
# sweeps this surface, adopt the counts this request passed, then hand off. exits 0 on handoff.
# $1 = the bound route.
run_apply_reuse() {
  local route="$1"
  # the bind is a persisted string that can outlive its route; confirm the whole route stands
  is_route_on_disk "$route" || halt_with "$RUN_CMD" "the bind persists but its route dir + stones are gone" \
    "bound route is absent on disk: $route" "$FIX_ROUTE_REBIND"
  # a partial route keeps its .claims/; a restore repairs it in place, as the rewind gate says
  exit_on_route_partial "$RUN_CMD" "$route" "bound route is incomplete on disk: $route" "$FIX_ROUTE_RESTORE"

  # the bound route must sweep the surface this request names (scope + grain), read once
  require_route_scope_record "$route"
  if ! is_sweep_match "$HAVE_SCOPE" "$HAVE_GRAIN" "$SCOPE" "$GRAIN"; then
    print_sweep_mismatch_belay "$RUN_CMD" "$HAVE_SCOPE" "$HAVE_GRAIN" "$SCOPE" "$GRAIN"
    exit 2
  fi

  # peers + budget say how hard the loop drives. a value this request passed is adopted; a value
  # it omitted keeps the route's own, so a bare re-run never resets a live loop's cap to a default
  PEERS="$(as_effective_count "$PEERS_GIVEN" "$PEERS" "$HAVE_PEERS")"
  BUDGET="$(as_effective_count "$BUDGET_GIVEN" "$BUDGET" "$HAVE_BUDGET")"
  are_positive_counts "$PEERS" "$BUDGET" || halt_with "$RUN_CMD" "the bound route's scope record holds an invalid count" \
    "recorded: peers=$HAVE_PEERS budget=$HAVE_BUDGET" "fix: pass --peers and --budget to set both, or set them to counts from 1 to $COUNT_MAX in $route/0.scope.md, then re-run"

  # a sweep its promote already ended drives naught on a re-run; only a raised budget reopens it
  local reopen_note=""
  require_sweep_live_or_reopened "$route" "$BUDGET" "$HAVE_PEERS" "$HAVE_BUDGET" reopen_note

  # peers set the slice count, and 1.ground cuts the slices once, never again. after ground runs,
  # a new count would land in the record yet widen no sweep, so it belays rather than claim an effect
  if is_peer_count_locked "$PEERS" "$HAVE_PEERS" "$route"; then
    belay_with "$RUN_CMD" "peers are fixed once 1.ground cuts the slices; this route grounded at peers=$HAVE_PEERS" \
      "route: $route" \
      "fix: drop --peers to drive at the route's own breadth, or unbind (rhx route.bind.del), remove the route dir, and re-run to sweep at --peers $PEERS (the .claims/ it holds are lost)" \
      "$HINT"
  fi

  # an apply spends at once, so its plan closes on no next step
  print_sweep_plan ""
  echo ""
  local record_said
  if ! is_scope_record_kept "$PEERS" "$BUDGET" "$HAVE_PEERS" "$HAVE_BUDGET"; then
    record_said="$(set_scope_record "$route" "$SCOPE" "$GRAIN" "$PEERS" "$BUDGET")" \
      || halt_with "$RUN_CMD" "could not adopt this request's peers + budget into the bound route" "cause: $(as_qualified_cause "$record_said")" \
        "fix: check that $route/0.scope.md is writable, then re-run"
  fi
  # a --skip-route-bind here has naught to skip (the route is bound already), so the state names it moot
  print_apply_handoff "$RUN_CMD" "$route" \
    "$(as_reuse_state "$PEERS" "$BUDGET" "$HAVE_PEERS" "$HAVE_BUDGET" "$SKIP_ROUTE_BIND")" "$HANDOFF_BOUND" "$reopen_note"
  exit 0
}

# orchestrator: the scaffold path — none bound, so price the request's own values, scaffold
# through init, then confirm the route it made and hand off (bound or not). exits 0 on handoff.
run_apply_scaffold() {
  # an apply spends at once, so its plan closes on no next step
  print_sweep_plan ""
  echo ""
  require_init_sh "$RUN_CMD"
  local init_args
  mapfile -t init_args < <(as_init_args "$SCOPE" "$GRAIN" "$PEERS" "$BUDGET" "$SKIP_ROUTE_BIND")

  # a clean init (exit 0) is the only green light. its own output is nested, and its exit code
  # keeps its sense: 2 = a constraint the caller fixes (e.g. a route already stands), else 1
  local init_rc=0 init_severity init_said
  init_said="$(scaffold_route "$INIT_SH" "${init_args[@]}")" || init_rc=$?
  if [[ "$init_rc" -ne 0 ]]; then
    init_severity="$(as_severity_from_exit "$init_rc")"
    print_belay "the scaffold did not land clean" "$RUN_CMD" "$init_severity" \
      "$(as_tree_item_with_body "init said" "   │  " "$init_said")"
    exit "$(as_exit_from_severity "$init_severity")"
  fi

  [[ -n "$SKIP_ROUTE_BIND" ]] && run_apply_scaffold_unbound "$init_said"
  run_apply_scaffold_bound "$init_said"
}

# the fix for an init that exited clean yet left no route: a race a re-run clears, or a broken
# install that no re-run can — so it names both
FIX_ROUTE_NOT_MADE="fix: check the routes under .behavior/ — if a route stands, drive it; if naught stands, reinstall the role package, then re-run"

# orchestrator: an unbound scaffold. take the route init made from init's own render — never
# re-derive it from the clock (which can turn over between init's stamp and this read), never
# glob it from .behavior/ (where a prior day's route would stand in for a scaffold that made
# naught) — then confirm the whole route stands. exits 0 on handoff.
# $1 = init's render.
run_apply_scaffold_unbound() {
  local init_said="$1" route_made
  route_made="$(get_route_from_init_render "$init_said")" || halt_with "$RUN_CMD" "could not read the route from init's render" \
    "$(as_tree_item_with_body "init said" "   │  " "$init_said")" "cause: $route_made" "$FIX_TOOL_RETRY"
  is_route_made_on_disk "$route_made" || halt_with "$RUN_CMD" "init reported clean, but named no route that stands under .behavior/" \
    "expected: .behavior/v<date>.$(as_route_suffix "$GRAIN" "$SCOPE")" "$FIX_ROUTE_NOT_MADE"
  exit_on_route_partial "$RUN_CMD" "$route_made" "the route init made is incomplete on disk: $route_made" "$FIX_REINSTALL"
  print_apply_handoff "$RUN_CMD" "$route_made" "scaffolded, not bound" "$HANDOFF_UNBOUND" "$(get_foreign_bind_note)"
  exit 0
}

# orchestrator: a bound scaffold. re-probe the actual bind — never trust init's echo — and name
# the route init made from its render only; the handoff names only a route this run made.
# exits 0 on handoff. $1 = init's render.
run_apply_scaffold_bound() {
  local init_said="$1" route_made
  # a foreign bind that landed in the window is a constraint with its path named
  local reprobe_rc=0 bound
  bound="$(get_bound_route)" || reprobe_rc=$?
  exit_on_bound_probe_verdict "$RUN_CMD" "$reprobe_rc" "$bound" "could not probe the bound route" \
    "the scaffold landed, but the re-probe of the bound route broke"
  # a broken read halts on its cause, and a render that names no route halts too
  route_made="$(get_route_from_init_render "$init_said")" \
    || halt_with "$RUN_CMD" "the scaffold landed, but the route it made could not be read from init's render" \
      "cause: $route_made" "fix: check rhx route.bind.get, then bind the route init made: rhx route.bind.set --route <route>"
  is_route_made_on_disk "$route_made" || halt_with "$RUN_CMD" "init reported clean, but named no route that stands under .behavior/" \
    "expected: .behavior/v<date>.$(as_route_suffix "$GRAIN" "$SCOPE")" "$FIX_ROUTE_NOT_MADE"
  [[ -z "$bound" ]] && halt_with "$RUN_CMD" "the scaffold landed, but no redteam route reads back bound" \
    "fix: check rhx route.bind.get, then bind the route: rhx route.bind.set --route $route_made"
  # a same-kind bind that landed in the window is no success
  is_same_route_path "$bound" "$route_made" || halt_with "$RUN_CMD" \
    "the scaffold landed, but the branch reads back bound to another redteam route (a concurrent bind won)" \
    "bound: $bound" "orphaned: $route_made" \
    "fix: drive the bound route (rhx route.drive), or remove the orphaned route dir"
  print_apply_handoff "$RUN_CMD" "$bound" "scaffolded + bound a fresh route" "$HANDOFF_BOUND"
  exit 0
}

run_sweep_apply
exit 0
