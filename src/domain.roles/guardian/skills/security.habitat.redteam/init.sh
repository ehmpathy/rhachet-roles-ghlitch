#!/usr/bin/env bash
######################################################################
# .what = init subcommand for security.habitat.redteam
#
# .why  = scaffolds a route with the ward-loop stones + guards, and a
#         session-durable, GITIGNORED claims path — so a brain can walk
#         ground → detect → verify → repair → promote → (loop | terminate).
#
# prereqs:
#   - inside a git repository
#
# guarantee:
#   ✔ creates route at .behavior/v<date>.guardian-redteam.grain=<grain>[.scope=<token>]/
#     (the slug folds the grain + a subtree scope token — see as_route_slug; init_help
#     prints the concrete form)
#   ✔ copies all .stone and .guard files
#   ✔ stands up a gitignored claims path (live claims never publish)
#   ✔ binds route to current branch
#   ✔ fail-fast on any error
######################################################################
set -euo pipefail

INIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$INIT_DIR/output.sh"

# parse arguments (passed through from the main skill, or invoked directly).
# --scope/--grain are REQUIRED, never defaulted — a defaulted sweep surface is a
# forbidden config-default (rule.forbid.config-defaults); the parent skill always
# supplies both, and a direct invocation must too.
SCOPE=""
GRAIN=""
PEERS="3"
BUDGET="1"
SKIP_ROUTE_BIND=""

init_help() {
  echo "🐈 heres the deal..."
  echo ""
  echo "🧿 security.habitat.redteam init — scaffold the ward-loop route"
  echo ""
  echo "usage:"
  echo "  rhx security.habitat.redteam init --scope <path> --grain <grain> [--peers <n>] [--budget <n>] [--skip-route-bind]"
  echo ""
  echo "args:"
  echo "  --scope <path>      the habitat surface to sweep (required)"
  echo "  --grain <grain>     one of $(as_grain_hint) (required)"
  echo "  --peers <n>         blind peers per grain-partition (default: 3)"
  echo "  --budget <n>        the loop's spend allowance, drawn down per cycle (default: 1)"
  echo "  --skip-route-bind   scaffold the route but do not bind it to the branch"
  echo ""
  echo "what it does:"
  echo "  1. creates route at .behavior/v<date>.guardian-redteam.grain=<grain>[.scope=<token>]/"
  echo "     (the slug folds in the grain — and a scope token for a subtree — so two same-day sweeps get distinct routes)"
  echo "  2. copies the ward-loop .stone + .guard files"
  echo "  3. stands up a gitignored claims path (live claims never publish)"
  echo "  4. binds route to the current branch (unless --skip-route-bind)"
  exit 0
}

# reject an absent value, or a flag-token where a value is required — the same
# loud-fail shape the parent skill uses (consistent-skill-contracts).
require_init_val() {
  if [[ -z "$2" || "$2" == --* ]]; then
    print_belay "absent value for $1" "security.habitat.redteam init"
    exit 2
  fi
}

while [[ $# -gt 0 ]]; do
  case $1 in
    help|--help|-h) init_help ;;
    --scope)
      require_init_val --scope "${2:-}"
      SCOPE="$2"; shift 2 ;;
    --grain)
      require_init_val --grain "${2:-}"
      if ! is_valid_grain "$2"; then
        print_belay "invalid grain: $2 — pass one of $(as_grain_hint)" "security.habitat.redteam init"; exit 2
      fi
      GRAIN="$2"; shift 2 ;;
    --peers)
      require_init_val --peers "${2:-}"
      PEERS="$2"; shift 2 ;;
    --budget)
      require_init_val --budget "${2:-}"
      BUDGET="$2"; shift 2 ;;
    --skip-route-bind) SKIP_ROUTE_BIND="1"; shift ;;
    --skill|--repo|--role) shift; [[ $# -gt 0 && "$1" != --* ]] && shift ;;
    *)
      print_belay "unknown argument: $1 — see: rhx security.habitat.redteam help" "security.habitat.redteam init"
      exit 2 ;;
  esac
done

# --scope/--grain are required (never defaulted — rule.forbid.config-defaults)
if [[ -z "$SCOPE" ]]; then
  print_belay "absent required arg: --scope" "security.habitat.redteam init"
  exit 2
fi
# the scope must be a real path — a direct init invocation validates existence too,
# exactly as the parent skill does (security.habitat.redteam.sh). an init that
# scaffolds a route + 0.scope.md for a surface that was never checked to exist is a
# pit-of-failure: the sweep drives against a path that is not there.
if [[ ! -e "$SCOPE" ]]; then
  print_belay "scope not found: $SCOPE — pass a path that exists (a repo or a subtree)" "security.habitat.redteam init"
  exit 2
fi
# canonicalize the surface so `.` and `./` (and `src/` vs `src`) land one route, not two,
# and so a reuse request spelled either way matches the bound route (as_normalized_scope).
SCOPE="$(as_normalized_scope "$SCOPE")"
if [[ -z "$GRAIN" ]]; then
  print_belay "absent required arg: --grain — pass one of $(as_grain_hint)" "security.habitat.redteam init"
  exit 2
fi

# --peers/--budget default when the parent skill omits them, but a supplied value
# must be a positive integer — a direct init invocation validates too (failfast),
# via the one named guard shared with the parent orchestrator.
if ! is_positive_integer "$PEERS"; then
  print_belay "invalid --peers: $PEERS — pass a positive integer" "security.habitat.redteam init"
  exit 2
fi
if ! is_positive_integer "$BUDGET"; then
  print_belay "invalid --budget: $BUDGET — pass a positive integer" "security.habitat.redteam init"
  exit 2
fi

# check we are in a git repo. capture stderr (never 2>/dev/null) so a genuine git break —
# a corrupt repo, a permission error, a dubious-ownership refusal — is surfaced as a
# malfunction (exit 1), never mislabeled "not a git repo" (exit 2, a constraint the operator
# would chase by cd-ing around). only the fatal that NAMES "not a git repository" is the
# real not-a-repo case; any other message git emits is a true break (rule.forbid.failhide —
# the same failloud shape get_current_branch uses).
# capture in a compound list (`|| GIT_PROBE_RC=$?`) so `set -e` does NOT abort on git's
# non-zero exit before the classify below runs — a bare `VAR=$(cmd)` assignment under set -e
# aborts the whole run (exit 128) on any git failure, which would defeat the whole point of
# telling a real break apart from a plain not-a-repo.
GIT_PROBE_RC=0
GIT_PROBE_SAID="$(git rev-parse --git-dir 2>&1)" || GIT_PROBE_RC=$?
if [[ "$GIT_PROBE_RC" -ne 0 ]]; then
  if is_not_a_git_repo_error "$GIT_PROBE_SAID"; then
    print_belay "not in a git repository — run this from within a repo" "security.habitat.redteam init"
    exit 2
  fi
  print_belay "git malfunctioned while it probed the repo: $GIT_PROBE_SAID" "security.habitat.redteam init" "malfunction"
  exit 1
fi

# compute the route slug (as_route_slug folds today's date, the grain, and a subtree
# scope token into one collision-free name — its header carries the why).
ROUTE_SLUG="$(as_route_slug "$GRAIN" "$SCOPE")"
ROUTE_PATH=".behavior/${ROUTE_SLUG}"
TEMPLATES_DIR="$INIT_DIR/templates"

# refuse to clobber — idempotent + safe. a re-run must never rebind over an
# already-bound redteam route (checked just below), and must never silently reuse a
# route dir (the prior sweep's .claims/ would contaminate the new one). the dir-reuse
# guard is ATOMIC at creation (the mkdir further down), never a check-then-act `-d`
# test, so two concurrent inits — or an apply scaffold that runs beside a direct init —
# cannot both pass the guard and overwrite each other's in-flight route
# (rule.forbid.behavior-hazards). the rebind check fires regardless of --skip-route-bind.
if [[ "${SKIP_ROUTE_BIND:-}" != "1" ]]; then
  if ! BOUND_ROUTE="$(get_bound_route)"; then
    print_belay "route.bind.get probe malfunctioned — cannot check for a bound redteam route" "security.habitat.redteam init" "malfunction"
    exit 1
  fi
  if [[ -n "$BOUND_ROUTE" ]]; then
    print_belay "already bound to a $ROUTE_KIND route: $BOUND_ROUTE — one route binds at a time; to run a DIFFERENT same-day sweep (another grain/scope), unbind first (rhx route.bind.del — non-destructive: the bound route dir + its .claims/ persist under their own distinct slug, resumable by a re-bind), then re-run init" "security.habitat.redteam init"
    exit 2
  fi
fi

# instantiate route. verify the templates dir actually holds stones/guards
# BEFORE we report success — an absent/empty templates dir (a broken install)
# must halt loud, never scaffold an empty route a brain cannot walk
# (failfast + failloud).
if [[ ! -d "$TEMPLATES_DIR" ]]; then
  print_belay "the templates dir is absent: $TEMPLATES_DIR — the skill install is broken" "security.habitat.redteam init" "malfunction"
  exit 1
fi
# create the route dir ATOMICALLY. `mkdir` without -p both creates the leaf AND is the
# clobber guard in one syscall: if the dir already exists the mkdir fails, so a second
# concurrent init cannot slip past a check-then-act `-d` test and overwrite the first's
# in-flight route. the parent .behavior/ is made first (-p) — it is the shared, never the
# contended, dir, so a non-atomic create there is safe. stderr is captured (never hidden)
# so a genuine create malfunction surfaces rather than masquerade as a clobber.
mkdir -p "$(dirname "$ROUTE_PATH")"
MKDIR_SAID=""
if ! MKDIR_SAID="$(mkdir "$ROUTE_PATH" 2>&1)"; then
  if [[ -d "$ROUTE_PATH" ]]; then
    print_belay "a redteam route for this grain+scope today already exists: $ROUTE_PATH — drive it (rhx route.drive) or remove it before a fresh init" "security.habitat.redteam init"
    exit 2
  fi
  print_belay "could not create the route dir: $ROUTE_PATH ($MKDIR_SAID)" "security.habitat.redteam init" "malfunction"
  exit 1
fi
STONES_COPIED="$(copy_route_templates "$TEMPLATES_DIR" "$ROUTE_PATH")"
if [[ "$STONES_COPIED" -eq 0 ]]; then
  print_belay "no .stone/.guard templates found in $TEMPLATES_DIR — the skill install is broken" "security.habitat.redteam init" "malfunction"
  exit 1
fi
# a count > 0 is not proof of a COMPLETE scaffold — a partial copy (a bad glob, an
# unreadable or absent template, a damaged install that drops some-but-not-all files)
# copies some files, so the zero-check above passes. left unchecked, init would print
# clean success, bind the route, and hand the operator off to `rhx route.drive` against
# a route that lacks a stone/guard — a hidden-state hazard that fails the drive partway
# for an invisible reason. verify the COMPLETE required set landed and halt loud (exit 1)
# on any gap, the same loud-fail shape the zero-copy guard above uses (failfast + failloud).
ABSENT_FILES="$(get_route_absent_files "$ROUTE_PATH")"
if [[ -n "$ABSENT_FILES" ]]; then
  print_belay "partial scaffold — the route lacks required files: $(as_oneline "$ABSENT_FILES") — the skill install is broken" "security.habitat.redteam init" "malfunction"
  exit 1
fi

# stand up the gitignored claims path — the disposition gate's home.
# a live claim is a hazard about THIS habitat; it must never be published
# (the dispatch tool is itself an exfil channel). the ignore is a DEFAULT,
# never the control — a `git add -f` walks past it, so the disposition gate
# in the repair stone is the real guard.
CLAIMS_DIR="$ROUTE_PATH/.claims"
mkdir -p "$CLAIMS_DIR"
# a self-ignored dir: all under .claims/ is ignored, except this .gitignore
printf '%s\n' '*' '!.gitignore' > "$CLAIMS_DIR/.gitignore"

# record the sweep parameters for the brain that walks the route (peers + budget
# persisted here, never dropped — the ground stone sizes its partition by peers,
# the promote stone draws the loop's spend from budget)
set_scope_record "$ROUTE_PATH" "$SCOPE" "$GRAIN" "$PEERS" "$BUDGET"

# bind route to branch. a bind is secondary — the scaffold already succeeded; so a bind
# failure must not abort, but it must NOT be faked as success either, and its REAL cause
# must surface (failhide / failloud). the bind i/o lives behind a named communicator
# (set_route_bind) so this orchestrator reads as narrative.
CURRENT_BRANCH="$(get_current_branch)"
BIND_STATE="skipped (--skip-route-bind)"
BIND_RC=0
if [[ "${SKIP_ROUTE_BIND:-}" != "1" ]]; then
  BIND_STATE="$(set_route_bind "$ROUTE_PATH" "$CURRENT_BRANCH")" || BIND_RC=1
fi

# output the vibes. the stone list is DERIVED from the route dir (print_route_stones),
# so the render can never drift from what actually landed.
print_cat_header "anchors away!"
print_tree_start "security.habitat.redteam init --scope $SCOPE --grain $GRAIN"
print_tree_branch "route" "$ROUTE_PATH/ ✨"
print_tree_branch "claims" "$ROUTE_PATH/.claims/ (gitignored — live claims never publish)"
if [[ "$BIND_RC" -eq 0 ]]; then
  # clean run: the bind state is the tree's natural last item (zero exit, no prefix).
  print_tree_item "stones"
  print_route_stones "$ROUTE_PATH"
  print_tree_item "$BIND_STATE" "true"
  print_disclaimer
else
  # a requested bind did NOT take. the tree exits non-zero, so it closes on a
  # `halted:` line (rule.require.consistent-skill-contracts). the NOT-bound cause is a
  # mid-tree item; the close names the outcome.
  print_tree_item "stones"
  print_route_stones "$ROUTE_PATH"
  print_tree_item "$BIND_STATE"
  print_tree_item "halted: route scaffolded, but the bind did not take — retry above" "true"
  print_disclaimer
fi

# a requested bind that did NOT take is a malfunction of a stated guarantee
# (exit-code-semantics) — exit 1 so a direct caller / CI sees the route is not bound,
# while the vibes above name the real cause. the parent apply path halts on ANY non-zero
# init (it prints that output), so a bind-only failure never masquerades as a clean run.
exit "$BIND_RC"
