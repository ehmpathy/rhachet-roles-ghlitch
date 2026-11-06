#!/usr/bin/env bash
######################################################################
# .what = init subcommand for security.habitat.redteam
#
# .why  = scaffolds a route with the ward-loop stones + guards, and a
#         session-durable, gitignored claims path — so a brain can walk
#         ground → detect → verify → repair → promote → (loop | terminate).
#
# prereqs:
#   - inside a git repository (any subtree; the route lands at the repo root)
#
# guarantee:
#   ✔ creates route at <repo root>/.behavior/v<date>.guardian-redteam.grain=<grain>[.scope=<token>]/
#     (the slug folds the grain + a subtree scope token — see get_route_slug; init_help
#     prints the concrete form)
#   ✔ copies all .stone and .guard files
#   ✔ stands up a gitignored claims path (live claims never publish)
#   ✔ binds route to current branch
#   ✔ a failed scaffold removes its partial route, so a retry is never blocked — and says so
#     only when the removal took; a removal that fails names the leftover path
#   - exit 0 = route scaffolded (and bound, unless --skip-route-bind)
#   - exit 1 = malfunction (git, the install, a write, or the bind broke)
#   - exit 2 = constraint (absent/invalid args, absent scope, not a repo, a route already stands)
######################################################################
set -euo pipefail

INIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$INIT_DIR/output.sh"

INIT_CMD="$SKILL_NAME init"
INIT_HINT="$(as_command_hint "$SKILL_NAME" init)"

# parse arguments (passed through from the main skill, or invoked directly).
# --scope/--grain are required, never defaulted — a defaulted sweep surface is a
# forbidden config-default (rule.forbid.config-defaults); the parent skill always
# supplies both, and a direct invocation must too.
SCOPE=""
GRAIN=""
PEERS="3"
BUDGET="1"
SKIP_ROUTE_BIND=""

init_help() {
  print_cat_header "heres the deal..."
  print_tree_start "$INIT_CMD — scaffold the ward-loop route"
  echo ""
  echo "usage:"
  echo "  rhx $INIT_CMD --scope <path> --grain <grain> [--peers <n>] [--budget <n>] [--skip-route-bind]"
  echo ""
  echo "args:"
  echo "  --scope <path>      the habitat surface to sweep (required)"
  echo "  --grain <grain>     one of $(as_grain_hint) (required)"
  echo "                      $GRAIN_GLOSS"
  echo "  --peers <n>         blind peers per grain-partition, 1 to $COUNT_MAX (default: 3)"
  echo "  --budget <n>        the loop's spend allowance, 1 to $COUNT_MAX cycles (default: 1 — one pass, no re-detect)"
  echo "  --skip-route-bind   scaffold the route but do not bind it to the branch"
  echo ""
  echo "what it does:"
  echo "  1. creates route at <repo root>/.behavior/v<date>.guardian-redteam.grain=<grain>[.scope=<token>]/"
  echo "     (the slug folds in the grain — and a scope token for a subtree — so two same-day sweeps get distinct routes)"
  echo "  2. copies the ward-loop .stone + .guard files"
  echo "  3. stands up a gitignored claims path (live claims never publish)"
  echo "  4. binds route to the current branch (unless --skip-route-bind)"
  echo ""
  echo "exit: 0 = scaffolded · 1 = malfunction · 2 = constraint"
  print_disclaimer
  exit 0
}

# orchestrator: bind the shared require_flag_val (output.sh; belays + exits on an absent value
# or a flag-token where a value is required) to init's header and hint, as the parent skill does.
# $1 = flag name, $2 = candidate value, $3 = the fix item.
require_init_val() {
  require_flag_val "$INIT_CMD" "$1" "$2" "$3" "$INIT_HINT"
}

# halt as a constraint (exit 2) / a malfunction (exit 1) under init's header — the shared pair
# (belay_with / halt_with, output.sh) bound to it. $1 = message, then items.
belay_init() {
  belay_with "$INIT_CMD" "$@"
}
halt_init() {
  halt_with "$INIT_CMD" "$@"
}

# halt as a malfunction after the route dir was made: remove the partial route first, so the
# retry meets no clobber refusal over a half-built route. the item says what the removal did:
# a clean start when it took, the leftover path and its cause when it did not.
# $1 = the route this run made, $2 = message, then items.
halt_init_scaffold() {
  local route="$1"
  halt_init "$2" "${@:3}" "$(del_route_dir_as_note "$route")"
}

# orchestrator: remove a partial route, and say what the removal did — a clean start when it
# took, the leftover path and its cause when it did not.
del_route_dir_as_note() {
  local route="$1" said
  said="$(del_route_dir "$route")" && { as_partial_route_removed_note; return 0; }
  as_partial_route_removal_broke_note "$route" "$said"
}

# transformers: the note on a partial route's removal — a clean start, or the leftover and its cause.
as_partial_route_removed_note() {
  printf 'the partial route was removed; a retry starts clean'
}
as_partial_route_removal_broke_note() {
  # labelled `cleanup:`, as each peer halt item is labelled `cause:`, so the eye has a label to scan for
  printf 'cleanup: %s' "$(print_malfunction_cause 'the partial route could not be removed: %s; said: %s — remove it before a retry' "$1" "$2")"
}

# orchestrator: close the run on the exclusive mkdir's verdict — a route that already stands
# belays (exit 2), a create that broke halts (exit 1); rc 0 returns.
# $1 = the mkdir rc, $2 = its cause, $3 = the route.
exit_on_route_dir_verdict() {
  local rc="$1" said="$2" route="$3"
  (( rc == 0 )) && return 0
  (( rc == ROUTE_DIR_EXTANT )) && belay_init "a route for this grain + scope already stands today" \
    "route: $route" "$(as_route_extant_fix "$route")"
  halt_init "could not create the route dir: $route" "cause: $(as_qualified_cause "$said")" "$(as_route_write_fix "$said")"
}

# transformer: the fix for a route that already stands today — drive it (bound first, when a
# skipped or failed bind left it unbound), or remove it, which loses what its .claims/ hold.
as_route_extant_fix() {
  printf 'fix: drive it (rhx route.drive — if unbound, rhx route.bind.set --route %s first), or remove the route dir, then re-run to scaffold fresh (the .claims/ it holds are lost)' "$1"
}

# guard: is the install sound for this scaffold? the one owner of the concept — the templates
# dir stands, it held stones, and every required file landed. a fault halts (exit 1) and removes
# the partial route; rc 0 returns. $1 = the templates dir, $2 = the route, $3 = the count copied.
require_install_sound() {
  local templates="$1" route="$2" copied="$3" absent
  [[ -d "$templates" ]] || halt_init_scaffold "$route" "the skill install is broken" \
    "cause: $(as_qualified_cause "the templates dir is absent: $templates")" "$FIX_REINSTALL"
  [[ "$copied" -eq 0 ]] && halt_init_scaffold "$route" "the skill install is broken" \
    "cause: $(as_qualified_cause "no .stone/.guard templates found in $templates")" "$FIX_REINSTALL"
  # a count > 0 is no proof of a complete scaffold: confirm the whole required set landed
  absent="$(get_route_absent_files "$route")"
  [[ -n "$absent" ]] && halt_init_scaffold "$route" "the skill install is broken" \
    "partial scaffold: $route" "$(as_absent_files_item "$absent")" "$FIX_REINSTALL"
  return 0
}

# orchestrator: validate the request — the one sweep check the parent skill runs too
# (get_sweep_request_fault).
require_init_request_sound() {
  local fault
  fault="$(get_sweep_request_fault "$SCOPE" "$GRAIN" "$PEERS" "$BUDGET")" \
    || belay_init "$(as_fault_message "$fault")" "$(as_fault_fix "$fault")" "$INIT_HINT"
}

# orchestrator: anchor at the repo root, where route.drive looks — the one anchor the parent
# skill runs too: not-a-repo is a constraint (exit 2), any other git break a malfunction. then
# name the scope from the root, and move there. sets SCOPE (root-relative) and ROUTE_PATH.
set_init_anchor() {
  local said
  exit_unless_repo_root "$INIT_CMD" "$INIT_HINT"
  said="$(get_scope_from_repo_root "$SCOPE" "$REPO_ROOT")" \
    || halt_init "could not name the scope from the repo root" "cause: $said" "$FIX_SCOPE_ENTER"
  SCOPE="$said"
  cd "$REPO_ROOT"
  # the route this sweep lands at today (get_route_slug carries the why of its name)
  ROUTE_PATH="$(get_route_path "$GRAIN" "$SCOPE")" \
    || halt_init "could not name today's route — the clock read broke" "cause: $ROUTE_PATH" "$FIX_TOOL_RETRY"
}

# orchestrator: refuse to rebind over a bound route. a scaffold that skips the bind touches no
# bind, so it needs no probe.
require_init_unbound() {
  [[ "$SKIP_ROUTE_BIND" == "1" ]] && return 0
  local probe_rc=0 bound
  bound="$(get_bound_route)" || probe_rc=$?
  exit_on_bound_probe_verdict "$INIT_CMD" "$probe_rc" "$bound" \
    "could not probe the bound route — cannot check for a bound redteam route"
  [[ -n "$bound" ]] && belay_init "one route binds at a time" \
    "already bound to a $ROUTE_KIND route: $bound" \
    "fix: drive it (rhx route.drive), or unbind (rhx route.bind.del) and remove the route dir, then re-run to scaffold fresh (the .claims/ it holds are lost)"
  return 0
}

# orchestrator: create the route dir exclusively (the clobber guard and the create in one
# step), then fill it — templates, install check, claims path, scope record. from the create on,
# a failure removes the partial route (halt_init_scaffold).
set_init_route() {
  local templates="$INIT_DIR/templates" mkdir_rc=0 said copied
  said="$(gen_route_dir_exclusive "$ROUTE_PATH")" || mkdir_rc=$?
  exit_on_route_dir_verdict "$mkdir_rc" "$said" "$ROUTE_PATH"
  copied="$(copy_route_templates "$templates" "$ROUTE_PATH")" \
    || halt_init_scaffold "$ROUTE_PATH" "could not copy the route templates" "cause: $copied" \
      "fix: check that the skill's templates/ are readable and .behavior/ is writable, then re-run"
  require_install_sound "$templates" "$ROUTE_PATH" "$copied"
  said="$(set_claims_dir "$ROUTE_PATH/.claims")" \
    || halt_init_scaffold "$ROUTE_PATH" "could not stand up the gitignored claims path" "cause: $(as_qualified_cause "$said")" "$(as_route_write_fix "$said")"
  said="$(set_scope_record "$ROUTE_PATH" "$SCOPE" "$GRAIN" "$PEERS" "$BUDGET")" \
    || halt_init_scaffold "$ROUTE_PATH" "could not write the scope record" "cause: $(as_qualified_cause "$said")" "$(as_route_write_fix "$said")"
}

# guard: did the bind take (or was it skipped on request)? $1 = the bind's rc.
is_init_bind_taken() {
  (( $1 == 0 ))
}

# print the init render — the route, its claims dir, its stones, and the bind state — and close
# the tree on the next step, or on a qualified error when a requested bind did not take: a
# constraint (rc 2, e.g. a protected branch) or a malfunction (any other rc). the scaffold stands
# either way. the stone list is derived from the route dir (print_route_stones), so the render can
# never drift from what actually landed. renders only; the exit belongs to
# exit_on_init_bind_verdict. $1 = the bind's rc, $2 = the bind state line.
print_init_render() {
  local bind_rc="$1" bind_state="$2" mascot="anchors away!" mark=" ✨" severity
  severity="$(as_severity_from_exit "$bind_rc")"
  is_init_bind_taken "$bind_rc" || { mascot="$(as_belay_mascot "$severity")"; mark=""; }
  print_cat_header "$mascot"
  print_tree_start "$INIT_CMD --scope $SCOPE --grain $GRAIN"
  print_tree_branch "route" "$ROUTE_PATH/$mark"
  print_tree_branch "claims" "$ROUTE_PATH/.claims/ (gitignored — live claims never publish)"
  print_tree_item "stones"
  print_route_stones "$ROUTE_PATH" "   │  "
  # clean run: the bind state, then the next command — the same next step the apply handoff names
  if is_init_bind_taken "$bind_rc"; then
    print_tree_item "$bind_state"
    print_tree_item "$(as_route_next_step "$ROUTE_PATH" "$SKIP_ROUTE_BIND")" "$TREE_LAST"
    print_disclaimer
    return 0
  fi
  # a requested bind did not take: the diagnosis sits under its `cause:` label, the remedy is its
  # own `fix:` item, and the tree closes on the qualified class the bind's rc names
  print_tree_item "cause: $(as_verdict_diagnosis "$bind_state")"
  print_tree_item "$(as_verdict_remedy "$bind_state")"
  print_tree_item "$(as_belay_close_line "$severity" "route scaffolded, but the bind did not take")" "$TREE_LAST"
  print_disclaimer
}

# orchestrator: close the run on the bind verdict — exit 0 when it took; when a requested bind did
# not, exit 2 for a constraint the caller fixes, else 1 (a malfunction of a stated guarantee, never
# faked as success). $1 = the bind's rc.
exit_on_init_bind_verdict() {
  is_init_bind_taken "$1" && exit 0
  exit "$(as_exit_from_severity "$(as_severity_from_exit "$1")")"
}

# orchestrator: the scaffold, one named step per line. the bind state is captured here, so the
# bind, the render, and the exit stay three steps a caller can take apart.
run_init_scaffold() {
  local bind_state bind_rc=0
  require_init_request_sound
  set_init_anchor
  require_init_unbound
  set_init_route
  bind_state="$(set_route_bind_unless_skipped "$ROUTE_PATH" "$SKIP_ROUTE_BIND")" || bind_rc=$?
  print_init_render "$bind_rc" "$bind_state"
  exit_on_init_bind_verdict "$bind_rc"
}

while [[ $# -gt 0 ]]; do
  case $1 in
    help|--help|-h) init_help ;;
    --scope)
      require_init_val --scope "${2:-}" "$FIX_SCOPE"
      SCOPE="$2"; shift 2 ;;
    --grain)
      require_init_val --grain "${2:-}" "$(as_grain_fix)"
      GRAIN="$2"; shift 2 ;;
    --peers)
      require_init_val --peers "${2:-}" "$FIX_PEERS"
      PEERS="$2"; shift 2 ;;
    --budget)
      require_init_val --budget "${2:-}" "$FIX_BUDGET"
      BUDGET="$2"; shift 2 ;;
    --skip-route-bind) SKIP_ROUTE_BIND="1"; shift ;;
    --skill|--repo|--role) shift; is_passthrough_value "$@" && shift ;;
    # a bare separator is dropped, as the sweep's own parse drops it
    --) shift ;;
    --*=*) belay_init "flag and value joined by '=': $1" "$(as_split_flag_fix "$1")" "$INIT_HINT" ;;
    *) belay_init "unknown argument: $1" "fix: drop $1 (this command reads $FLAGS_READ_BY_INIT)" "$INIT_HINT" ;;
  esac
done

run_init_scaffold
