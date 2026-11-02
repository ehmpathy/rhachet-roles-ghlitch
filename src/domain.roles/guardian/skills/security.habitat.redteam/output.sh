#!/usr/bin/env bash
######################################################################
# .what = ghlitch-cat vibes output for security.habitat.redteam
#
# .why  = consistent 🧿 two-header output for the ward-loop scaffold
#
# usage:
#   source output.sh
#   print_cat_header "chartin course..."
#   print_tree_start "security.habitat.redteam init"
#   print_tree_branch "route" ".behavior/v2026_09_07.guardian-redteam/ ✨"
######################################################################

# every tool and builtin this skill runs speaks the untranslated C locale, so a cause a halt
# names (a `cd` or redirect strerror, a git message) reads the same on every host. both entry
# points source this file first, so the pin covers them whole.
export LC_ALL=C

# the two severities a belay carries: the caller fixes a constraint (exit 2), the system a
# malfunction (exit 1). named, so a misspelled severity halts under `set -u` rather than fall
# through a `*` arm in silence.
SEVERITY_CONSTRAINT="constraint"
SEVERITY_MALFUNCTION="malfunction"

# the flag that renders a tree item as its close (`└─`), not a mid-tree branch (`├─`)
TREE_LAST="last"

# the two states an apply handoff reports: a route bound to the branch, or one scaffolded unbound
HANDOFF_BOUND="bound"
HANDOFF_UNBOUND="unbound"

# transformer: a suffix for a reused route's state when --skip-route-bind was given — the route is
# bound already, so the flag had naught to skip; named, never dropped in silence. $1 = the flag.
as_skip_bind_moot_note() {
  [[ -z "$1" ]] && return 0
  printf '%s' " (--skip-route-bind had no effect: this route was bound already)"
}

# print cat mascot + phrase
print_cat_header() {
  local phrase="$1"
  echo "🐈 $phrase"
  echo ""
}

# print artifact tree root (🧿 = guardian)
print_tree_start() {
  local command="$1"
  echo "🧿 $command"
}

# print tree branch (has children)
print_tree_branch() {
  local key="$1"
  local value="$2"
  local is_last="${3:-false}"
  if [[ "$is_last" == "$TREE_LAST" ]]; then
    echo "   └─ $key: $value"
    return 0
  fi
  echo "   ├─ $key: $value"
}

# print simple tree item (label only)
print_tree_item() {
  local label="$1"
  local is_last="${2:-false}"
  if [[ "$is_last" == "$TREE_LAST" ]]; then
    echo "   └─ $label"
    return 0
  fi
  echo "   ├─ $label"
}

# transformer: the mascot line a belay opens on, keyed to its severity. only an explicit
# SEVERITY_CONSTRAINT blames the caller; any other value (an absent or misspelled severity) reads as
# a malfunction, so a slip never tells a caller whose run broke to fix their own input.
as_belay_mascot() {
  case "$1" in
    "$SEVERITY_CONSTRAINT") printf 'belay that...' ;;
    *)          printf 'wet paws...' ;;
  esac
}

# transformer: the close-line lead a belay ends on — the house close-word, then the error
# class qualified behind its glyph (rule.require.qualified-error-headers). the class names who
# fixes it: a ConstraintError is the caller's (exit 2), a MalfunctionError the system's (exit 1).
# as with the mascot, only an explicit SEVERITY_CONSTRAINT closes as the caller's fault.
as_belay_close() {
  case "$1" in
    "$SEVERITY_CONSTRAINT") printf 'blocked: %s' "$(as_error_class "$SEVERITY_CONSTRAINT")" ;;
    *)          printf 'halted: %s' "$(as_error_class "$SEVERITY_MALFUNCTION")" ;;
  esac
}

# transformer: a belay's whole close line — its lead, then the message. print_belay and any
# render that closes a tree on a belay compose it here, so the format has one source.
as_belay_close_line() {
  local severity="$1" message="$2"
  printf '%s: %s' "$(as_belay_close "$severity")" "$message"
}

# transformer: a command's render header — the skill, then its subcommand when one was given.
as_command_header() {
  local skill="$1" subcommand="$2"
  [[ -z "$subcommand" ]] && { printf '%s' "$skill"; return 0; }
  printf '%s %s' "$skill" "$subcommand"
}

# transformer: a command's help hint — init points at its own page (`init --help`, the page
# init.sh renders), any other command at the skill's.
as_command_hint() {
  local skill="$1" subcommand="$2"
  [[ "$subcommand" == "init" ]] && { printf 'hint: rhx %s init --help' "$skill"; return 0; }
  printf 'hint: rhx %s help' "$skill"
}

# transformer: the error class qualified behind its glyph — the one form every close line
# and every leaf diagnostic composes, so a rename lands in one place.
as_error_class() {
  case "$1" in
    "$SEVERITY_CONSTRAINT") printf '✋ ConstraintError' ;;
    *)          printf '💥 MalfunctionError' ;;
  esac
}

# print a belay/halt block. the severity picks the mascot, the close-word, and the error
# class — SEVERITY_CONSTRAINT (exit 2) or SEVERITY_MALFUNCTION (exit 1) — so a reader knows at a glance
# whether to fix their input or to retry. the severity has no default: each call names it.
# args after the third are mid-tree items (`fix: ...`, `hint: ...`), each one `├─` line above
# the close; an empty item is skipped, so a caller may pass an optional one. an item may carry
# a nested body on its later lines.
print_belay() {
  local message="$1" command="$2" severity="$3"
  local item
  echo "🐈 $(as_belay_mascot "$severity")"
  echo ""
  echo "🧿 $command"
  for item in "${@:4}"; do
    [[ -n "$item" ]] && print_tree_item "$item"
  done
  print_tree_item "$(as_belay_close_line "$severity" "$message")" "$TREE_LAST"
}

# guard: are both counts (peers, budget) positive integers in range? one check, so a halt
# reads "both counts must hold" rather than a short-circuit chain.
are_positive_counts() {
  is_positive_integer "$1" || return 1
  is_positive_integer "$2"
}

# guard (delegates the probe to is_route_on_disk): does an init render name a route, and does that route stand on disk?
is_route_made_on_disk() {
  [[ -n "$1" ]] || return 1
  is_route_on_disk "$1"
}

# guard: does the arg list open on a passthrough value — a token there, and not itself a flag?
# rhx prepends --skill/--repo/--role; a value-less final flag must not eat the next real flag.
is_passthrough_value() {
  [[ $# -gt 0 ]] || return 1
  ! is_flag_token "$1"
}

# guard: does a plan request carry --skip-route-bind? a plan makes no route, so the flag
# means naught there. $1 = the mode, $2 = the skip-bind flag.
is_plan_with_skipped_bind() {
  [[ "$1" == "plan" ]] || return 1
  [[ -n "$2" ]]
}

# transformer: the child lines for as_tree_item_with_children, one arg per child — the
# children are data, never a hand-spliced newline string.
as_child_lines() {
  local IFS=$'\n'
  printf '%s' "$*"
}

# communicator (probes the route dir): has a route's 1.ground cut its slices? its yield is the one artifact ground writes,
# and no stone re-runs ground, so a grounded route's peer count is fixed.
is_route_grounded() {
  [[ -f "$1/.claims/1.ground.yield.md" ]]
}

# transformer: the count a reuse drives at — the request's when the flag was passed, else the
# bound route's recorded value, so a bare re-run never resets a live loop to a default.
as_effective_count() {
  local given="$1" requested="$2" recorded="$3"
  [[ -n "$given" ]] && { printf '%s' "$requested"; return 0; }
  printf '%s' "$recorded"
}

# guard (delegates the probe to is_route_grounded): would a new peer count widen no sweep? true when the
# count differs from the record and 1.ground has already cut the slices.
is_peer_count_locked() {
  local requested="$1" recorded="$2" route="$3"
  [[ "$requested" == "$recorded" ]] && return 1
  is_route_grounded "$route"
}

# guard: does a reuse keep the bound route's recorded peers + budget as they stand?
# $1 = peers, $2 = budget (this run's), $3 = peers, $4 = budget (the record's).
is_scope_record_kept() {
  [[ "$1" == "$3" && "$2" == "$4" ]]
}

# transformer: the reuse state line for the apply handoff — the counts kept, or the counts
# adopted with what they replaced, then a moot --skip-route-bind named when one was given.
# $1..$4 = as is_scope_record_kept, $5 = the skip-bind flag.
as_reuse_state() {
  local peers="$1" budget="$2" have_peers="$3" have_budget="$4" skip_bind="$5"
  is_scope_record_kept "$peers" "$budget" "$have_peers" "$have_budget" \
    && { printf 'reused the bound route; peers=%s budget=%s kept from its record%s' "$peers" "$budget" "$(as_skip_bind_moot_note "$skip_bind")"; return 0; }
  printf 'reused the bound route; peers=%s budget=%s adopted (was peers=%s budget=%s)%s' \
    "$peers" "$budget" "$have_peers" "$have_budget" "$(as_skip_bind_moot_note "$skip_bind")"
}

# transformer: a cause with its class markers dropped, to nest inside an outer cause. the
# outer line already names the class once; a repeat per nest level reads as noise.
as_unclassed_cause() {
  local class
  class="$(as_error_class "$SEVERITY_MALFUNCTION"): "
  printf '%s' "${1//"$class"/}"
}

# transformer: a raw tool message as a halt cause, behind its qualified class exactly once, so
# every `cause:` item tells the reader who fixes it (rule.require.qualified-error-headers).
as_qualified_cause() {
  printf '%s: %s' "$(as_error_class "$SEVERITY_MALFUNCTION")" "$(as_unclassed_cause "$1")"
}

# print a leaf cause behind its qualified class (rule.require.qualified-error-headers), so every
# cause a human reads opens the same way. $1 = the printf format; each arg nests unclassed.
print_malfunction_cause() {
  local format="$1" arg
  shift
  local args=()
  for arg in "$@"; do args+=("$(as_unclassed_cause "$arg")"); done
  printf '%s: ' "$(as_error_class "$SEVERITY_MALFUNCTION")"
  # shellcheck disable=SC2059
  printf "$format" "${args[@]}"
}

# guard: is a text empty or whitespace alone? a blank lesson is no lesson to push.
is_blank_text() {
  local text="$1"
  [[ -z "${text//[[:space:]]/}" ]]
}

# guard: is a token a flag (a `--` lead), never a value? the one test both the value guard
# and the rhx passthrough skip read, so "what counts as a flag" has one source.
is_flag_token() {
  [[ "$1" == --* ]]
}

# transformer: the fix for a `--flag=value` token — the flag and its value as two words.
as_split_flag_fix() {
  local token="$1"
  printf 'fix: pass the value as its own word: %s %s' "${token%%=*}" "${token#*=}"
}

# orchestrator (the request's checks, in one order, into a named message + fix; its one edge is
# the scope's -e probe): is a sweep request sound? the one source of the checks
# the parent skill and init.sh both run, in one order, so the two entry points never drift.
# on the first fault it returns 1 with the fault on stdout — its message on line 1, its fix on
# line 2 (as_sweep_fault) — so the report travels in the capture, as the verdict does, and no
# caller convention guards it. read the two back with as_fault_message + as_fault_fix.
# $1 = scope, $2 = grain, $3 = peers, $4 = budget.
get_sweep_request_fault() {
  local scope="$1" grain="$2" peers="$3" budget="$4"
  [[ -n "$scope" ]] || { as_sweep_fault "absent required arg: --scope" "$FIX_SCOPE"; return 1; }
  [[ -e "$scope" ]] || { as_sweep_fault "scope not found: $scope" "fix: pass a path that exists (a repo or a subtree)"; return 1; }
  [[ -n "$grain" ]] || { as_sweep_fault "absent required arg: --grain" "$(as_grain_fix)"; return 1; }
  is_valid_grain "$grain" || { as_sweep_fault "invalid grain: $grain" "$(as_grain_fix)"; return 1; }
  is_positive_integer "$peers" || { as_sweep_fault "invalid --peers: $peers" "$FIX_PEERS"; return 1; }
  is_positive_integer "$budget" || { as_sweep_fault "invalid --budget: $budget" "$FIX_BUDGET"; return 1; }
  return 0
}

# transformer: a sweep fault as two lines — the message, then its fix. each part is folded to
# one line first, so the split back can never misread a multi-line part.
as_sweep_fault() {
  printf '%s\n%s' "$(as_oneline "$1")" "$(as_oneline "$2")"
}

# transformer: the message of a sweep fault (its first line)
as_fault_message() {
  printf '%s' "${1%%$'\n'*}"
}

# transformer: the fix of a sweep fault (all after its first line)
as_fault_fix() {
  printf '%s' "${1#*$'\n'}"
}

# the skill's own command name, as a caller types it after `rhx`: every gate render headers with
# the command the caller ran, never an internal function name. read from this module's own dir,
# which the entry point names to source it, so the name has one source and a rename cannot split it
SKILL_NAME="$(basename "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)")"

# the flags each command reads; a flag given outside its command's set belays. each list is
# literal data, read as written: init reads the sweep's set less --mode (init always scaffolds).
# the integration suite pins that relation, so a sweep flag absent from init's list reddens
FLAGS_READ_BY_DISPATCH="--title"
FLAGS_READ_BY_REWIND="--route --cycle"
FLAGS_READ_BY_BACKUP=""
FLAGS_READ_BY_SWEEP="--scope --grain --peers --budget --mode --skip-route-bind"
FLAGS_READ_BY_INIT="--scope --grain --peers --budget --skip-route-bind"

# guard: is a token one of this skill's own flags (never an rhx passthrough, help, or value)?
# the set is the union of every command's list, so a flag added to one list is a skill flag too
SKILL_FLAGS="$FLAGS_READ_BY_DISPATCH $FLAGS_READ_BY_REWIND $FLAGS_READ_BY_SWEEP"
is_skill_flag() {
  [[ " $SKILL_FLAGS " == *" $1 "* ]]
}

# transformer: the flags a sweep command reads — init reads no --mode, plan and apply do.
# $1 = the subcommand (init, or empty for plan / apply).
as_sweep_flags_read() {
  [[ "$1" == "init" ]] && { printf '%s' "$FLAGS_READ_BY_INIT"; return 0; }
  printf '%s' "$FLAGS_READ_BY_SWEEP"
}

# transformer: the flags any command reads. $1 = the subcommand (empty for plan / apply).
as_flags_read_by() {
  [[ "$1" == "dispatch-lesson" ]] && { printf '%s' "$FLAGS_READ_BY_DISPATCH"; return 0; }
  [[ "$1" == "rewind-detect" ]] && { printf '%s' "$FLAGS_READ_BY_REWIND"; return 0; }
  [[ "$1" == "backup-before-rewrite" ]] && { printf '%s' "${FLAGS_READ_BY_BACKUP:-no flag}"; return 0; }
  as_sweep_flags_read "$1"
}

# transformer: the subcommand an arg list names (init, or a gate), or empty for a bare sweep.
# read before the parse, so a parse slip renders under the command the caller typed. a flag's
# value is skipped, so `--title init` names no subcommand.
SUBCOMMANDS=" init dispatch-lesson rewind-detect backup-before-rewrite "
as_subcommand_from_args() {
  while [[ $# -gt 0 ]]; do
    [[ "$SUBCOMMANDS" == *" $1 "* ]] && { printf '%s' "$1"; return 0; }
    is_value_flag "$1" && [[ $# -gt 1 ]] && shift
    shift
  done
  return 0
}

# guard: does a token take the next token as its value? (the --skip-route-bind switch takes none)
is_value_flag() {
  [[ "$1" == "--skip-route-bind" ]] && return 1
  is_skill_flag "$1" && return 0
  [[ "$1" == "--skill" || "$1" == "--repo" || "$1" == "--role" ]]
}

# guard: does an init request carry --mode? init always scaffolds, so a mode means naught there.
# $1 = the subcommand, $2 = the mode.
is_init_with_mode() {
  [[ "$1" == "init" ]] || return 1
  [[ -n "$2" ]]
}

# transformer: the given flags a command does not read, space-joined (empty when it reads all).
# a flag a command drops reads as obeyed, so the caller belays on any this names.
# $1 = the flags the command reads (space-joined), rest = the flags given.
as_foreign_flags() {
  local reads=" $1 " flag
  shift
  local foreign=()
  for flag in "$@"; do
    [[ "$reads" == *" $flag "* ]] || foreign+=("$flag")
  done
  printf '%s' "${foreign[*]}"
}

# guard: can a token serve as a flag's value — present, and not itself a flag?
is_flag_value() {
  [[ -n "$1" ]] || return 1
  ! is_flag_token "$1"
}

# orchestrator: require a flag's value — belay (exit 2) when the next token cannot serve as the value — absent,
# or a flag token that would eat the next flag whole. the one copy both entry points call.
# $1 = the command header, $2 = flag name, $3 = candidate value, $4 = the fix item, $5 = the
# hint item (each entry point names its own help page).
# note: this checks presence only, never an enum — a present-but-invalid value passes here
# and meets its dedicated validation (is_valid_grain, the --mode case).
require_flag_val() {
  is_flag_value "$3" && return 0
  print_belay "absent value for $2" "$1" "$SEVERITY_CONSTRAINT" "$4" "$5"
  exit 2
}

# the fix items for each flag's absent or invalid value, so every belay names what to type.
# an enum's fix reads one shape for every enum: `fix: pass one of <a>,<b>`.
FIX_SCOPE="fix: pass the surface to sweep (a repo or a subtree)"
FIX_MODE="fix: pass one of plan,apply"

# the one source of the valid sweep modes; FIX_MODE names the same pair
MODE_LIST=(plan apply)

# guard: is a mode value one of MODE_LIST? return 0 valid, 1 invalid.
is_valid_mode() {
  local candidate="$1" valid
  for valid in "${MODE_LIST[@]}"; do
    [[ "$candidate" == "$valid" ]] && return 0
  done
  return 1
}

# transformer: the fault for a sweep's --mode — empty when the mode is valid, else the
# message that names it absent or invalid.
as_mode_fault() {
  is_valid_mode "$1" && return 0
  [[ -z "$1" ]] && { printf 'absent required arg: --mode'; return 0; }
  printf 'invalid --mode: %s' "$1"
}

# the fix items for each cause-named malfunction, so no halt leaves the operator a diagnosis
# with no next step. both entry points name the same remedy for the same break.
# the git-break remedy as a sentence, so a `fix:` item and an inline `not bound:` cause share
# one source and neither strips a label from the other
REMEDY_GIT_RETRY="run git status here to see the break, repair it, then re-run"
FIX_GIT_RETRY="fix: $REMEDY_GIT_RETRY"
FIX_SCOPE_ENTER="fix: check the scope's permissions (each dir on its path must be enterable), then re-run"
FIX_ROUTE_WRITE="fix: check that .behavior/ is writable here (permissions, free space), then re-run"

# transformer: the fix for a route write that broke, fit to the cause the operator reads — a
# path that a file already holds needs that file moved, which no permission check would clear.
# $1 = the write's cause.
as_route_write_fix() {
  [[ "$1" == *"File exists"* || "$1" == *"Not a directory"* ]] \
    && { printf 'fix: a file stands where the route path needs a dir — move or remove it (check .behavior/ and the route path), then re-run'; return 0; }
  printf '%s' "$FIX_ROUTE_WRITE"
}
FIX_REINSTALL="fix: reinstall the role package"
FIX_ROUTE_REBIND="fix: unbind (rhx route.bind.del) and remove the route dir, then re-run to scaffold fresh (the .claims/ it holds are lost)"
FIX_ROUTE_RESTORE="fix: restore the absent files (git status, then git checkout -- <route>), then re-run"
FIX_BIND_PROBE="fix: check rhx route.bind.get, then re-run"
FIX_TOOL_RETRY="fix: check the tool the cause names (on PATH, runnable), then re-run"
FIX_SCAN_RETRY="fix: check grep (on PATH, runnable), then re-run the dispatch"
FIX_PUSH_RETRY="fix: check rhx radio.task.push (auth, network, rhx radio.uses get), then re-run the dispatch"
FIX_REWIND_RETRY="fix: check the record or tool the cause names (rhx route.stone.set for the rewind), then re-run"

# transformer: flatten a multi-line string onto one space-joined line, so a captured
# multi-line command output reads as a single tree-item label. behind a name so the
# orchestrators stay narrative (rule.forbid.inline-decode-friction).
as_oneline() {
  local text="$1"
  printf '%s' "${text//$'\n'/ }"
}

# transformer: the first line of a text (empty for an empty text). a parameter cut, never a
# `| head -1` pipe, which can take a sigpipe under pipefail and read as a tool break.
as_first_line() {
  local text="$1"
  printf '%s' "${text%%$'\n'*}"
}

# the one source of the valid grains, so the enum cannot drift across the many sites that
# reference it. both the main skill and init.sh source this file, so both read it here.
GRAIN_LIST=(infil exfil leak)

# what each grain hunts, in one line, for the help pages: an operator picks a grain from this,
# never from a source read or a spent plan
GRAIN_GLOSS="infil = what reaches in · exfil = what an attacker can pull out · leak = what your own next push publishes · all = the three"

# the one source of the route-kind token. the slug builder (get_route_slug), the bound-route
# matcher (extract_redteam_route_path), and init.sh's "already bound" belay all interpolate
# this, so the three can never drift apart. a builder/matcher divergence is a silent-breakage
# hazard: get_bound_route would stop recognizing a bound route, so apply treats a bound branch
# as unbound and a second route clobbers the first's in-flight .claims/.
ROUTE_KIND="guardian-redteam"

# guard: is a route path one of this skill's own — its dir name carries ROUTE_KIND, the token
# get_route_slug builds and extract_redteam_route_path matches? a gate that rewinds another
# skill's route would rewind that skill's stone and write into its .claims/.
is_redteam_route_path() {
  [[ "${1##*/}" == *"$ROUTE_KIND"* ]]
}

# transformer: the comma-joined valid-grain hint (the closed set, plus "all").
# one call site per hint/fix line, fed by GRAIN_LIST so a hint can never drift
# from the membership check.
as_grain_hint() {
  local IFS=,
  printf '%s' "${GRAIN_LIST[*]},all"
}

# transformer: the fix item for an absent or invalid grain.
as_grain_fix() {
  printf 'fix: pass one of %s' "$(as_grain_hint)"
}

# guard: is a grain value one of GRAIN_LIST (or "all")? return 0 valid, 1 invalid.
# the one membership check, consumed by every enum site (main skill + init.sh).
is_valid_grain() {
  local candidate="$1" valid
  for valid in "${GRAIN_LIST[@]}" all; do
    [[ "$candidate" == "$valid" ]] && return 0
  done
  return 1
}

# transformer: the grain-partitions a sweep runs, one per line. "all" expands to the three
# disjoint partitions of GRAIN_LIST; any other grain is its own one partition.
as_active_grains() {
  local grain="$1"
  [[ "$grain" == "all" ]] && { printf '%s\n' "${GRAIN_LIST[@]}"; return 0; }
  printf '%s\n' "$grain"
}

# transformer: a list of grains as one space-joined label for the plan render.
as_grain_list_text() {
  local IFS=' '
  printf '%s' "$*"
}

# transformer: a count with its noun, singular for one ("1 partition", "3 partitions").
# $1 = the count, $2 = the singular noun, $3 = the plural noun (default: the singular + s).
as_count_label() {
  local count="$1" one="$2" many="${3:-${2}s}"
  (( count == 1 )) && { printf '%s %s' "$count" "$one"; return 0; }
  printf '%s %s' "$count" "$many"
}

# the max for --peers and --budget. bash arithmetic wraps at 64 bits, so an unbounded
# digit run would wrap the projected-cost product into a nonsense or negative bound —
# and that product is the one pre-spend guarantee plan mode makes.
COUNT_MAX=9999

# guard: is a value a positive integer from 1 to COUNT_MAX (no zero prefix)? return 0
# valid, 1 invalid. the one count check both --peers and --budget, in both entry points,
# read as narrative (rule.forbid.inline-decode-friction).
is_positive_integer() {
  [[ "$1" =~ ^[1-9][0-9]{0,3}$ ]] && (( $1 <= COUNT_MAX ))
}

# the fix line for an invalid count, so both entry points name the same valid range.
# $1 = what the count means.
as_count_fix() {
  printf 'fix: pass a whole number from 1 to %s, no lead zero (%s)' "$COUNT_MAX" "$1"
}
FIX_PEERS="$(as_count_fix "blind peers per grain-partition")"
FIX_BUDGET="$(as_count_fix "the loop's spend allowance")"

# transformer: the argument vector init takes for a sweep, one argument per line — so the
# init subcommand and the apply scaffold thread the same validated values, never two copies.
# $1..$4 = scope, grain, peers, budget; $5 = "1" to skip the bind.
as_init_args() {
  local scope="$1" grain="$2" peers="$3" budget="$4" skip_bind="$5"
  printf '%s\n' --scope "$scope" --grain "$grain" --peers "$peers" --budget "$budget"
  [[ "$skip_bind" == "1" ]] && printf '%s\n' --skip-route-bind
  return 0
}

# guard: does a captured git failure message name the not-a-repo case? return 0 when the
# message is git's "not a git repository" text (a constraint the caller fixes — run from a
# repo), 1 for any other git failure (a real malfunction). a shell match, no forked tool, so no
# tool break can pose as either verdict. the probe runs git under the C locale, so the text this
# matches is never translated.
is_not_a_git_repo_error() {
  local said="${1,,}"
  [[ "$said" == *"not a git repository"* ]]
}

# the named verdict of get_git_repo_probe's return code (0 = inside a repo; 1 = git broke)
GIT_PROBE_NOT_A_REPO=2

# guard: does a repo probe's verdict say the cwd is not in a repo (a constraint the caller fixes)?
is_git_probe_not_a_repo() {
  (( $1 == GIT_PROBE_NOT_A_REPO ))
}

# guard: does a repo probe's verdict say git itself broke (neither in a repo nor plainly outside)?
is_git_probe_broke() {
  (( $1 != 0 && $1 != GIT_PROBE_NOT_A_REPO ))
}

# communicator: probe whether the cwd sits inside a git repo.
# return 0 inside a repo; GIT_PROBE_NOT_A_REPO (stdout = git's message) when not a repo — a
# constraint the caller fixes; 1 (stdout = git's message) on any other git failure.
# stderr is captured, never hidden, so a corrupt repo or a dubious-ownership refusal is
# never mislabeled "not a git repo". git runs under LC_ALL=C, so its message is the
# untranslated text is_not_a_git_repo_error reads, on any host locale.
get_git_repo_probe() {
  local said rc=0
  said="$(LC_ALL=C git rev-parse --git-dir 2>&1)" || rc=$?
  (( rc == 0 )) && return 0
  printf '%s' "$(as_oneline "$said")"
  is_not_a_git_repo_error "$said" && return "$GIT_PROBE_NOT_A_REPO"
  return 1
}

# communicator: the repo root. stdout = the root; return 1 (stdout = git's message) on a
# git failure.
# .why = the route lives at the repo root, where route.drive looks. a run from a subtree
#   must scaffold there too, and must read its --scope relative to that root.
get_repo_root() {
  local said
  said="$(LC_ALL=C git rev-parse --show-toplevel 2>&1)" || { printf '%s' "$(as_oneline "$said")"; return 1; }
  printf '%s' "$said"
}

# transformer: a bash builtin's error without its `<file>: line <n>: ` lead, so a cause names
# the break, never the host path or line of the shell module that hit it.
as_shell_cause() {
  local said="$1"
  [[ "$said" =~ ^.*:\ line\ [0-9]+:\ (.*)$ ]] && { printf '%s' "${BASH_REMATCH[1]}"; return 0; }
  printf '%s' "$said"
}

# communicator: a path with its symlinked leaf followed to the end target, hop by hop (a target
# is relative to its link's dir). a dir leaf needs no hop: `cd` resolves it. stdout = the path;
# return 1 (stdout = the cause) on a link cycle or a link that cannot be read.
SYMLINK_HOPS_MAX=40
get_symlink_target_path() {
  local path="$1" target hops=0
  while [[ -L "$path" && ! -d "$path" ]]; do
    (( hops++ < SYMLINK_HOPS_MAX )) || { printf 'too many symlink hops from %s (a link cycle?)' "$1"; return 1; }
    target="$(readlink -- "$path" 2>&1)" || { printf 'could not read the symlink %s: %s' "$path" "$(as_oneline "$target")"; return 1; }
    [[ "$target" == /* ]] || target="$(dirname -- "$path")/$target"
    path="$target"
  done
  printf '%s' "$path"
}

# communicator: the physical absolute form of a path that exists — symlinks, `.`, `..`, and
# doubled slashes all collapsed by the filesystem, never by a string trim. stdout = the path;
# return 1 (stdout = the cause) when the path cannot be entered.
get_physical_path() {
  local path="$1" dir said
  # a symlinked leaf resolves to its target, so a file alias lands the scope its target lands
  path="$(get_symlink_target_path "$path")" || { printf '%s' "$path"; return 1; }
  if [[ -d "$path" ]]; then
    said="$(CDPATH='' cd -- "$path" 2>&1 && pwd -P)" || { printf '%s' "$(as_shell_cause "$(as_oneline "$said")")"; return 1; }
    printf '%s' "$said"
    return 0
  fi
  dir="$(dirname -- "$path")"
  said="$(CDPATH='' cd -- "$dir" 2>&1 && pwd -P)" || { printf '%s' "$(as_shell_cause "$(as_oneline "$said")")"; return 1; }
  printf '%s/%s' "${said%/}" "$(basename -- "$path")"
}

# transformer: a physical path as a scope relative to a physical repo root — "." for the
# root itself, `src/foo` for a path within it, the absolute path for one outside it.
as_repo_relative_scope() {
  local path="$1" root="$2"
  [[ "$path" == "$root" ]] && { printf '.'; return 0; }
  [[ "$path" == "$root"/* ]] && { printf '%s' "${path#"$root"/}"; return 0; }
  printf '%s' "$path"
}

# orchestrator: the one canonical form of a scope — the repo root-relative path of the
# surface it names. two spellings of one surface (`.`, `./`, `src/..`, `src//foo`, a symlink)
# land one form, so they land one route slug and one reuse match.
# $1 = the scope as the caller spelled it (cwd-relative), $2 = the repo root.
# stdout = the scope; return 1 (stdout = the cause) on a filesystem failure.
get_scope_from_repo_root() {
  local scope="$1" root="$2" path
  root="$(get_physical_path "$root")" || { print_malfunction_cause 'could not enter the repo root: %s' "$root"; return 1; }
  path="$(get_physical_path "$scope")" || { print_malfunction_cause 'could not enter the scope: %s' "$path"; return 1; }
  as_repo_relative_scope "$path" "$root"
}

# transformer: canonicalize a --scope value by its spelling alone (a `./` lead, a `/./`, an
# end slash), for a render before the filesystem canon runs. get_scope_from_repo_root is the
# identity canon every route path and match uses.
as_normalized_scope() {
  local scope="$1" empty="."
  # an absolute scope trims toward the filesystem root, never toward the repo root
  [[ "$scope" == /* ]] && empty="/"
  scope="${scope#./}"
  scope="${scope//\/.\//\/}"
  scope="${scope%/.}"
  scope="${scope%/}"
  [[ -z "$scope" ]] && scope="$empty"
  printf '%s' "$scope"
}

# transformer: a filesystem-safe route token for a sweep's scope, so two sweeps of
# different surfaces on the same day get distinct routes rather than collide on a
# date+grain slug (which would force the operator to destroy the first sweep's in-flight
# .claims/ to start the second). the whole-repo sweep (".") needs no token.
# the encode is injective: alnum, `.`, and `-` stay; every `_` opens an escape — `_u` for a
# literal `_`, `__` for a `/`, `_xHH` for any other byte. so `foo bar` and `foo-bar`, or
# `foo-` and `foo`, or `src/foo` and `src__foo`, never share a token.
as_route_scope_token() {
  local scope="$1" token="" char i
  [[ "$scope" == "." ]] && { printf '%s' ""; return; }
  local LC_ALL=C
  for (( i = 0; i < ${#scope}; i++ )); do
    char="${scope:i:1}"
    case "$char" in
      [[:alnum:]]|.|-) token+="$char" ;;
      _)               token+="_u" ;;
      /)               token+="__" ;;
      \')              token+="_x27" ;;
      *)               token+="$(printf '_x%02x' "'$char")" ;;
    esac
  done
  printf '%s' ".scope=$token"
}

# transformer: the date-free tail of a sweep's route name: guardian-redteam.grain=<grain>[.scope=<token>].
as_route_suffix() {
  local grain="$1" scope="$2"
  printf '%s.grain=%s%s' "$ROUTE_KIND" "$grain" "$(as_route_scope_token "$scope")"
}

# orchestrator (the clock read via get_route_day, then the suffix): the route slug for a sweep: v<today>.<route suffix>. folds today's date, the grain, and a
# subtree scope token into one name, so two legitimate same-day sweeps (two grains, or two
# subtrees) land distinct routes. the token stays space-free so extract_redteam_route_path's
# `guardian-redteam[^ ]*` match still finds the route.
# a clock break returns 1 (stdout = the cause), never a slug with an empty date.
get_route_slug() {
  local grain="$1" scope="$2" day
  day="$(get_route_day)" || { printf '%s' "$day"; return 1; }
  printf 'v%s.%s' "$day" "$(as_route_suffix "$grain" "$scope")"
}

# communicator: today's date as a route names it (YYYY_MM_DD). stdout = the date, or the cause
# (return 1) when the clock read breaks or yields no date.
get_route_day() {
  local said rc=0
  said="$(date +%Y_%m_%d 2>&1)" || rc=$?
  (( rc != 0 )) && { as_tool_broke_cause get_route_day date "$rc" "" "$said"; return 1; }
  is_route_day "$said" \
    || { printf '%s: get_route_day: date gave no YYYY_MM_DD: %s' "$(as_error_class "$SEVERITY_MALFUNCTION")" "$(as_oneline "$said")"; return 1; }
  printf '%s' "$said"
}

# guard: is a text a route day (YYYY_MM_DD), the date shape every route name leads with?
is_route_day() {
  [[ "$1" =~ ^[0-9]{4}_[0-9]{2}_[0-9]{2}$ ]]
}

# orchestrator (the clock read, via get_route_slug): the repo-root-relative path a fresh sweep's
# route lands at today. return 1 (stdout = the cause) on a clock break.
get_route_path() {
  local slug
  slug="$(get_route_slug "$1" "$2")" || { printf '%s' "$slug"; return 1; }
  printf '.behavior/%s' "$slug"
}

# orchestrator (the grep extractor, then a cause or a normalized path): the route an init run made, read from its own render (its
# `route:` line) — never re-derived from the clock, never globbed from `.behavior/`, so a prior
# day's route or a stray dir can never stand in for a scaffold that made naught. stdout = the
# route path (no end slash), or empty when the render names none; return 1 (stdout = the
# extractor's cause) on a read break.
get_route_from_init_render() {
  local said="$1" route
  route="$(as_route_item_of_render "$said" | extract_redteam_route_path 2>&1)" \
    || { as_qualified_cause "$(as_oneline "$route")"; return 1; }
  as_normalized_route_path "$route"
}

# transformer: the first `route:` item line of a render (empty when none), so a header or a
# scope that names a redteam route path can never stand in for the route the render made.
as_route_item_of_render() {
  local line
  while IFS= read -r line; do
    [[ "$line" == *"─ route: "* ]] && { printf '%s\n' "$line"; return 0; }
  done <<< "$1"
  return 0
}


# transformer: a route path in one form — no `./` lead, no `/./` step, no doubled or end slash —
# so `./.behavior/x/` and `.behavior/x` name one route, as as_normalized_scope does for a scope.
as_normalized_route_path() {
  local route="$1"
  route="${route#./}"
  route="${route//\/.\//\/}"
  while [[ "$route" == *//* ]]; do route="${route//\/\//\/}"; done
  printf '%s' "${route%/}"
}

# print the not-security-advice disclaimer (every guidance output carries it): one footer line
# set apart from the tree by a blank line and led by its own glyph, as a hint block is, so no
# glyph-less line sits at a tree depth.
print_disclaimer() {
  echo ""
  echo "⚠️ informational only — not professional security advice, not exhaustive; consult a qualified security professional for your own habitat"
}

# the one place the redteam route-path pattern lives, so both the main skill
# and init.sh read as narrative and cannot drift apart.
# communicator (forks grep): read text on stdin, emit the first guardian-redteam route path
# (or empty when the text holds none).
extract_redteam_route_path() {
  # grep: 0 = matched, 1 = no match (benign — "no route"), >=2 = a real error (i/o, bad
  # pattern). a `|| true` would fold that real error into the identical benign "no route"
  # verdict, so rc>=2 surfaces as a malfunction (return 1), never as "no route". the capture
  # sits in a compound list (`|| rc=$?`) so `set -e` does not abort on grep's benign rc=1.
  local matched rc=0
  matched="$(grep -o "\.behavior/[^ ]*${ROUTE_KIND}[^ ]*")" || rc=$?
  if (( rc >= 2 )); then
    as_tool_broke_cause extract_redteam_route_path grep "$rc" "" "" >&2
    return 1
  fi
  as_first_line "$matched"
}

# communicator (forks grep): a deterministic backstop for the promote stone's fullsun-safe gate.
# reads a drafted radio-task body on stdin and emits every live-claim marker it finds
# (one per line, as `<line number>:<match>`), or no lines when the body looks already-generalized.
#
# .why = the dispatch tool is itself an exfil channel (the wish's sharpest irony). the
#   fullsun-safe gate decides whether a lesson may leave upstream, and a pure-judgment
#   gate has no floor — an agent that mis-judges dispatches a live claim with no net
#   beneath it. this is the floor: a cheap grep heuristic for the specifics a fullsun-safe
#   class must never carry (a path, a host, an ip, a key-shaped run, an account id). it is
#   a backstop, never the whole gate — a clean scan does not prove fullsun-safe (an agent
#   must still strip semantic specifics a regex cannot see), but a dirty scan proves a body
#   is not fullsun-safe and must not leave. the promote stone runs this on each drafted body
#   before dispatch and treats any hit as "keep in .claims/, do not dispatch".
scan_for_live_claim_markers() {
  # grep: 0 = markers found (dirty), 1 = none (clean), >=2 = a real scan error. a bare
  # `|| true` would fold a scanner malfunction into the empty "clean" result — and since the
  # promote gate reads "no lines = safe to dispatch", a tool break would become permission to
  # send a body upstream unscanned. the dispatch tool is an exfil channel, so this scanner
  # must fail toward dirty, never toward clean: on rc>=2 emit a malfunction line and return 1,
  # so the gate reads a malfunction as "not fullsun-safe, do not dispatch".
  local hits rc=0
  hits="$(grep -noE \
    -e '[0-9]{1,3}(\.[0-9]{1,3}){3}' \
    -e '\b([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b' \
    -e '\b[0-9a-fA-F]{1,4}(:[0-9a-fA-F]{1,4})*::([0-9a-fA-F]{1,4}:)*[0-9a-fA-F]{1,4}\b' \
    -e '(src|infra|provision|lib|bin|test|node_modules)/[A-Za-z0-9._/-]+' \
    -e '[A-Za-z0-9._-]+\.(tf|tfvars|ts|sh|js|py|go|rb|yml|yaml|json|txt|log)(:[0-9]+)?' \
    -e '\b[0-9a-fA-F]{32,}\b' \
    -e '\b[A-Za-z0-9+/]{40,}={0,2}\b' \
    -e '\b(AKIA|ASIA)[0-9A-Z]{16}\b' \
    -e '\bgh[pousr]_[A-Za-z0-9]{20,}\b' \
    -e '\bsk-[A-Za-z0-9_-]{20,}\b' \
    -e '(/home/|/Users/|/root/|~/)[A-Za-z0-9._/-]+' \
    -e '(/etc/|/var/|/opt/|/srv/|/usr/local/|/mnt/)[A-Za-z0-9._/-]+' \
    -e '[A-Za-z0-9._-]+\.(md|env|pem|key|sql|toml|ini|conf|cfg)\b' \
    -e 'arn:[a-z0-9:._/-]+' \
    -e '\b[0-9]{12}\b' \
    -e '\b([A-Za-z0-9-]+\.)+(com|net|org|io|dev|app|cloud|co|ai|us|xyz|me|sh|info|internal|local|lan|corp|intra|home)\b')" || rc=$?
  if (( rc >= 2 )); then
    echo "$(as_error_class "$SEVERITY_MALFUNCTION"): the live-claim scanner broke (grep rc=${rc}) — treat as not fullsun-safe, do not dispatch"
    return 1
  fi
  [[ -n "$hits" ]] && printf '%s\n' "$hits"
  return 0
}

# halt as a constraint (exit 2) / a malfunction (exit 1), under a given header — the one pair
# both entry points close a run with (init.sh binds its own header to them).
# $1 = the header, $2 = message, then items.
belay_with() {
  local header="$1" message="$2"
  print_belay "$message" "$header" "$SEVERITY_CONSTRAINT" "${@:3}"
  exit 2
}
halt_with() {
  local header="$1" message="$2"
  print_belay "$message" "$header" "$SEVERITY_MALFUNCTION" "${@:3}"
  exit 1
}

# print a gate's verdict in the house shape: the mascot, the gate header, the items, then the
# verdict as the tree's close. rc 0 = done; 2 = a constraint; any other = a malfunction (the
# belay close carries the qualified class, so no gate spells the class by hand).
# $1 = the gate header, $2 = rc, $3 = the verdict, then items (an empty item is skipped).
# return = rc, so the printer's status agrees with the verdict it rendered.
print_gate_verdict() {
  local command="$1" rc="$2" verdict="$3" item
  (( rc != 0 )) && { print_belay "$verdict" "$command" "$(as_severity_from_exit "$rc")" "${@:4}"; return "$rc"; }
  print_cat_header "smooth sailin!"
  print_tree_start "$command"
  for item in "${@:4}"; do
    [[ -z "$item" ]] && continue
    print_tree_item "$item"
  done
  print_tree_item "$verdict" "$TREE_LAST"
  return 0
}

# communicator (forks grep): read text on stdin, emit the first `.behavior/` route path of any kind
# (or empty when the text holds none). the kind-blind twin of extract_redteam_route_path,
# so get_bound_route can tell "no route bound" from "a different route is bound".
extract_any_route_path() {
  local matched rc=0
  matched="$(grep -o '\.behavior/[^ ]*')" || rc=$?
  if (( rc >= 2 )); then
    as_tool_broke_cause extract_any_route_path grep "$rc" "" "" >&2
    return 1
  fi
  as_first_line "$matched"
}

# the one upstream the promote stone teaches: the role-package this skill ships in
RADIO_TEACH_REPO="ehmpathy/rhachet-roles-ghlitch"

# transformer: the one act a sweep makes outside this habitat, named before any spend — 5.promote
# dispatches each fullsun-safe lesson as a public issue upstream, through the scan gate that
# refuses a live claim. a plan and an apply handoff both say so.
as_publish_disclosure() {
  printf '%s' "5.promote opens a public gh issue on $RADIO_TEACH_REPO per fullsun-safe lesson (a generalized class, never a live claim); each push runs the dispatch-lesson scan gate first, and live claims stay in .claims/"
}

# transformer: the outward act a sweep never takes itself, named before any spend — a published
# leak needs a revoke or rotate at its issuer, which can cut off a live consumer, so 4.repair
# drafts the command and a human runs it. a plan and an apply handoff both say so.
as_issuer_act_disclosure() {
  printf '%s' "4.repair never revokes or rotates a credential at its issuer — it drafts the command for a human to run, and the claim stays open until the human returns its output"
}

# transformer: the one destructive act a sweep takes inside the habitat, named before any spend —
# a redact edits the tree and rewrites each local unpushed commit that carries the value, so
# 4.repair passes the backup-before-rewrite gate first, which hands a dirty tree to a human. a
# plan and an apply handoff both say so.
as_history_rewrite_disclosure() {
  printf '%s' "4.repair edits the tree and rewrites each local unpushed commit that carries a leaked value — each rewrite passes rhx $SKILL_NAME backup-before-rewrite first, which takes a backup ref (refs/redteam-backup/<branch>.<head-sha>, never pushed by --all) and refuses the rewrite when the tree holds uncommitted work"
}

# guard: is stdin a terminal — no pipe at all? a gate that reads a terminal would wait on it
# forever, so the gate belays instead.
is_stdin_a_terminal() {
  [[ -t 0 ]]
}

# communicator: the whole of stdin — the one stdin read the orchestrators share. return = the
# read's own status, so a broken read never passes for an empty pipe; each caller checks it.
get_stdin_text() {
  cat
}

# the fix a live-claim refusal names for a marker that is no live claim: the scan has no opt-in,
# so the lesson sheds the constant and keeps its class
FIX_MARKER_FALSE_POSITIVE="fix: if a marker is no live claim, strip that constant from the title or body and re-run — a lesson carries the class, never the instance"

# the fix every stdin-read break names: the pipe broke, so the same pipe again is the retry
FIX_STDIN_REREAD="fix: re-run with the same pipe; if it breaks again, check the producer of the pipe"

# the remedy for a held push: the record waits QUEUED and delivers on its own, so a re-dispatch
# (above all under a reworded title) would only queue a twin
FIX_PUSH_HELD="fix: do not re-dispatch — the lesson waits QUEUED; see it: rhx radio.task.queue get; once radio.uses allows the push, deliver it: rhx radio.task.queue drain"

# the named verdict of radio.task.push's exit: 2 = held QUEUED (radio.uses blocks the push), never lost
RADIO_PUSH_HELD=2

# guard: did a radio push land? $1 = set_radio_lesson's return.
is_radio_push_sent() {
  (( $1 == 0 ))
}

# guard: was a radio push held QUEUED (blocked by radio.uses), to deliver with a later push or drain?
is_radio_push_held() {
  (( $1 == RADIO_PUSH_HELD ))
}

# communicator: push one lesson upstream as a radio task, a findsert keyed on the title.
# stdout = the push's own output; return = the push's.
set_radio_lesson() {
  local title="$1" body="$2"
  printf '%s' "$body" | rhx radio.task.push --via gh.issues --into "$RADIO_TEACH_REPO" \
    --title "$title" --description @stdin --idem findsert 2>&1
}

# communicator: rewind the route's 2.detect stone (its downstream stones follow). stdout = the
# cause on failure (return 1).
set_detect_rewound() {
  local route="$1" said
  said="$(rhx route.stone.set --stone 2.detect --as rewound --route "$route" 2>&1)" \
    || { printf '%s' "$(as_oneline "$said")"; return 1; }
}

# transformer: the text the live-claim scan reads for one lesson — the title line, then the
# drafted body. both leave upstream, so both are scanned.
as_scan_corpus() {
  local title="$1" body="$2"
  printf '%s\n%s\n' "$title" "$body"
}

# transformer: the scan's hits (`<corpus line>:<match>`) named by where the operator finds them —
# `title: <match>` for the corpus's first line, `body line <n>: <match>` for the rest, counted
# from the body's own first line (as_scan_corpus puts the title one line ahead of it).
as_marker_origin_lines() {
  local hits="$1" hit at match
  while IFS= read -r hit; do
    [[ -z "$hit" ]] && continue
    at="${hit%%:*}"
    match="${hit#*:}"
    (( at == 1 )) && { printf 'title: %s\n' "$match"; continue; }
    printf 'body line %s: %s\n' "$(( at - 1 ))" "$match"
  done <<< "$hits"
}

# orchestrator: dispatch one fullsun-safe lesson upstream as a radio task — the scan and the
# push in one call, so no dispatch can skip the scan.
# $1 = the task title; stdin = the drafted body.
# return 2 (with the markers printed) when the scan finds a live-claim marker in the title or
# body: the lesson stays in .claims/, naught is sent. return 1 on a scanner or push malfunction.
# .why = the dispatch tool is itself an exfil channel, and the push is the one irreversible act
#   in the ward loop. a scan the agent must remember to run before a separate push is a gate by
#   convention; this makes the scan a precondition of the push itself.
# .note = the push is a findsert keyed on the title (`--idem findsert`): the promote stone runs
#   every cycle, and a retry or a later cycle that re-drafts the same lesson class must find the
#   task already taught, never open a twin upstream.
dispatch_fullsun_lesson() {
  local title="$1" body markers pushed scan_rc=0 gate="$SKILL_NAME dispatch-lesson"
  if ! body="$(get_stdin_text)"; then
    print_gate_verdict "$gate" 1 "$(as_dispatch_stdin_broke_verdict)" "$FIX_STDIN_REREAD"
    return 1
  fi
  if is_blank_text "$body"; then
    print_gate_verdict "$gate" 2 "$(as_dispatch_empty_verdict)" "$FIX_LESSON_EMPTY"
    return 2
  fi
  markers="$(as_scan_corpus "$title" "$body" | scan_for_live_claim_markers)" || scan_rc=$?
  if (( scan_rc != 0 )); then
    print_gate_verdict "$gate" 1 "$(as_dispatch_scan_broke_verdict)" "cause: $(as_oneline "$markers")" "$FIX_SCAN_RETRY"
    return 1
  fi
  if [[ -n "$markers" ]]; then
    print_gate_verdict "$gate" 2 "$(as_dispatch_marker_verdict)" \
      "$(as_tree_item_with_children "markers" "   │  " "$(as_marker_origin_lines "$markers")")" \
      "$FIX_MARKER_FALSE_POSITIVE"
    return 2
  fi
  local push_rc=0
  pushed="$(set_radio_lesson "$title" "$body")" || push_rc=$?
  if is_radio_push_held "$push_rc"; then
    print_gate_verdict "$gate" 2 "$(as_dispatch_held_verdict)" "$(as_said_item "radio.task.push said" "$pushed")" "$FIX_PUSH_HELD"
    return 2
  fi
  is_radio_push_sent "$push_rc" \
    || { print_gate_verdict "$gate" 1 "$(as_dispatch_push_broke_verdict)" "$(as_said_item "radio.task.push said" "$pushed")" "$FIX_PUSH_RETRY"; return 1; }
  print_gate_verdict "$gate" 0 "$(as_dispatch_sent_verdict)" "$(as_said_item "radio.task.push said" "$pushed")"
}

# the fix for an empty lesson body: the pipe the gate reads
FIX_LESSON_EMPTY="fix: pipe the drafted lesson on stdin: printf '%s' \"\$body\" | rhx $SKILL_NAME dispatch-lesson --title <title>"

# transformers: the dispatch gate's verdict, one per outcome — the one place its vocabulary lives.
as_dispatch_stdin_broke_verdict() {
  printf 'not dispatched — the lesson body could not be read from stdin; naught was sent'
}
as_dispatch_empty_verdict() {
  printf 'not dispatched — the lesson body is empty; naught was sent'
}
as_dispatch_scan_broke_verdict() {
  printf 'not dispatched — the live-claim scanner broke; naught was sent'
}
as_dispatch_marker_verdict() {
  printf 'not dispatched — live-claim marker(s) found; keep this lesson in .claims/'
}
as_dispatch_held_verdict() {
  printf 'held, not yet sent — radio.uses blocks the push, so the lesson waits QUEUED and delivers with the next push or drain that gets through'
}
as_dispatch_push_broke_verdict() {
  printf 'not dispatched — the push broke'
}
as_dispatch_sent_verdict() {
  printf 'dispatched to %s' "$RADIO_TEACH_REPO"
}

# transformer: a captured child render as one bucket item, or no item when the child said
# naught (an empty bucket would render a bare gutter under its label).
as_said_item() {
  local label="$1" said="$2"
  [[ -z "$said" ]] && return 0
  as_tree_item_with_body "$label" "   │  " "$said"
}

# transformer: the record line that holds one carried key in a cycle block. the writer and the
# read-back both take it from here, so the two can never disagree on the format.
as_cycle_carry_line() {
  printf -- '- carried PENDING-REDETECT: %s' "$1"
}

# the record line that marks a cycle's rewind as done, so a repeat call converges
CYCLE_REWOUND_LINE="- rewound: yes"

# communicator (reads the record): the lines of one `## cycle N` block of a cycle record (header excluded), from
# its header to the next header or the end. stdout = the block lines; return 1 on a read
# break (an unreadable record), never folded into "block empty".
# the awk program that prints one block: lines after the `head` header, up to the next header
CYCLE_BLOCK_AWK='$0 == head { inside = 1; next } /^## cycle / { inside = 0 } inside'
get_cycle_block() {
  local record="$1" cycle="$2" said rc=0
  said="$(awk -v head="## cycle $cycle" "$CYCLE_BLOCK_AWK" "$record" 2>&1)" || rc=$?
  (( rc == 0 )) && { printf '%s' "$said"; return 0; }
  as_tool_broke_cause get_cycle_block awk "$rc" "$record" "$said" >&2
  return 1
}

# transformer: the one shape every leaf's tool-break cause takes —
# `💥 MalfunctionError: <fn>: <tool> broke (rc=N)[ on <file>][: <detail>]`.
# $1 = the leaf, $2 = the tool, $3 = its rc, $4 = the file it read (may be empty), $5 = the
# tool's own words (may be empty).
as_tool_broke_cause() {
  local fn="$1" tool="$2" rc="$3" file="$4" detail="$5"
  printf '%s: %s: %s broke (rc=%s)' "$(as_error_class "$SEVERITY_MALFUNCTION")" "$fn" "$tool" "$rc"
  [[ -n "$file" ]] && printf ' on %s' "$file"
  [[ -n "$detail" ]] && printf ': %s' "$(as_oneline "$detail")"
  printf '\n'
}

# communicator: does a text hold an exact line? return 0 yes, CYCLE_BLOCK_ABSENT no, 1 on a grep
# break (the cause on stderr, named for the leaf that asked). $1 = the line, $2 = the text,
# $3 = the leaf, $4 = the file the text came from.
has_exact_line() {
  local line="$1" text="$2" fn="$3" file="$4" rc=0
  grep -qxF -- "$line" <<< "$text" || rc=$?
  (( rc == 0 )) && return 0
  (( rc == 1 )) && return "$CYCLE_BLOCK_ABSENT"
  as_tool_broke_cause "$fn" grep "$rc" "$file" "" >&2
  return 1
}

# the named verdicts of the cycle-record guards (0 = the block or line stands)
CYCLE_READ_BROKE=1
CYCLE_BLOCK_ABSENT=2

# guard: does a cycle-record probe's verdict say the block or line stands?
is_cycle_entry_held() {
  (( $1 == 0 ))
}

# guard: does a cycle-record probe's verdict say the block or line is absent?
is_cycle_entry_absent() {
  (( $1 == CYCLE_BLOCK_ABSENT ))
}

# guard: does a cycle-record probe's verdict say the read broke?
is_cycle_read_broke() {
  (( $1 == CYCLE_READ_BROKE ))
}

# communicator (reads the record): does a cycle record hold a `## cycle N` header? return 0 yes, CYCLE_BLOCK_ABSENT no,
# 1 on a read break. grep rc 1 (no match) is the only "no"; rc >= 2 surfaces, never reads absent.
has_cycle_block() {
  local record="$1" cycle="$2" said rc=0
  said="$(grep -xF -- "## cycle $cycle" "$record" 2>&1)" || rc=$?
  (( rc == 0 )) && return 0
  (( rc == 1 )) && return "$CYCLE_BLOCK_ABSENT"
  as_tool_broke_cause has_cycle_block grep "$rc" "$record" "$said" >&2
  return 1
}

# orchestrator (the block cut, then the line probe): does a cycle's block hold a given line?
# return 0 yes, CYCLE_BLOCK_ABSENT no, 1 on a read break.
has_cycle_line() {
  local record="$1" cycle="$2" line="$3" block
  block="$(get_cycle_block "$record" "$cycle")" || return 1
  has_exact_line "$line" "$block" has_cycle_line "$record"
}

# guard: is a value a cycle count — a whole number, zero included?
is_cycle_count() {
  [[ "$1" =~ ^[0-9]+$ ]]
}

# communicator (reads the record): how many `## cycle` blocks a cycle record holds. return 1 on a read break.
get_cycle_count() {
  local record="$1" count rc=0
  count="$(grep -c '^## cycle ' "$record" 2>&1)" || rc=$?
  (( rc >= 2 )) && { as_tool_broke_cause get_cycle_count grep "$rc" "$record" "$count" >&2; return 1; }
  # grep -c prints a count on a match and on none (rc 1); no number is a read break, never zero
  is_cycle_count "$count" || { echo "$(as_error_class "$SEVERITY_MALFUNCTION"): get_cycle_count: no count read from $record" >&2; return 1; }
  printf '%s' "$count"
}

# communicator: open a route's cycle record (its dir and an empty file, findsert).
# stdout = the cause on failure (return 1). the tools run under the C locale, so the cause
# reads the same on every host.
gen_cycle_record() {
  local route="$1" said
  said="$( { LC_ALL=C mkdir -p "$route/.claims" && LC_ALL=C touch "$route/.claims/0.cycle.md"; } 2>&1)" \
    || { print_malfunction_cause 'could not open the cycle record %s/.claims/0.cycle.md: %s' "$route" "$(as_oneline "$said")"; return 1; }
}

# orchestrator (reads the holder, probes its pid, branches on the verdict): who holds a
# cycle-record lock, for the time-out cause — the holder pid and whether it still runs. a lock
# whose holder is gone was left by an interrupted write.
get_lock_holder_label() {
  local lock="$1" holder
  [[ -e "$lock/holder" ]] || { as_holder_unrecorded_label; return 0; }
  holder="$(get_lock_holder_pid "$lock")" || { as_holder_unreadable_label "$holder"; return 0; }
  local signal_rc=0 signal_said
  signal_said="$(get_process_signal_said "$holder")" || signal_rc=$?
  is_process_signaled "$signal_rc" && { as_holder_live_label "$holder"; return "$LOCK_HOLDER_LIVE"; }
  # kill -0 fails for a gone pid (no such process) and for a live pid of another user (not
  # permitted); only the first is stale, so the second names its cause and never invites a removal
  is_no_such_process "$signal_said" \
    || { as_holder_unsignalable_label "$holder" "$signal_said"; return "$LOCK_HOLDER_UNSIGNALABLE"; }
  as_holder_gone_label "$holder"
}

# transformers: the label of each lock-holder verdict, for the lock time-out cause.
as_holder_unrecorded_label() {
  printf 'holder unrecorded'
}
as_holder_unreadable_label() {
  printf 'holder unreadable (%s)' "$(as_oneline "$1")"
}
as_holder_live_label() {
  printf 'held by pid %s, which still runs' "$1"
}
as_holder_unsignalable_label() {
  printf 'held by pid %s, which this shell cannot signal (%s) — it may still run' "$1" "$(as_shell_cause "$(as_oneline "$2")")"
}
as_holder_gone_label() {
  printf 'held by pid %s, which is gone — an interrupted write left it' "$1"
}

# communicator: the holder pid a lock records. stdout = the pid, or cat's cause (return 1).
get_lock_holder_pid() {
  LC_ALL=C cat -- "$1/holder" 2>&1
}

# communicator: signal 0 to a pid — does it run, and may this shell signal it? return = kill's;
# stdout = kill's own words on a refusal (no such process, or not permitted).
get_process_signal_said() {
  kill -0 "$1" 2>&1
}

# guard: did a signal-0 probe reach the process (it runs, and this shell may signal it)?
# $1 = get_process_signal_said's return.
is_process_signaled() {
  (( $1 == 0 ))
}

# the named verdicts of get_lock_holder_label's return code (0 = the holder is gone, unrecorded,
# or unreadable — a lock an interrupted write may have left)
LOCK_HOLDER_UNSIGNALABLE=3
LOCK_HOLDER_LIVE=4

# guard: may the holder still run — a live holder, or one this shell cannot signal? either way
# the lock is not stale, so its removal would let a second writer in.
# $1 = get_lock_holder_label's return.
is_lock_holder_maybe_live() {
  (( $1 == LOCK_HOLDER_LIVE || $1 == LOCK_HOLDER_UNSIGNALABLE ))
}

# transformer: the remedy for a lock not taken in time. a holder that may still run is never
# offered for removal. $1 = the lock, $2 = get_lock_holder_label's rc.
as_lock_wait_remedy() {
  local lock="$1" holder_rc="$2"
  is_lock_holder_maybe_live "$holder_rc" && { printf 'do not remove it; wait for that drive to end, then re-run'; return 0; }
  printf 'if no drive runs, remove it: rm -r %s' "$lock"
}

# guard: does a kill message say the pid is gone (no such process)? under LC_ALL=C both bash's
# builtin and procps render that cause in these words.
is_no_such_process() {
  [[ "$1" == *"No such process"* ]]
}

# communicator: write this shell's pid into a lock dir's holder file. `$$` is the top shell's pid
# in a capture too, so the holder names the drive, never a subshell.
set_lock_holder_pid() {
  printf '%s' "$$" > "$1/holder"
}

# communicator: append stdin to a cycle record — the record's one write discipline: a plain
# append, serialized by the cycle lock its caller holds.
set_cycle_record_append() {
  cat >> "$1"
}

# orchestrator: record this shell's pid as a fresh lock's holder. a holder that cannot be
# written releases the lock (del_cycle_record_lock) and names the cause (return 1), so no lock
# stands unattributed.
set_lock_holder() {
  local lock="$1" said released
  said="$(set_lock_holder_pid "$lock" 2>&1)" && return 0
  released="$(del_cycle_record_lock "$lock")" \
    || { print_malfunction_cause 'could not record the holder of the lock %s: %s; %s' "$lock" "$(as_shell_cause "$(as_oneline "$said")")" "$released"; return 1; }
  print_malfunction_cause 'could not record the holder of the lock %s: %s' "$lock" "$(as_shell_cause "$(as_oneline "$said")")"
  return 1
}

# the cycle lock's wait, ~5s in all, read as one label: LOCK_WAIT_FAST_TRIES quick tries
# LOCK_WAIT_FAST_GAP apart (a short holder clears at once), then LOCK_WAIT_SLOW_TRIES backed off
# to LOCK_WAIT_SLOW_GAP (a slow write is not polled hot). a gap is fractional seconds, which
# GNU, BSD, and busybox sleep accept.
LOCK_WAIT_FAST_TRIES=10
LOCK_WAIT_FAST_GAP=0.1
LOCK_WAIT_SLOW_TRIES=8
LOCK_WAIT_SLOW_GAP=0.5
LOCK_WAIT_TRIES=$(( LOCK_WAIT_FAST_TRIES + LOCK_WAIT_SLOW_TRIES ))
LOCK_WAIT_LABEL="~5s"

# communicator (the clock): wait the backoff gap before lock try N+1. stdout = sleep's cause
# on failure (return 1), so a broken clock halts named, never reads as a held lock.
wait_lock_gap() {
  local said
  said="$(LC_ALL=C sleep "$(as_lock_wait_gap "$1")" 2>&1)" && return 0
  printf '%s' "$(as_oneline "${said:-sleep exited nonzero}")"
  return 1
}

# the named verdict of gen_lock_dir_exclusive's return code (0 = created; 1 = the create broke)
LOCK_DIR_EXTANT=2

# guard: did an exclusive lock-dir create take the lock? $1 = gen_lock_dir_exclusive's return.
is_lock_dir_created() {
  (( $1 == 0 ))
}

# guard: did an exclusive lock-dir create meet a lock another holder has (contention)?
is_lock_dir_extant() {
  (( $1 == LOCK_DIR_EXTANT ))
}

# communicator: create a lock dir exclusively — `mkdir` creates it or fails when it stands, in one
# syscall. return 0 created; LOCK_DIR_EXTANT when another holder has it (contention); 1 (stdout =
# mkdir's cause, one line) when the create broke.
gen_lock_dir_exclusive() {
  local lock="$1" said
  said="$(LC_ALL=C mkdir "$lock" 2>&1)" && return 0
  is_dir_extant_refusal "$said" "$lock" && return "$LOCK_DIR_EXTANT"
  printf '%s' "$(as_oneline "$said")"
  return 1
}

# guard: did an exclusive mkdir fail because the dir stood? mkdir's own words (under the C
# locale) decide it first, so a rival that removed the dir right after the refusal still reads
# as contention, never as a broken create; the dir test backs a mkdir that words it otherwise.
# $1 = mkdir's cause, $2 = the dir.
is_dir_extant_refusal() {
  [[ "$1" == *"File exists"* ]] && return 0
  [[ -d "$2" ]]
}

# transformer: the gap before lock try N+1 — quick at first, then backed off.
as_lock_wait_gap() {
  (( $1 <= LOCK_WAIT_FAST_TRIES )) && { printf '%s' "$LOCK_WAIT_FAST_GAP"; return 0; }
  printf '%s' "$LOCK_WAIT_SLOW_GAP"
}

# orchestrator: take the cycle record's lock — a `mkdir`, which creates the lock dir or fails
# when it stands, in one syscall — and record the holder pid inside it. waits up to ~5s for a
# concurrent holder. stdout = the cause on failure (return 1): a create that broke for any
# reason but contention halts at once with mkdir's own cause; a time-out names the lock, its
# holder, and the remedy.
# .why = a block write is check-then-append; two concurrent carries for one cycle would both
#   see "absent" and both append, which inflates the cycle count the budget cap reads.
# .note = a stale lock is named, never reclaimed in place: a reclaim races a second waiter that
#   could remove a lock the first just took, so the remedy goes to the operator.
gen_cycle_record_lock() {
  local lock="$1" try said dir_rc
  for (( try = 1; try <= LOCK_WAIT_TRIES; try++ )); do
    dir_rc=0
    said="$(gen_lock_dir_exclusive "$lock")" || dir_rc=$?
    is_lock_dir_created "$dir_rc" && { set_lock_holder "$lock"; return; }
    is_lock_dir_extant "$dir_rc" \
      || { print_malfunction_cause 'could not create the lock %s: %s' "$lock" "$said"; return 1; }
    said="$(wait_lock_gap "$try")" \
      || { print_malfunction_cause 'could not wait the lock backoff for %s: %s' "$lock" "$said"; return 1; }
  done
  local holder_label holder_rc=0
  holder_label="$(get_lock_holder_label "$lock")" || holder_rc=$?
  print_malfunction_cause 'could not take the lock %s within %s (%s) — %s' \
    "$lock" "$LOCK_WAIT_LABEL" "$holder_label" "$(as_lock_wait_remedy "$lock" "$holder_rc")"
  return 1
}

# communicator: release the cycle record's lock. stdout = the cause on failure (return 1), so a
# lock that outlives its write is named at once, never left for a later time-out to find.
del_cycle_record_lock() {
  local lock="$1" said
  said="$(LC_ALL=C rm -r -- "$lock" 2>&1)" && return 0
  print_malfunction_cause 'could not release the lock %s: %s — remove it by hand: rm -r %s' "$lock" "$(as_oneline "$said")" "$lock"
  return 1
}

# orchestrator: run one record write under the cycle record's lock. $1 = the record, then the
# command and its args. return = the command's, or 1 (stdout = the cause) when the lock cannot
# be taken.
set_under_cycle_record_lock() {
  local record="$1" lock="$1.lock" rc=0 said
  shift
  said="$(gen_cycle_record_lock "$lock")" || { printf '%s' "$said"; return 1; }
  "$@" || rc=$?
  said="$(del_cycle_record_lock "$lock")" || { printf '%s' "$said"; return "$(as_lock_write_exit "$rc")"; }
  return "$rc"
}

# transformer: the exit of a locked write whose lock release broke — the write's own failure
# code when it failed, else 1, so the release break never reads as success.
as_lock_write_exit() {
  local write_rc="$1"
  (( write_rc != 0 )) && { printf '%s' "$write_rc"; return 0; }
  printf '1'
}

# orchestrator (unlocked): upsert one cycle's carry block — append the block when its header is
# absent, or append each key it lacks when it stands, so a retry with a corrected superset of
# keys converges rather than dead-ends. an append lands at the record's end, so either write
# refuses when a later cycle's block already stands — the same order invariant the rewound
# marker holds (set_cycle_rewound_line).
set_cycle_carry_block() {
  local record="$1" cycle="$2" allowance="$3" keys="$4" has_rc=0 next_rc=0 absent
  has_cycle_block "$record" "$cycle" || has_rc=$?
  is_cycle_read_broke "$has_rc" && return 1
  if is_cycle_entry_held "$has_rc"; then
    absent="$(get_cycle_carry_absent "$record" "$cycle" "$keys")" || return 1
    [[ -z "$absent" ]] && return 0
  fi
  has_cycle_block "$record" "$(( cycle + 1 ))" || next_rc=$?
  is_cycle_read_broke "$next_rc" && return 1
  if is_cycle_entry_held "$next_rc"; then
    print_malfunction_cause 'cycle %s would land after cycle %s in %s, out of order' \
      "$cycle" "$(( cycle + 1 ))" "$record"
    return 1
  fi
  is_cycle_entry_held "$has_rc" && { as_cycle_carry_lines "$absent" | set_cycle_record_append "$record"; return; }
  as_cycle_carry_block "$cycle" "$allowance" "$keys" | set_cycle_record_append "$record"
}

# transformer: one cycle's carry block as the record holds it — its header, its spend, and one
# carry line per key.
as_cycle_carry_block() {
  local cycle="$1" allowance="$2" keys="$3"
  printf '\n## cycle %s\n- spent: %s / %s\n' "$cycle" "$cycle" "$allowance"
  as_cycle_carry_lines "$keys"
}

# transformer: one carry line per key. an empty key line is skipped via `continue`, never a
# failed test: the loop's status is its last body command's, so a failed test at the end would
# fail on zero keys.
as_cycle_carry_lines() {
  local keys="$1" key
  while IFS= read -r key; do
    [[ -z "$key" ]] && continue
    printf '%s\n' "$(as_cycle_carry_line "$key")"
  done <<< "$keys"
}

# orchestrator: upsert one cycle's carry block into the route's cycle record.
# $1 = route path, $2 = cycle number, $3 = allowance, $4 = the carried keys (one
# `channel::mechanism` per line). a block whose header already stands is left as is, so a
# second call is a no-op; the write runs under the record's lock, so a concurrent twin call
# cannot append a second block. return 1 (stdout = the cause, when one is known) on a read or
# write break.
set_cycle_carry() {
  local route="$1" cycle="$2" allowance="$3" keys="$4"
  local record="$route/.claims/0.cycle.md" said
  said="$(gen_cycle_record "$route")" || { printf '%s' "$said"; return 1; }
  set_under_cycle_record_lock "$record" set_cycle_carry_block "$record" "$cycle" "$allowance" "$keys"
}

# orchestrator (unlocked): append the rewound marker to a cycle's block unless it holds one.
# an append lands in the record's last block, so the write confirms, under the lock, that no
# later block follows this cycle's; else the marker would land in the later block, which would
# then read itself as rewound and skip its re-detect. stdout = the cause on that refusal.
set_cycle_rewound_line() {
  local record="$1" cycle="$2" has_rc=0 next_rc=0
  has_cycle_line "$record" "$cycle" "$CYCLE_REWOUND_LINE" || has_rc=$?
  is_cycle_entry_held "$has_rc" && return 0
  is_cycle_read_broke "$has_rc" && return 1
  has_cycle_block "$record" "$(( cycle + 1 ))" || next_rc=$?
  is_cycle_read_broke "$next_rc" && return 1
  if is_cycle_entry_held "$next_rc"; then
    print_malfunction_cause 'cycle %s is no longer the last block of %s (cycle %s follows), so its marker would land in the later block' \
      "$cycle" "$record" "$(( cycle + 1 ))"
    return 1
  fi
  printf '%s\n' "$CYCLE_REWOUND_LINE" | set_cycle_record_append "$record"
}

# orchestrator (unlocked): findsert one cycle's carry block, then its rewound marker.
set_cycle_rewound_block() {
  local record="$1" cycle="$2" allowance="$3" keys="$4"
  set_cycle_carry_block "$record" "$cycle" "$allowance" "$keys" || return 1
  set_cycle_rewound_line "$record" "$cycle"
}

# orchestrator: mark a cycle's rewind as done, under the record's lock. the rewind may have
# archived `.claims/`, so the record and this cycle's block are findserted first, then the
# marker lands inside the block. stdout = the cause on failure (return 1).
set_cycle_rewound() {
  local route="$1" cycle="$2" allowance="$3" keys="$4"
  local record="$route/.claims/0.cycle.md" said
  said="$(gen_cycle_record "$route")" || { printf '%s' "$said"; return 1; }
  set_under_cycle_record_lock "$record" set_cycle_rewound_block "$record" "$cycle" "$allowance" "$keys"
}

# orchestrator (reads the record): list each carried key absent from one cycle's block (one per line; none = all
# held). scoped to the cycle under test, so a key an earlier cycle carried can never stand in
# for a key this cycle lost. return 1 on a read break.
get_cycle_carry_absent() {
  local record="$1" cycle="$2" keys="$3" key rc
  while IFS= read -r key; do
    [[ -z "$key" ]] && continue
    rc=0
    has_cycle_line "$record" "$cycle" "$(as_cycle_carry_line "$key")" || rc=$?
    is_cycle_read_broke "$rc" && return 1
    is_cycle_entry_absent "$rc" && printf '%s\n' "$key"
  done <<< "$keys"
  return 0
}

# orchestrator: carry the keys into the record, then confirm this cycle's block holds each.
# stdout = the cause on failure; return 1 on a read/write break or a key not held.
set_cycle_carry_confirmed() {
  local route="$1" cycle="$2" allowance="$3" keys="$4" when="$5"
  local record="$route/.claims/0.cycle.md" absent said
  # a probe break names its cause on stderr, so both streams ride the verdict, never a guess
  said="$(set_cycle_carry "$route" "$cycle" "$allowance" "$keys" 2>&1)" \
    || { print_malfunction_cause 'could not write the cycle record %s: %s' "$record" "$(as_unclassed_cause "$(as_oneline "${said:-the append broke}")")"; return 1; }
  absent="$(get_cycle_carry_absent "$record" "$cycle" "$keys" 2>&1)" \
    || { print_malfunction_cause 'could not read the cycle record %s: %s' "$record" "$(as_unclassed_cause "$(as_oneline "$absent")")"; return 1; }
  [[ -z "$absent" ]] && return 0
  as_carry_absent_verdict "$cycle" "$when" "$absent"
  return 1
}

# transformer: the verdict for carried keys the cycle's block does not hold.
# $1 = the cycle, $2 = before|after (the rewind), $3 = the absent keys, one per line.
as_carry_absent_verdict() {
  printf 'carried key(s) absent from cycle %s %s the rewind: %s' "$1" "$2" "$(as_oneline "$3")"
}

# guard: has a loop spent its budget at this cycle? the budget counts cycles, so the cycle
# that reaches the allowance is the last one paid for.
is_budget_spent() {
  local cycle="$1" allowance="$2"
  (( cycle >= allowance ))
}

# orchestrator: rewind 2.detect for the next ward cycle, with the open claims' keys carried,
# and render the verdict in the house shape (print_gate_verdict).
# $1 = route path, $2 = the cycle just walked (1 for the first pass); stdin = the carried
# PENDING-REDETECT keys, one `channel::mechanism` per line.
# return 2 (a constraint) when the budget is spent or the cycle number is out of order —
#   naught rewound; terminate (and, on a spent budget with a critical claim open, escalate).
# return 1 when the record or the scope cannot be read, a key cannot be held, or the rewind fails.
# idempotent: a cycle whose block holds the rewound marker is not rewound twice — a repeat
#   call re-confirms its carry and returns 0, wherever the record has since advanced, so a
#   retry reflex cannot re-dispatch the peers.
rewind_detect_with_cycle_carry() {
  local route="$1" cycle="$2" verdict rc=0
  verdict="$(set_detect_rewound_with_cycle_carry "$route" "$cycle")" || rc=$?
  print_gate_verdict "$SKILL_NAME rewind-detect --route $route --cycle $cycle" "$rc" "$verdict" "$(as_rewind_fix "$rc")"
  return "$rc"
}

# transformer: the fix item a rewind verdict closes on — a malfunction (rc 1) names the retry
# path; a constraint's verdict already names its own fix, and a success needs none (empty = no item).
as_rewind_fix() {
  (( $1 == 1 )) || return 0
  printf '%s' "$FIX_REWIND_RETRY"
}

# orchestrator: the rewind itself. stdin, args, and return = as rewind_detect_with_cycle_carry;
# stdout = the one-line verdict.
# .why = the convergence proof rests on the carried keys, and the budget is the loop's one
#   hard stop. the cap reads `0.scope.md`'s budget (never a value the agent reports), and the
#   cycle must follow the record's own count, so neither can drift. the rewind may or may not
#   archive `.claims/`; this carries the keys before it, re-carries them after it, and reads
#   them back from this cycle's block, so a lost key halts loud instead of a silent drop.
# .note = the rewound marker lands the moment the real rewind does, before any later step
#   that can fail for its own reason: a retry after a later failure reads the marker and
#   converges, never rewinds twice.
# .note = the marker check, the rewind, and the marker write run under one rewind lock, so two
#   overlapped calls cannot both read "not rewound" and both re-dispatch the peers: the second
#   waits, then reads the marker the first wrote.
set_detect_rewound_with_cycle_carry() {
  local route="$1" cycle="$2"
  local keys allowance cause lock verdict rc=0 field_rc=0
  keys="$(get_stdin_text)" \
    || { as_rewind_stdin_broke_verdict; return 1; }
  allowance="$(get_route_scope_field "$route" budget)" || field_rc=$?
  is_scope_field_read "$field_rc" \
    || { as_rewind_budget_unread_verdict "$allowance" "$field_rc" "$route"; return 1; }
  is_positive_integer "$allowance" \
    || { as_rewind_budget_invalid_verdict "$allowance" "$route"; return 1; }
  cause="$(gen_cycle_record "$route")" \
    || { as_not_rewound_verdict "$cause"; return 1; }
  lock="$(as_rewind_lock "$route")"
  cause="$(gen_cycle_record_lock "$lock")" \
    || { as_not_rewound_verdict "$cause"; return 1; }
  verdict="$(set_detect_rewound_once "$route" "$cycle" "$allowance" "$keys")" || rc=$?
  cause="$(del_cycle_record_lock "$lock")" \
    || { as_verdict_then_release_broke "$verdict" "$cause"; return "$(as_lock_write_exit "$rc")"; }
  echo "$verdict"
  return "$rc"
}

# transformers: the rewind gate's verdicts, one per outcome, so the two orchestrators above and
# below say which verdict they give, never how its words are spliced. each prints one line.
as_rewind_stdin_broke_verdict() {
  echo "not rewound: the carried keys could not be read from stdin, so none were carried — $FIX_STDIN_REREAD"
}
as_rewind_budget_unread_verdict() {
  local cause="$1" field_rc="$2" route="$3"
  echo "not rewound: could not read the budget: $(as_unclassed_cause "$cause") — $(as_scope_record_fix "$field_rc" "$route" budget)"
}
as_rewind_budget_invalid_verdict() {
  local allowance="$1" route="$2"
  echo "not rewound: the scope record's budget is no positive integer: '$allowance' — fix: set '- budget: <n>' in $route/0.scope.md"
}
as_not_rewound_verdict() {
  echo "not rewound: $(as_unclassed_cause "$1")"
}
as_rewind_broke_verdict() {
  echo "not rewound: $1"
}
as_verdict_then_release_broke() {
  local verdict="$1" cause="$2"
  echo "$verdict; then $(as_unclassed_cause "$cause")"
}
as_cycle_record_unread_verdict() {
  echo "not rewound: could not read the cycle record $1"
}
as_already_rewound_carry_lost_verdict() {
  echo "already rewound, but $(as_unclassed_cause "$1")"
}
as_already_rewound_verdict() {
  local cycle="$1" allowance="$2" record="$3"
  echo "already rewound 2.detect after cycle $cycle of $allowance — naught re-dispatched; carried keys held in $record"
}
as_resume_field_unread_verdict() {
  local field="$1" cause="$2"
  echo "not rewound: budget spent, and the resume could not read the $field: $(as_unclassed_cause "$cause")"
}
as_rewound_marker_lost_verdict() {
  local record="$1" cause="$2"
  echo "rewound, but the rewound marker could not be written to $record: $(as_unclassed_cause "${cause:-the append broke}") — a retry would rewind again"
}
as_rewound_carry_lost_verdict() {
  echo "rewound (marker held, a retry converges), but $(as_unclassed_cause "$1")"
}
as_rewound_verdict() {
  local cycle="$1" allowance="$2" record="$3"
  echo "rewound 2.detect after cycle $cycle of $allowance — carried keys held in $record"
}

# transformer: the lock that serializes rewind-detect on one route. it stands outside .claims/,
# which a rewind may archive, so the lock outlives the act it guards.
as_rewind_lock() {
  printf '%s/.rewind-detect.lock' "$1"
}

# orchestrator (runs under the rewind lock): the marker check, the order and budget guards, the
# rewind, and the marker write. args = route, cycle, allowance, keys; stdout and return = as
# set_detect_rewound_with_cycle_carry.
set_detect_rewound_once() {
  local route="$1" cycle="$2" allowance="$3" keys="$4"
  local record="$route/.claims/0.cycle.md" walked cause rewound_rc=0
  has_cycle_line "$record" "$cycle" "$CYCLE_REWOUND_LINE" || rewound_rc=$?
  is_cycle_read_broke "$rewound_rc" && { as_cycle_record_unread_verdict "$record"; return 1; }
  if is_cycle_entry_held "$rewound_rc"; then
    cause="$(set_cycle_carry_confirmed "$route" "$cycle" "$allowance" "$keys" after)" \
      || { as_already_rewound_carry_lost_verdict "$cause"; return 1; }
    as_already_rewound_verdict "$cycle" "$allowance" "$record"
    return 0
  fi
  walked="$(get_cycle_count "$record")" \
    || { as_cycle_record_unread_verdict "$record"; return 1; }
  if ! is_cycle_in_order "$cycle" "$walked"; then
    as_cycle_order_verdict "$cycle" "$walked"
    return 2
  fi
  if is_budget_spent "$cycle" "$allowance"; then
    # the resume names the route's own scope + grain, so it runs as printed
    local scope grain
    scope="$(get_route_scope_field "$route" scope)" \
      || { as_resume_field_unread_verdict scope "$scope"; return 1; }
    grain="$(get_route_scope_field "$route" grain)" \
      || { as_resume_field_unread_verdict grain "$grain"; return 1; }
    as_budget_spent_verdict "$cycle" "$allowance" "$scope" "$grain" "$route"
    return 2
  fi
  cause="$(set_cycle_carry_confirmed "$route" "$cycle" "$allowance" "$keys" before)" \
    || { as_not_rewound_verdict "$cause"; return 1; }
  cause="$(set_detect_rewound "$route")" \
    || { as_rewind_broke_verdict "$cause"; return 1; }
  cause="$(set_cycle_rewound "$route" "$cycle" "$allowance" "$keys")" \
    || { as_rewound_marker_lost_verdict "$record" "$cause"; return 1; }
  cause="$(set_cycle_carry_confirmed "$route" "$cycle" "$allowance" "$keys" after)" \
    || { as_rewound_carry_lost_verdict "$cause"; return 1; }
  as_rewound_verdict "$cycle" "$allowance" "$record"
}

# guard: may cycle N carry now, given the record holds `walked` blocks? a retry re-carries the
# last block (N == walked); a fresh loop opens the next (N == walked + 1). any other N would
# skip or rewrite the record the budget cap counts on.
is_cycle_in_order() {
  local cycle="$1" walked="$2"
  [[ "$cycle" =~ ^[1-9][0-9]*$ ]] || return 1
  (( cycle == walked || cycle == walked + 1 ))
}

# transformer: the verdict for an out-of-order cycle — what the record holds, then the cycles
# it allows. $1 = the cycle passed, $2 = the blocks the record holds.
as_cycle_order_verdict() {
  local cycle="$1" walked="$2"
  echo "not rewound: cycle $cycle is out of order — the record holds $(as_count_label "$walked" cycle); $(as_cycle_order_fix "$walked")"
}

# transformer: the verdict for a spent budget — terminate, and the resume command that runs as
# printed. $1 = the cycle, $2 = the allowance, $3 = the scope, $4 = the grain, $5 = the route.
as_budget_spent_verdict() {
  local cycle="$1" allowance="$2" scope="$3" grain="$4" route="$5"
  echo "not rewound: budget spent — cycle $cycle of $allowance; terminate, and escalate \"add budget\" only if a critical claim stays open — the resume: rhx $SKILL_NAME --scope $scope --grain $grain --mode apply --budget <more than $allowance>, then this same rewind-detect --route $route --cycle $cycle"
}

# transformer: the fix for an out-of-order cycle — the cycle numbers is_cycle_in_order allows.
# an empty record allows only cycle 1; a record of N blocks allows N (a retry) or N + 1.
as_cycle_order_fix() {
  local walked="$1"
  (( walked == 0 )) && { printf 'pass 1'; return 0; }
  printf 'pass %s (a retry) or %s' "$walked" "$(( walked + 1 ))"
}

# the named verdicts of get_bound_route's return code (0 = a redteam route or none bound)
BOUND_PROBE_MALFUNCTION=1
BOUND_PROBE_FOREIGN=2

# orchestrator (the rhx probe, then two extractors, then a verdict): probe the route the
# platform has bound.
# stdout = the bound guardian-redteam route path, or empty when no route is bound.
# return BOUND_PROBE_MALFUNCTION (stdout = the cause) when the probe itself breaks — a
# genuine tool break is never quietly turned into a "no route bound" verdict, and the halt
# that reads it names which tool broke: rhx, or the read of its answer.
# return BOUND_PROBE_FOREIGN (stdout = the foreign path) when a route of another kind is bound:
# a scaffold-and-bind here could clobber that in-flight bind, so the caller must halt as a
# constraint, never read it as "none bound" (rule.forbid.failhide).
get_bound_route() {
  local probed redteam any
  probed="$(get_route_bind_via_rhx)" \
    || { print_malfunction_cause 'rhx route.bind.get failed: %s' "$(as_shell_cause "$(as_oneline "$probed")")"; return "$BOUND_PROBE_MALFUNCTION"; }
  redteam="$(printf '%s\n' "$probed" | extract_redteam_route_path 2>&1)" \
    || { as_qualified_cause "$(as_oneline "$redteam")"; return "$BOUND_PROBE_MALFUNCTION"; }
  any="$(printf '%s\n' "$probed" | extract_any_route_path 2>&1)" \
    || { as_qualified_cause "$(as_oneline "$any")"; return "$BOUND_PROBE_MALFUNCTION"; }
  is_foreign_bind "$redteam" "$any" && { printf '%s\n' "$any"; return "$BOUND_PROBE_FOREIGN"; }
  printf '%s\n' "$redteam"
}

# guard: is the bound route of another kind — a route bound, and none of it a redteam route?
# $1 = the redteam route the bind names (empty if none), $2 = any route it names.
is_foreign_bind() {
  [[ -z "$1" && -n "$2" ]]
}

# guard: does a bind probe's verdict say it read clean (a redteam route, or none, bound)?
# $1 = get_bound_route's rc.
is_bound_probe_clean() {
  (( $1 == 0 ))
}

# guard: does a bind probe's verdict say a route of another kind is bound?
is_bound_probe_foreign() {
  (( $1 == BOUND_PROBE_FOREIGN ))
}

# guard: is a foreign bind moot here — the probe found one, and this scaffold skips the bind
# (so it leaves the foreign bind alone)? $1 = get_bound_route's rc, $2 = the skip-bind flag.
is_foreign_bind_moot() {
  is_bound_probe_foreign "$1" && [[ "$2" == "1" ]]
}

# orchestrator: probe the bound route for a scaffold that may or may not bind.
# $1 = "1" when the scaffold skips the bind. under a skipped bind, a foreign bind is left
# alone, never clobbered — so it reads as "none bound" here, and only here.
# stdout + return = as get_bound_route.
get_bound_route_for_scaffold() {
  local skip_bind="$1" bound rc=0
  bound="$(get_bound_route)" || rc=$?
  is_foreign_bind_moot "$rc" "$skip_bind" && return 0
  printf '%s' "$bound"
  return "$rc"
}

# orchestrator (re-probes the bind): the handoff note for an unbound scaffold — the foreign
# route a skipped bind left alone, since the next step (a bind) would replace it; empty when no
# foreign route is bound. a probe break is named, never folded into "none".
get_foreign_bind_note() {
  local bound rc=0
  bound="$(get_bound_route)" || rc=$?
  is_bound_probe_clean "$rc" && return 0
  is_bound_probe_foreign "$rc" && { as_foreign_bind_left_alone_note "$bound"; return 0; }
  as_foreign_bind_unread_note "$bound"
}

# transformer: the note for a foreign route a skipped bind left alone. $1 = the foreign route.
as_foreign_bind_left_alone_note() {
  printf '⚠️ left the bind alone: %s is bound to this branch — a bind here replaces it, so finish or unbind it (rhx route.bind.del) first' "$1"
}

# transformer: the note for a bind probe that broke. $1 = the probe's cause.
as_foreign_bind_unread_note() {
  printf '⚠️ could not re-read the branch bind, so a foreign route may stand: %s — check rhx route.bind.get before you bind, so a bind never replaces a route you meant to keep' "$(as_oneline "$1")"
}

# orchestrator: set REPO_ROOT, or close the run — belay (exit 2) outside a repo, halt (exit 1)
# when git itself breaks. the one anchor every entry point runs, so the parent skill, its gates,
# and init.sh never drift apart. called in the entry point's own shell, so its exit ends the run.
# $1 = the command header.
exit_unless_repo_root() {
  local command="$1" probe_rc=0 probe_said
  probe_said="$(get_git_repo_probe)" || probe_rc=$?
  is_git_probe_not_a_repo "$probe_rc" && {
    print_belay "not in a git repository" "$command" "$SEVERITY_CONSTRAINT" "fix: run this from within a repo"
    exit 2
  }
  is_git_probe_broke "$probe_rc" && {
    print_belay "git malfunctioned while it probed the repo" "$command" "$SEVERITY_MALFUNCTION" \
      "cause: $(as_qualified_cause "$probe_said")" "$FIX_GIT_RETRY"
    exit 1
  }
  REPO_ROOT="$(get_repo_root)" || {
    print_belay "git malfunctioned while it read the repo root" "$command" "$SEVERITY_MALFUNCTION" \
      "cause: $(as_qualified_cause "$REPO_ROOT")" "$FIX_GIT_RETRY"
    exit 1
  }
}

# orchestrator: close the run on a bound-route probe verdict other than "a redteam route or
# none": a foreign bind belays (exit 2, its path named), a probe break halts (exit 1, its cause
# named). called in the entry point's own shell, so its exit ends the run; rc 0 returns.
# $1 = the command header, $2 = the probe rc, $3 = the probe stdout, $4 = the halt message,
# then items the halt shows above its cause.
exit_on_bound_probe_verdict() {
  local command="$1" rc="$2" said="$3" message="$4"
  is_bound_probe_clean "$rc" && return 0
  is_bound_probe_foreign "$rc" && { print_foreign_bind_belay "$command" "$said"; exit 2; }
  print_belay "$message" "$command" "$SEVERITY_MALFUNCTION" "${@:5}" "cause: $said" "$FIX_BIND_PROBE"
  exit 1
}

# transformer: a route's absent required files as one halt item — a labeled bucket, one file
# per child — so every completeness halt renders the list the same way.
as_absent_files_item() {
  as_tree_item_with_children "absent required files" "   │  " "$1"
}

# orchestrator: halt (exit 1) when a route lacks any required file, the files listed as one
# bucket; rc 0 returns. called in the entry point's own shell, so its exit ends the run.
# $1 = the command header, $2 = the route, $3 = the state line, $4 = the fix item.
exit_on_route_partial() {
  local command="$1" route="$2" state="$3" fix="$4" absent
  absent="$(get_route_absent_files "$route")"
  [[ -z "$absent" ]] && return 0
  print_belay "a partial route cannot be driven to terminal" "$command" "$SEVERITY_MALFUNCTION" \
    "$state" "$(as_absent_files_item "$absent")" "$fix"
  exit 1
}

# print the belay for a foreign bind: a route of another kind is bound to this branch, so
# a scaffold-and-bind could clobber it. $1 = the command header, $2 = the foreign route.
print_foreign_bind_belay() {
  local command="$1" foreign="$2"
  print_belay "a redteam bind here could clobber that route" "$command" "$SEVERITY_CONSTRAINT" \
    "a different route is bound to this branch: $foreign" \
    "$(as_tree_item_with_children "fix: one of" "   │  " \
      "$(as_child_lines "finish or unbind it first (rhx route.bind.del)" "scaffold without a bind: add --skip-route-bind")")"
}

# communicator: read the current git branch (a label for the bind render).
# stdout = the branch name; return 1 (stdout = git's message) on a git break, so the caller
# surfaces it as a malfunction rather than render "bound to branch <error text>".
# .note = symbolic-ref names the branch even before its first commit (an unborn HEAD, where
#   rev-parse exits 128); rev-parse answers only for a detached HEAD, which has no symbolic ref.
get_current_branch() {
  local branch
  branch="$(git symbolic-ref --quiet --short HEAD 2>/dev/null)" && { printf '%s' "$branch"; return 0; }
  branch="$(git rev-parse --abbrev-ref HEAD 2>&1)" || { printf '%s' "$(as_oneline "$branch")"; return 1; }
  printf '%s' "$branch"
}

# guard: does a branch read name a detached HEAD (no branch checked out)?
is_branch_detached() {
  [[ "$1" == "HEAD" ]]
}

# the named verdict of get_ref_commit: the ref (or HEAD) names no commit
REF_ABSENT=2

# communicator: the commit a ref names. $1 = a full ref (refs/heads/…) or HEAD.
# stdout = the commit; return REF_ABSENT when it names none (an absent ref, an unborn HEAD);
# return 1 (stdout = git's cause) on a git break.
get_ref_commit() {
  local said rc=0
  said="$(git rev-parse --verify --quiet "$1^{commit}" 2>&1)" || rc=$?
  (( rc == 0 )) && { printf '%s' "$said"; return 0; }
  (( rc == 1 )) && return "$REF_ABSENT"
  printf '%s' "$(as_oneline "$said")"
  return 1
}

# communicator: the tree's uncommitted paths outside this skill's own route dirs (the records the
# drive writes as it walks), porcelain form; empty when clean. another route's dir under .behavior/
# is a human's work, so it counts. return 1 (stdout = git's cause) on a git break.
get_tree_uncommitted() {
  local said
  said="$(git status --porcelain --untracked-files=all -- . ":(exclude,glob).behavior/*${ROUTE_KIND}*/**" 2>&1)" || { printf '%s' "$(as_oneline "$said")"; return 1; }
  printf '%s' "$said"
}

# the namespace of every backup ref. it sits outside refs/heads/ and refs/tags/, so `git branch`
# never lists a backup and `git push --all` / `--tags` never publish the value it still carries
BACKUP_REF_PREFIX="refs/redteam-backup"

# transformer: the backup ref for a branch at a commit. the commit is in the name, so a re-run at
# one HEAD finds its own backup, and a later rewrite never moves an earlier backup.
as_backup_ref() {
  local branch="$1" commit="$2"
  printf '%s/%s.%s' "$BACKUP_REF_PREFIX" "$branch" "${commit:0:12}"
}

# transformer: a count of uncommitted paths, for the refusal's item. $1 = porcelain lines.
as_uncommitted_item() {
  local -a lines
  mapfile -t lines <<< "$1"
  printf 'uncommitted outside the redteam route: %s path(s), first: %s' "${#lines[@]}" "${lines[0]}"
}

# communicator: create a ref at a commit, create-only (the empty old value refuses an extant ref).
# stdout = git's cause on failure (return 1).
set_backup_ref() {
  local ref="$1" commit="$2" said
  said="$(git update-ref "$ref" "$commit" "" 2>&1)" || { printf '%s' "$(as_oneline "$said")"; return 1; }
}

# orchestrator (the record render, then the atomic write): write the sweep-parameters record a
# brain reads to walk the route. peers + budget are persisted here (never dropped) — the ground
# stone reads `peers` to size its partition, and the promote stone reads `budget` as the loop's
# spend allowance. an upsert: a re-run overwrites the record whole, via set_file_atomically, so a
# live drive never reads a torn record. stdout = the cause on failure (return 1).
set_scope_record() {
  local route="$1" scope="$2" grain="$3" peers="$4" budget="$5" said
  said="$( { as_scope_record "$scope" "$grain" "$peers" "$budget" | set_file_atomically "$route/0.scope.md"; } 2>&1)" \
    || { printf '%s' "$(as_oneline "$said")"; return 1; }
}

# communicator: write stdin to a file whole — into a draft beside it suffixed with the writer's
# own pid ($BASHPID, distinct per subshell, where $$ is shared by every subshell), then a rename
# over it — so a concurrent reader sees the old body or the new, never a torn one. a failed
# write removes its draft, and a removal that breaks too is named, so a leftover draft is always
# explained. stdout = the cause on failure (return 1). $1 = the file.
set_file_atomically() {
  local path="$1" draft="$1.draft.$BASHPID" said cleanup
  said="$( { cat > "$draft" && mv -f -- "$draft" "$path"; } 2>&1)" && return 0
  said="$(as_shell_cause "$(as_oneline "$said")")"
  cleanup="$(LC_ALL=C rm -f -- "$draft" 2>&1)" \
    || { printf '%s; could not remove the draft %s: %s' "$said" "$draft" "$(as_shell_cause "$(as_oneline "$cleanup")")"; return 1; }
  printf '%s' "$said"
  return 1
}

# transformer: the 0.scope.md body for a sweep's parameters.
as_scope_record() {
  local scope="$1" grain="$2" peers="$3" budget="$4"
  cat <<EOF
# 0.scope — the sweep parameters

- scope: $scope
- grain: $grain
- peers: $peers
- budget: $budget

the ward loop reads this habitat through three grains:
- infil  — inbound channels (ways in)
- exfil  — outbound channels (ways out, every exit)
- leak   — exposed values (already out)

- peers  — blind peers per grain-partition (the ground stone sizes its slices by this)
- budget — the loop's spend allowance (the promote stone draws it down per cycle)

claims live in \`.claims/\` (gitignored). live claims never publish — the
dispatch tool is itself an exfil channel. only fullsun-safe lessons (a
generalized class, never a live claim) leave via the promote stone.
EOF
}

# orchestrator: bind the route to the current branch, then read the bind back.
# stdout = "bound to branch <b>" on success, or "not bound: <cause> — retry: ..."
# on failure; return 1 on failure so the caller can set its exit code honestly.
# .why the read-back = the probe→bind window is check-then-act: two concurrent inits on one
#   branch both see "none bound", both bind, and the loser would report success while a later
#   route.drive drives the other route. the read-back turns that silent loser into a loud one.
set_route_bind() {
  local route="$1" branch="$2"
  local bind_out said readback
  bind_out="$(set_route_bind_via_rhx "$route")" \
    || { as_bind_refused_cause "$route" "$bind_out"; return 1; }
  said="$(get_route_bind_via_rhx)" \
    || { as_readback_failed_cause "$said"; return 1; }
  readback="$(get_route_from_bind_readback "$said")" \
    || { as_readback_unparseable_cause "$readback"; return 1; }
  [[ -z "$readback" ]] \
    && { as_bind_not_persisted_cause "$route"; return 1; }
  is_same_route_path "$readback" "$route" \
    || { as_concurrent_bind_won_cause "$route" "$readback"; return 1; }
  as_bound_state "$branch"
}

# transformer: rhx refused the bind. $1 = the route, $2 = rhx's output.
as_bind_refused_cause() {
  as_not_bound_cause "$(as_oneline "$2")" "retry: rhx route.bind.set --route $1"
}

# transformer: the bind read-back broke. $1 = rhx's output.
as_readback_failed_cause() {
  as_not_bound_cause "read-back failed: $(as_oneline "$1")" "check: rhx route.bind.get"
}

# transformer: the bind read-back named no parseable route. $1 = the extractor's cause.
as_readback_unparseable_cause() {
  as_not_bound_cause "read-back unparseable: $(as_oneline "$1")" "check: rhx route.bind.get"
}

# transformer: the bind reads back as no route at all. $1 = the route.
as_bind_not_persisted_cause() {
  as_not_bound_cause "the bind did not persist (the branch reads back bound to no route)" "retry: rhx route.bind.set --route $1"
}

# transformer: another bind won the race. $1 = this route, $2 = the route the branch reads back.
as_concurrent_bind_won_cause() {
  as_not_bound_cause "the branch reads back bound to $2 (a concurrent bind won)" "this route stands orphaned at $1: remove it, or drive the winner — check: rhx route.bind.get"
}

# transformer: the bind state line for a bound route. $1 = the branch.
as_bound_state() {
  printf '%s' "bound to branch $1"
}

# communicator: bind a route to this branch via rhx. stdout = rhx's combined output.
set_route_bind_via_rhx() {
  rhx route.bind.set --route "$1" 2>&1
}

# communicator: read this branch's bind via rhx. stdout = rhx's combined output.
get_route_bind_via_rhx() {
  rhx route.bind.get 2>&1
}

# orchestrator (the extractor, then its cause or the raw path): the route a bind read-back names,
# as written; empty when it names none (is_same_route_path normalizes at the compare). return 1
# (stdout = the extractor's cause) when the parse breaks.
get_route_from_bind_readback() {
  local said="$1" route
  route="$(printf '%s\n' "$said" | extract_any_route_path 2>&1)" || { printf '%s' "$route"; return 1; }
  printf '%s' "$route"
}

# guard: do two route paths name one route, once normalized?
is_same_route_path() {
  [[ "$(as_normalized_route_path "$1")" == "$(as_normalized_route_path "$2")" ]]
}

# transformer: a "not bound" cause — the qualified class, what failed, then its remedy, one line.
as_not_bound_cause() {
  local what="$1" remedy="$2"
  printf '%s: not bound: %s — %s' "$(as_error_class "$SEVERITY_MALFUNCTION")" "$what" "$remedy"
}

# orchestrator: bind a route to the current branch. stdout + return = as set_route_bind;
# a git break on the branch read is a "not bound" cause too, never a bind to "<error text>".
bind_route_to_branch() {
  local route="$1" branch
  branch="$(get_current_branch)" \
    || { as_branch_read_broke_cause "$branch"; return 1; }
  set_route_bind "$route" "$branch"
}

# transformer: git could not name the current branch. $1 = git's cause.
as_branch_read_broke_cause() {
  as_not_bound_cause "could not read the current branch: $1" "$REMEDY_GIT_RETRY"
}

# orchestrator: bind a fresh route unless the scaffold skips the bind. stdout = the bind
# state for the render; return = as bind_route_to_branch (0 on a skip).
set_route_bind_unless_skipped() {
  local route="$1" skip_bind="$2"
  [[ "$skip_bind" == "1" ]] && { printf 'skipped (--skip-route-bind)'; return 0; }
  bind_route_to_branch "$route"
}

# communicator: shell out to the route-scaffold boundary (init.sh), capture its
# combined output, and propagate its exit code. the one raw sub-process boundary in
# the apply flow, named so the orchestrator reads as "scaffold the route, check the
# result" (rule.prefer.decomposable-architecture).
scaffold_route() {
  local init_sh="$1"
  shift
  bash "$init_sh" "$@" 2>&1
}

# transformer: the total blind-peer count across every grain-partition.
# the first link of the peers → total → projected arithmetic chain, behind a name
# so the whole pipeline has one source (rule.require.named-transformers).
compute_peer_total() {
  local peers="$1" grains="$2"
  printf '%s' "$(( peers * grains ))"
}

# transformer: the projected upper-bound spend of a sweep (deterministic).
# peer-total × budget-cycles = the worst-case peer-dispatch count.
compute_projected_cost() {
  local peer_total="$1" budget="$2"
  printf '%s' "$(( peer_total * budget ))"
}

# communicator (reads the route dir): one line per scaffolded stone — `<stone>.stone / .guard`
# when its guard stands beside it, else `<stone>.stone`.
get_route_stone_lines() {
  local route="$1" file base
  for file in "$route"/*.stone; do
    [[ -f "$file" ]] || continue
    base="$(basename "$file" .stone)"
    [[ -f "$route/$base.guard" ]] && { printf '%s.stone / .guard\n' "$base"; continue; }
    printf '%s.stone\n' "$base"
  done
}

# print the scaffolded stone list, derived from the route dir so the render can never drift
# from what actually landed (the wish's "state at read time" hazard).
print_route_stones() {
  local route="$1" prefix="${2-      }"
  as_tree_children "$prefix" "$(get_route_stone_lines "$route")"
  echo
}

# guard (a dir test, then has_route_stones): confirm a bound route is actually driveable on disk — its dir exists and
# holds at least one .stone. get_bound_route returns a persisted bind string that can
# outlive the route dir (a deleted dir, a changed checkout), so a clean "drive it" handoff
# over an absent route would promise a drive with no route to walk (rule.forbid.failhide).
# return 0 when driveable, 1 when the dir or its stones are absent.
is_route_on_disk() {
  local route="$1"
  [[ -d "$route" ]] && has_route_stones "$route"
}

# communicator (probes the route dir): does a route dir hold at least one .stone? return 0 yes, 1 no.
has_route_stones() {
  local file
  for file in "$1"/*.stone; do
    [[ -f "$file" ]] && return 0
  done
  return 1
}

# transformer: the value of a `- <field>: <value>` record line (the label dropped).
as_scope_field_value() {
  local line="$1" field="$2"
  printf '%s' "${line#- ${field}: }"
}

# the named verdicts of get_route_scope_field's return code (0 = the value read). each asks for
# its own remedy: an absent record cannot be driven, a lacked field is a one-line edit, and a
# read break is a retry.
SCOPE_RECORD_ABSENT=1
SCOPE_FIELD_ABSENT=2
SCOPE_READ_BROKE=3

# guard: does a scope-record read's verdict say the value read? $1 = get_route_scope_field's rc.
is_scope_field_read() {
  (( $1 == 0 ))
}

# communicator: read one "- <field>: <value>" line from a route's 0.scope.md.
# stdout = the value; on a fault, stdout = the cause and the return names which fault
# (SCOPE_RECORD_ABSENT, SCOPE_FIELD_ABSENT, SCOPE_READ_BROKE) — never one bare status.
get_route_scope_field() {
  local route="$1" field="$2"
  local scope_file="$route/0.scope.md" line rc=0
  [[ -f "$scope_file" ]] || { print_malfunction_cause 'no scope record at %s' "$scope_file"; return "$SCOPE_RECORD_ABSENT"; }
  line="$(grep -m1 "^- ${field}: " "$scope_file" 2>&1)" || rc=$?
  (( rc == 1 )) && { print_malfunction_cause 'the scope record %s lacks its %s field' "$scope_file" "$field"; return "$SCOPE_FIELD_ABSENT"; }
  (( rc >= 2 )) && { print_malfunction_cause 'grep broke (rc=%s) on %s: %s' "$rc" "$scope_file" "$(as_oneline "$line")"; return "$SCOPE_READ_BROKE"; }
  as_scope_field_value "$line" "$field"
}

# transformer: the remedy for a scope-record read fault — a retry for a tool break, an in-place
# edit for a lacked field, and an in-place rewrite for a record gone from a route that stands
# (every caller confirms the route dir and its stones first, so its .claims/ stay kept).
# $1 = get_route_scope_field's return, $2 = the route, $3 = the field.
as_scope_record_fix() {
  local rc="$1" route="$2" field="$3"
  (( rc == SCOPE_READ_BROKE )) && { printf '%s' "$FIX_TOOL_RETRY"; return 0; }
  (( rc == SCOPE_FIELD_ABSENT )) && { printf "fix: set '- %s: <value>' in %s/0.scope.md, then re-run" "$field" "$route"; return 0; }
  printf "fix: write %s/0.scope.md back with its '- scope:', '- grain:', '- peers:', '- budget:' lines (the route's .claims/ stay kept), then re-run" "$route"
}

# the named verdict of get_route_promote_decision's return code (0 = a decision read, or none
# recorded). a read break never reads as "no decision".
PROMOTE_READ_BROKE=1

# guard: does a promote-decision read's verdict say the read broke?
is_promote_read_broke() {
  (( $1 == PROMOTE_READ_BROKE ))
}

# communicator (reads the promote yield): the terminal decision the route's last promote wrote
# (`- decision: <value>` in .claims/5.promote.yield.md), or naught when no promote has decided.
# on a read break, stdout = the cause and the return is PROMOTE_READ_BROKE.
get_route_promote_decision() {
  local yield="$1/.claims/5.promote.yield.md" line rc=0
  [[ -e "$yield" ]] || return 0
  line="$(grep -m1 '^- decision: ' -- "$yield" 2>&1)" || rc=$?
  (( rc == 1 )) && return 0
  (( rc >= 2 )) && { print_malfunction_cause 'grep broke (rc=%s) on %s: %s' "$rc" "$yield" "$(as_oneline "$line")"; return "$PROMOTE_READ_BROKE"; }
  as_scope_field_value "$line" decision
}

# guard: does a promote decision end the sweep (terminate, or terminate + escalate)?
is_sweep_finished() {
  [[ "$1" == terminate* ]]
}

# the named verdict of get_route_reopen_verdict's return code: the loop's last cycle carries no
# rewound marker, so the promote's terminate still stands
ROUTE_NOT_REOPENED=2

# guard: does a reopen probe's verdict say a rewind reopened the loop since its promote ended it?
is_route_reopened() {
  (( $1 == 0 ))
}

# orchestrator (counts the cycles, then probes the last block): has a rewind reopened the loop
# since its promote ended it? the promote yield keeps its terminate line until the next promote
# rewrites it, so a reopened loop reads as ended unless the last cycle's rewound marker is read.
# return 0 reopened; ROUTE_NOT_REOPENED when no record or no marker; PROMOTE_READ_BROKE (stdout =
# the cause) on a read break.
get_route_reopen_verdict() {
  local record="$1/.claims/0.cycle.md" count said line_rc=0
  [[ -e "$record" ]] || return "$ROUTE_NOT_REOPENED"
  count="$(get_cycle_count "$record" 2>&1)" || { printf '%s' "$(as_oneline "$count")"; return "$PROMOTE_READ_BROKE"; }
  said="$(has_cycle_line "$record" "$count" "$CYCLE_REWOUND_LINE" 2>&1)" || line_rc=$?
  is_cycle_read_broke "$line_rc" \
    && { print_malfunction_cause 'could not read the rewound marker of cycle %s in %s: %s' "$count" "$record" "$(as_oneline "$said")"; return "$PROMOTE_READ_BROKE"; }
  is_cycle_entry_absent "$line_rc" && return "$ROUTE_NOT_REOPENED"
  return 0
}

# guard: does the request raise the bound route's budget? only a raise reopens a finished sweep.
is_budget_raised() {
  local budget="$1" have_budget="$2"
  (( budget > have_budget ))
}

# transformer: the belay header for a bound route whose promote already ended the sweep.
as_sweep_finished_verdict() {
  printf "this route's sweep already ended (its promote decided: %s) — a re-run adopts naught, and a drive walks naught" "$1"
}

# guard: did a promote end the sweep held on a human (a rotate, a private route, a handed rewrite)?
is_decision_held_on_human() {
  [[ "$1" == *"escalate the human act"* ]]
}

# transformer: the ways out of a finished sweep. a sweep held on a human names the human acts, since
# no budget or rewind closes a held claim; any other names a fresh sweep, or a reopen of this one.
# $1 = the promote decision, $2 = the recorded budget.
as_sweep_finished_fix() {
  local decision="$1" have_budget="$2"
  is_decision_held_on_human "$decision" && {
    printf 'fix: no budget or rewind closes a claim held on a human — first run each act under `human acts owed` in .claims/5.promote.yield.md (record each rotate output in .claims/rotate.proofs.md); then reopen this sweep: re-run with --budget above %s, then run the rewind-detect its verdict names, so verify can close them' "$have_budget"
    return 0
  }
  printf 'fix: to sweep fresh, unbind (rhx route.bind.del), remove the route dir, and re-run (the .claims/ it holds are lost); to reopen this sweep, re-run with --budget above %s, then run the rewind-detect its verdict names' "$have_budget"
}

# transformer: the handoff note for a finished sweep a raised budget reopens.
as_sweep_reopen_note() {
  printf "⚠️ this sweep's promote decided: %s — a drive alone walks naught; first reopen the loop with the rewind-detect its verdict names (.claims/5.promote.yield.md), then drive" "$1"
}

# guard: is a bound route the sweep this request names — the same scope and grain?
# .why = scope + grain name which surface the sweep reads; a drive of a route made for
#   another surface is a silent wrong sweep. peers + budget are how hard the loop drives,
#   so a match adopts the request's values (set_scope_record) rather than refuse it.
is_sweep_match() {
  local have_scope="$1" have_grain="$2" want_scope="$3" want_grain="$4"
  [[ "$have_scope" == "$want_scope" && "$have_grain" == "$want_grain" ]]
}

# print the belay for a bound route made for another surface. $1 = the command header,
# $2/$3 = the bound route's scope/grain, $4/$5 = the requested scope/grain — each read once,
# by the caller, so the render reads naught and cannot fail mid-tree.
print_sweep_mismatch_belay() {
  local command="$1" have_scope="$2" have_grain="$3" want_scope="$4" want_grain="$5"
  print_belay "requested sweep does not match the bound route" "$command" "$SEVERITY_CONSTRAINT" \
    "$(as_tree_item_with_children "the bound route was scaffolded for a different surface:" "   │  " \
      "$(as_child_lines "bound:     scope=$have_scope grain=$have_grain" "requested: scope=$want_scope grain=$want_grain")")" \
    "$(as_tree_item_with_children "fix: one of" "   │  " \
      "$(as_child_lines "re-run with the bound route's scope + grain" "unbind (rhx route.bind.del), then init a fresh route for this request")")"
}

# communicator: copy every .stone + .guard template into the route dir.
# stdout = the count copied (so the caller can failfast on an empty install), or the cp
# cause on a failed copy (return 1) — never a mute abort under set -e.
copy_route_templates() {
  local templates_dir="$1" route_path="$2"
  local copied=0 file said
  for file in "$templates_dir"/*.stone "$templates_dir"/*.guard; do
    [[ -f "$file" ]] || continue
    said="$(cp -f "$file" "$route_path/" 2>&1)" || { print_malfunction_cause 'copy failed: %s' "$(as_oneline "$said")"; return 1; }
    copied=$(( copied + 1 ))
  done
  printf '%s' "$copied"
}

# the named verdict of gen_route_dir_exclusive's return code (0 = created; 1 = the create broke)
ROUTE_DIR_EXTANT=2

# communicator: create a route dir exclusively. `mkdir` without -p both creates the leaf and
# is the clobber guard in one syscall, so two concurrent inits cannot both pass a
# check-then-act `-d` test. return 0 created; ROUTE_DIR_EXTANT when it already stands (a
# clobber refusal); 1 (stdout = the cause) when the create broke.
gen_route_dir_exclusive() {
  local route="$1" said
  said="$(mkdir -p "$(dirname "$route")" 2>&1)" || { printf '%s' "$(as_oneline "$said")"; return 1; }
  said="$(LC_ALL=C mkdir "$route" 2>&1)" && return 0
  is_dir_extant_refusal "$said" "$route" && return "$ROUTE_DIR_EXTANT"
  printf '%s' "$(as_oneline "$said")"
  return 1
}

# guard: is a path one route dir directly under `.behavior/` — a single segment, never `.` or
# `..`? a prefix test alone would pass `.behavior/..`, which names the repo root.
is_route_dir_path() {
  local route="$1" leaf
  [[ "$route" =~ ^\.behavior/([^/]+)$ ]] || return 1
  leaf="${BASH_REMATCH[1]}"
  [[ "$leaf" != "." && "$leaf" != ".." ]]
}

# communicator: remove a route dir this run created, so a failed scaffold leaves no partial
# route to block the retry. refuses any path but one route dir under `.behavior/`, so a stray
# value can never aim the removal elsewhere. stdout = the cause on failure (return 1).
del_route_dir() {
  local route="$1" said
  is_route_dir_path "$route" || { print_malfunction_cause 'refused: %s is not a route under .behavior/' "${route:-<empty>}"; return 1; }
  said="$(rm -rf -- "$route" 2>&1)" || { printf '%s' "$(as_oneline "$said")"; return 1; }
  [[ -e "$route" ]] && { print_malfunction_cause '%s still stands after the removal' "$route"; return 1; }
  return 0
}

# communicator: stand up the route's gitignored claims path — the disposition gate's home.
# a live claim is a hazard about this habitat and must never publish (the dispatch tool is
# itself an exfil channel). the dir ignores all it holds except its own .gitignore. the
# ignore is a default, never a control — `git add -f` or `git commit --all` on a tracked file
# walks past it, and no gate in this skill blocks a commit. the one enforced guard is the
# dispatch-lesson scan, and it covers the radio push alone. stdout = the cause on failure (return 1).
set_claims_dir() {
  local claims="$1" said
  said="$(mkdir -p "$claims" 2>&1)" || { printf '%s' "$(as_oneline "$said")"; return 1; }
  said="$( { printf '%s\n' '*' '!.gitignore' > "$claims/.gitignore"; } 2>&1)" \
    || { printf '%s' "$(as_shell_cause "$(as_oneline "$said")")"; return 1; }
}

# the one source of the route's required stones — each stone needs a paired .guard.
# a single source so a completeness check cannot drift from the set the ward loop
# actually walks (ground → detect → verify → repair → promote).
REQUIRED_ROUTE_STONES=(1.ground 2.detect 3.verify 4.repair 5.promote)

# transformer: what one ward-loop stone does, for the apply handoff. keyed by the stone names
# in REQUIRED_ROUTE_STONES, so a stone that gains no purpose here renders as "(no purpose
# recorded)" — loud in the snapshot, never a silent gap.
as_stone_purpose() {
  case "$1" in
    1.ground)  printf 'map the focus-surface per grain' ;;
    2.detect)  printf 'dispatch blind peers, fan claims in (keyed channel+mechanism)' ;;
    3.verify)  printf 'confirm vs tree, classify, sort by permanence trigger' ;;
    4.repair)  printf 'gated, disposition-aware, PENDING-REDETECT until confirmed' ;;
    5.promote) printf 'teach the kin (fullsun-safe), then loop or terminate' ;;
    *)         printf '(no purpose recorded)' ;;
  esac
}

# transformer: one `<stone> — <purpose>` line per required stone, in walk order.
as_ward_loop_stone_lines() {
  local stone
  for stone in "${REQUIRED_ROUTE_STONES[@]}"; do
    printf '%-10s — %s\n' "$stone" "$(as_stone_purpose "$stone")"
  done
}

# communicator (probes the route dir): list the required route files absent from a scaffolded route dir,
# one per line (empty output = a complete scaffold). a partial copy — a bad glob, an
# unreadable or absent template, a damaged install that drops some-but-not-all files —
# leaves a gap here. the caller halts loud on a gap rather than hand a driver a route
# that lacks a stone/guard (a hidden-state hazard: a broken install reported as clean).
get_route_absent_files() {
  local route="$1" stone
  for stone in "${REQUIRED_ROUTE_STONES[@]}"; do
    [[ -f "$route/$stone.stone" ]] || printf '%s\n' "$stone.stone"
    [[ -f "$route/$stone.guard" ]] || printf '%s\n' "$stone.guard"
  done
}

# transformer: the prompt one grain's peers carry. the prompt text lives here (one place).
as_grain_prompt() {
  case "$1" in
    infil) printf 'infil — "what reaches in to this slice, from where, with what power?"' ;;
    exfil) printf 'exfil — "what leaves this slice, by what channel — net, DNS, log, webhook?"' ;;
    leak)  printf 'leak  — "what value on this slice is already exposed, or forms a map with others?"' ;;
    # a grain added to GRAIN_LIST with no prompt here renders loud, never as a dropped line
    *)     printf '(no prompt recorded for grain %s)' "$1" ;;
  esac
}

# transformer: one prompt line per active grain, then the claim shape every peer returns.
as_grain_prompt_lines() {
  local g
  for g in "$@"; do
    printf '%s\n' "$(as_grain_prompt "$g")"
  done
  printf '%s\n' "each claim = a chain (entry/exit → mechanism → blast radius|audience), keyed on channel+mechanism"
}

# print the per-grain prompts as the children of the plan's prompts item.
# $1 = the gutter prefix, then the active grains.
print_grain_prompts() {
  local gutter="$1"
  shift
  local -a grains=("$@")
  as_tree_children "$gutter" "$(as_grain_prompt_lines "${grains[@]}")"
  echo
}

# transformer: what a budget buys of the re-detect trust check, for the plan's pre-spend read.
# a repair is trusted only once the next cycle's detect confirms it, so the last cycle's
# repairs always stay PENDING-REDETECT, and a one-cycle budget re-detects none.
as_budget_reach() {
  (( $1 < 2 )) && { printf 'none — one pass; its repairs stay PENDING-REDETECT and cannot converge (pass --budget 2 or more to re-detect them)'; return 0; }
  (( $1 == 2 )) && { printf "cycle 2 re-detects cycle 1's repairs; cycle 2's repairs stay PENDING-REDETECT"; return 0; }
  printf "cycles 2 to %s re-detect the prior cycle's repairs; the last cycle's repairs stay PENDING-REDETECT" "$1"
}

# print the plan tree: the partition, the peer total, the projected spend, and the prompts.
# $1 = the command header, $2..$7 = scope, peers, budget, peer total, projected, grain
# label; $8 = the next step the plan closes on (empty when an apply follows at once); then the
# active grains. every input is explicit, so the plan renders for any sweep.
print_plan() {
  local command="$1" scope="$2" peers="$3" budget="$4" peer_total="$5" projected="$6" grain="$7" next="$8"
  # the named inputs are bound above; what remains on the argv is the active grains
  shift 8
  local -a grains=("$@")
  print_tree_start "$command --scope $scope --grain $grain --peers $peers --budget $budget"
  print_tree_branch "scope" "$scope"
  print_tree_branch "grains" "$(as_grain_list_text "${grains[@]}")  ($(as_count_label "${#grains[@]}" partition), disjoint by grain-surface)"
  print_tree_branch "peers" "$peers per grain-partition  ⇒ $peer_total blind peers total"
  print_tree_branch "budget" "$(as_count_label "$budget" "loop cycle") — each draws one detect → verify → repair pass"
  print_tree_branch "re-detect" "$(as_budget_reach "$budget")"
  print_tree_branch "projected" "$peer_total peers × $(as_count_label "$budget" cycle) = up to $projected peer-dispatch runs"
  print_tree_branch "a bound route" "apply keeps its recorded peers + budget for any flag this request omits; a new --peers is refused once 1.ground cuts the slices"
  print_tree_branch "the ward loop" "ground → detect → verify → repair → promote → (loop | terminate)"
  print_tree_branch "publishes" "$(as_publish_disclosure)"
  print_tree_branch "issuer acts" "$(as_issuer_act_disclosure)"
  print_tree_branch "rewrites" "$(as_history_rewrite_disclosure)"
  print_tree_branch "per-peer slices" "$peers per grain, cut by 1.ground at drive time into .claims/1.ground.yield.md — its guard grades them, and the drive goes on to 2.detect with no pause; this plan is your read before the spend"
  print_tree_branch "scope limit" "blind peers cannot see the aggregate map (a leak only the whole published set forms); a clean verdict does not clear it — review the whole corpus for that class apart"
  local prompts="per-grain prompts (each peer is blind to the others' slice + theory)"
  [[ -z "$next" ]] && { print_tree_item "$prompts" "$TREE_LAST"; print_grain_prompts "      " "${grains[@]}"; return 0; }
  print_tree_item "$prompts"
  print_grain_prompts "   │  " "${grains[@]}"
  print_tree_item "$next" "$TREE_LAST"
}

# transformer: the step a plan closes on — the apply that spends what the plan priced.
as_plan_next_step() {
  local scope="$1" grain="$2" peers="$3" budget="$4"
  printf 'next: spend it: rhx %s --scope %s --grain %s --peers %s --budget %s --mode apply' \
    "$SKILL_NAME" "$scope" "$grain" "$peers" "$budget"
}

# print each line of stdin under a gutter prefix (a nested bucket body). a blank line
# renders as the bare gutter, so the tree trunk never breaks mid-body.
# $1 = the gutter prefix (e.g. "   │  ").
print_nested_lines() {
  local prefix="$1"
  local line
  while IFS= read -r line; do
    [[ -z "$line" ]] && { as_trimmed_end "$prefix"; echo; continue; }
    echo "${prefix}${line}"
  done
}

# transformer: lines as tree branches under a gutter — `├─` each, `└─` the last.
# $1 = the gutter prefix, $2 = the lines (blank lines dropped). the one source of the
# last-branch markup.
as_tree_children() {
  local prefix="$1" line
  local -a lines=()
  while IFS= read -r line; do
    [[ -n "$line" ]] && lines+=("$line")
  done <<< "$2"
  local i last=$(( ${#lines[@]} - 1 ))
  for i in "${!lines[@]}"; do
    (( i == last )) && { printf '%s└─ %s' "$prefix" "${lines[$i]}"; continue; }
    printf '%s├─ %s\n' "$prefix" "${lines[$i]}"
  done
}

# transformer: one tree item that owns child branches — the label line, then each child
# under the gutter. for a print_belay item whose body nests.
# $1 = the label, $2 = the gutter prefix, $3 = the child lines.
as_tree_item_with_children() {
  local label="$1" prefix="$2" children="$3"
  printf '%s\n%s' "$label" "$(as_tree_children "$prefix" "$children")"
}

# transformer: one tree item that owns a raw nested body — the label line, then each body
# line under the gutter (blank lines kept as the bare gutter). for a captured child render.
# $1 = the label, $2 = the gutter prefix, $3 = the body.
as_tree_item_with_body() {
  local label="$1" prefix="$2" body="$3"
  printf '%s\n%s' "$label" "$(print_nested_lines "$prefix" <<< "$body")"
}

# transformer: the belay severity a sub-command's exit code names — 2 = a constraint the
# caller fixes, any other non-zero = a malfunction. the twin as_exit_from_severity maps back.
as_severity_from_exit() {
  [[ "$1" -eq 2 ]] && { printf '%s' "$SEVERITY_CONSTRAINT"; return 0; }
  printf '%s' "$SEVERITY_MALFUNCTION"
}
as_exit_from_severity() {
  [[ "$1" == "$SEVERITY_CONSTRAINT" ]] && { printf '2'; return 0; }
  printf '1'
}

# transformer: a string with its end whitespace dropped (a gutter `   │  ` → `   │`).
as_trimmed_end() {
  local text="$1"
  printf '%s' "${text%"${text##*[![:space:]]}"}"
}

# print a spacer line on the tree trunk, to set one section of peers apart from the next.
print_tree_spacer() {
  echo "   │"
}

# transformer: the next command for a fresh route — drive it, or bind it first when the bind was
# skipped (an unbound route cannot be driven). $1 = the route, $2 = "1" when the bind was skipped.
as_route_next_step() {
  local route="$1" skip_bind="$2"
  [[ "$skip_bind" == "1" ]] && { printf 'next: bind it, then drive it: rhx route.bind.set --route %s; rhx route.drive' "$route"; return 0; }
  printf 'next: drive it: rhx route.drive'
}

# print the apply handoff: the route, its state, the ward-loop stones, and the drive
# command. $1 = the command header, $2 = the route, $3 = the route state, $4 = HANDOFF_BOUND
# or HANDOFF_UNBOUND.
# .why = an unbound route cannot be driven until it is bound, so the handoff names the bind
#   first — never a drive the route cannot take.
print_apply_handoff() {
  local command="$1" route="$2" state="$3" bound="$4" note="${5:-}"
  print_cat_header "anchors away!"
  print_tree_start "$command"
  print_tree_branch "route" "$route ($state)"
  print_tree_item "$(as_tree_item_with_children "the ward loop runs through the route stones (blind peers are agent work)" \
    "   │  " "$(as_ward_loop_stone_lines)")"
  print_tree_branch "publishes" "$(as_publish_disclosure)"
  print_tree_branch "issuer acts" "$(as_issuer_act_disclosure)"
  print_tree_branch "rewrites" "$(as_history_rewrite_disclosure)"
  print_tree_spacer
  # the next step is the one init renders too (as_route_next_step), so the two never drift
  local skip_bind=""
  [[ -n "$note" ]] && print_tree_item "$note"
  [[ "$bound" == "$HANDOFF_UNBOUND" ]] && { skip_bind="1"; print_tree_item "⚠️ the route is not bound — it cannot be driven until bound"; }
  print_tree_item "$(as_route_next_step "$route" "$skip_bind")" "$TREE_LAST"
  print_disclaimer
}
