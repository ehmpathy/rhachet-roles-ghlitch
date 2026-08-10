#!/usr/bin/env bash
######################################################################
# ⛵ provision.database — provision database schema against live envs
#
# .what = applies schema changes with a plan/apply/sync pattern
#
# .why  = enables schema changes with a plan/apply/sync pattern:
#         - plan mode shows what changes will be made
#         - apply mode executes the changes
#         - sync mode reconciles the changelog for a change applied
#           out-of-band (no sql re-run)
#         - uses sql-schema-control for schema management
#
# usage:
#   rhx provision.database --which livedb --env prep --mode plan
#   rhx provision.database --which livedb --env prep --mode apply
#   rhx provision.database --which livedb --env prod --mode plan
#   rhx provision.database --which livedb --env prod --mode apply
#   rhx provision.database --which livedb --env prod --mode apply --gate for-cicd
#   rhx provision.database --which livedb --env prep --mode sync --slug <change-slug>
#   rhx provision.database help
#
# options:
#   --which WHICH   database target: livedb (required)
#   --env ENV       environment: prep or prod (required)
#   --mode MODE     operation mode: plan, apply, or sync (required)
#   --slug SLUG     change definition slug — the change's natural key in
#                   control.yml (required for --mode sync; forbidden otherwise)
#   --gate GATE     APPROVAL — which caller-kind's gate clears a prod write
#                   (default: for-ehmpath)
#                     for-ehmpath  the quota a human granted the agent (the local meter)
#                     for-cicd     the github-environment approval (requires CI=true)
#                   the same flag, values, and default as every kin ghlitch skill —
#                   see rule.require.consistent-skill-contracts.
#
# note: the schema plan/apply stdout (from sql-schema-control) is propagated
#       unmodified, so a caller can `| tee ./plan.log` and grep it (e.g. for the
#       up-to-date marker to skip a gated apply). no logfile flag is needed — the
#       marker flows straight through this skill.
#
# guarantee:
#   - exit 0 = provision completed
#   - exit 1 = malfunction (db error, migration failure)
#   - exit 2 = constraint (absent args, bad env)
######################################################################
set -euo pipefail

# help — declared ONCE, invoked from the arg-parse loop below.
#
# it used to also exist as a pre-loop `if [[ "${1:-}" == "help" ]]` check, ABOVE the loop,
# which held a verbatim second copy of this same text. that check is the antipattern
# rule.require.skill-help names by name: rhachet prepends `--skill/--repo/--role`, so under
# a real `rhx provision.database help` invocation `$1` is `--skill`, never `help` — the
# pre-loop block could not fire, and the loop's copy was the one every real caller reached.
#
# two copies of one help text is a drift hazard, and it very nearly bit: this route's own
# `--gate` documentation had to be hand-written into BOTH blocks to stay in sync. the next
# editor who updates one and not the other would ship stale docs to every rhx caller with
# no test to catch it, since the one committed help case drove the DEAD copy via a direct
# `bash <skill> help`. one declaration, one call site, no drift.
show_help() {
  echo "🐈 heres the deal..."
  echo ""
  echo "⛵ provision.database"
  echo ""
  echo "usage:"
  echo "  rhx provision.database --which livedb --env <env> --mode <mode>"
  echo ""
  echo "options:"
  echo "  --which  database target: livedb (required)"
  echo "  --env    environment: prep or prod (required). narrower than the kin skills'"
  echo "           test|prep|prod|camp on purpose — a live schema exists only in prep"
  echo "           and prod, so the other envs name no database to reach"
  echo "  --mode   operation: plan, apply, or sync (required)"
  echo "  --slug   change slug (required for --mode sync; forbidden otherwise)"
  echo "  --gate   whose gate clears a PROD write (default: for-ehmpath)"
  echo "             for-ehmpath  the quota a human granted the agent (local meter)"
  echo "             for-cicd     the github-environment approval (requires CI=true)"
  echo ""
  echo "example:"
  echo "  rhx provision.database --which livedb --env prep --mode plan"
  exit 0
}

# require a value for a flag — belay fast when the next token cannot serve as the value.
# one helper, used by every valued flag, so the message never drifts between flags — the
# same shape provision.declastruct.sh carries (rule.require.consistent-skill-contracts,
# rule.require.failfast-on-omitted-input).
#
# it rejects TWO shapes, and the second is the subtle one:
#   1. absent — the flag was the last arg. without this, set -u trips a cryptic
#      unbound-variable crash instead of a helpful message
#   2. a FLAG token — `--which --env prep` would otherwise set WHICH='--env' and eat the
#      next flag whole. the run then belays about `--env` as absent, which points the
#      caller at the wrong flag entirely: a wrong-but-specific hint, which costs more than
#      a right-but-general one (rule.forbid.surprises). the test belongs on EVERY valued
#      flag, never one at a time — which is why the hand-rolled copy `--gate` used to carry
#      is gone, and every closed-set flag now routes through here.
#
# a flag with a CLOSED value set passes that set as $3, and the belay names it. an error
# that rejects a value without a note of the valid ones is a blocker under
# rule.require.errors-name-the-fix. it is optional rather than mandatory because `--slug`
# takes a free-form change key, where no set exists to name and a fabricated one would
# mislead. the identical helper and message shape live in the kin provision.declastruct, so
# one flag reads one way across both (rule.require.consistent-skill-contracts).
require_val() {
  # $1 = flag name, $2 = the candidate value (pass "${2:-}" from the case),
  # $3 = optional comma-joined valid set, for flags whose values are a closed enum
  if [[ -z "$2" || "$2" == --* ]]; then
    echo "🐈 belay that..."
    echo ""
    echo "⛵ provision.database"
    echo "   ├─ absent value for $1"
    [[ -n "${3:-}" ]] && echo "   ├─ fix: pass one of $3"
    echo "   └─ hint: rhx provision.database help"
    exit 2
  fi
}

# get git root and skill dir
GIT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo ".")
SKILL_DIR="$GIT_ROOT/src/domain.roles/operator/skills"

# parse args
WHICH=""
ENV=""
MODE=""
SLUG=""
# --gate defaults to for-ehmpath (the quota a human granted the agent), which is what an
# omitted flag has always meant — now named. same flag, values, and default as every kin
# ghlitch skill (rule.require.consistent-skill-contracts).
GATE="for-ehmpath"

while [[ $# -gt 0 ]]; do
  case $1 in
    # every valued flag reads its value via require_val, so a flag passed as the last token
    # belays loud rather than crashes raw on an unbound "$2" under set -u, and a flag token
    # handed as a value is never eaten. `--gate` used to hand-roll that same test inline,
    # which left one file with two copies of one rule and two message shapes; the helper is
    # now the single copy. `--slug` is the one deliberate holdout — see its own note.
    --which)
      require_val --which "${2:-}" "livedb"
      WHICH="$2"
      shift 2
      ;;
    --env)
      require_val --env "${2:-}" "prep, prod"
      ENV="$2"
      shift 2
      ;;
    --mode)
      require_val --mode "${2:-}" "plan, apply, sync"
      MODE="$2"
      shift 2
      ;;
    --slug)
      # the ONE valued flag that does not route through require_val, and the exemption is
      # deliberate rather than an oversight. `--slug` is required for `--mode sync` and
      # FORBIDDEN otherwise, so an absent value must fall through to that mode-aware check
      # — which can say "--slug is only for sync" — rather than belay here with a
      # mode-blind "absent value for --slug". the guard shape is otherwise identical: it
      # consumes the value only when one is present and is not itself a flag, so both a
      # bare `--slug` (set -u crash) and a flag token as value (`--slug --mode`) are
      # caught, and a prod-write sync never reaches the network with a garbage key.
      if [[ $# -gt 1 && "$2" != --* ]]; then
        SLUG="$2"
        shift 2
      else
        SLUG=""
        shift
      fi
      ;;
    --gate)
      # GATE needs the guard MORE than its kin: it carries a DEFAULT (for-ehmpath), so an
      # absent value cannot be caught by any later absent-arg check — it is
      # indistinguishable from an omitted flag. so it belays at the READ, and names its
      # valid set, which is a prod-write authorization decision worth the extra line
      # (rule.require.failfast-on-omitted-input).
      require_val --gate "${2:-}" "for-ehmpath, for-cicd"
      GATE="$2"
      shift 2
      ;;
    --auth)
      # --auth is RETIRED on this skill — the WHOLE flag, not one of its values: this skill
      # never had a credential channel to declare (its aws sniff is out of scope), so
      # as-cicd was the only value it ever took. caught by name rather than left to the
      # generic "unknown option" below, since the migration is the one fact a legacy
      # caller needs (rule.require.errors-name-the-fix).
      #
      # the message must hold for EVERY value, not just as-cicd. a caller who transposes
      # `--auth via-ambient` from provision.declastruct is a named cost in the vision, and
      # to answer them "replace it with --gate for-cicd" would hand them a fix for a
      # different axis — a wrong fix, which is worse than a bare rejection
      # (rule.forbid.surprises). so it states what is true of the flag, then notes the one
      # value that has a direct replacement.
      echo "🐈 belay that..."
      echo ""
      echo "⛵ provision.database"
      echo "   ├─ retired flag: --auth (this skill declares no credential channel)"
      echo "   ├─ fix: for prod-write approval use --gate for-ehmpath|for-cicd"
      echo "   └─ note: --auth as-cicd is now --gate for-cicd"
      exit 2
      ;;
    --skill|--role|--repo)
      # rhachet propagates these; ignore
      shift 2
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
      echo "⛵ provision.database"
      echo "   ├─ unknown option: $1"
      echo "   └─ use --help for usage"
      exit 2
      ;;
  esac
done

# validate required args
if [[ -z "$WHICH" ]]; then
  echo "🐈 belay that..."
  echo ""
  echo "⛵ provision.database"
  echo "   ├─ absent required arg: --which"
  echo "   └─ must be: livedb"
  exit 2
fi

if [[ "$WHICH" != "livedb" ]]; then
  echo "🐈 belay that..."
  echo ""
  echo "⛵ provision.database"
  echo "   ├─ invalid which: $WHICH"
  echo "   └─ must be: livedb"
  exit 2
fi

if [[ -z "$ENV" ]]; then
  echo "🐈 belay that..."
  echo ""
  echo "⛵ provision.database"
  echo "   ├─ absent required arg: --env"
  echo "   └─ must be: prep or prod"
  exit 2
fi

if [[ "$ENV" != "prep" && "$ENV" != "prod" ]]; then
  echo "🐈 belay that..."
  echo ""
  echo "⛵ provision.database"
  echo "   ├─ invalid env: $ENV"
  echo "   └─ must be: prep or prod"
  exit 2
fi

if [[ -z "$MODE" ]]; then
  echo "🐈 belay that..."
  echo ""
  echo "⛵ provision.database"
  echo "   ├─ absent required arg: --mode"
  echo "   └─ must be: plan, apply, or sync"
  exit 2
fi

if [[ "$MODE" != "plan" && "$MODE" != "apply" && "$MODE" != "sync" ]]; then
  echo "🐈 belay that..."
  echo ""
  echo "⛵ provision.database"
  echo "   ├─ invalid mode: $MODE"
  echo "   └─ must be: plan, apply, or sync"
  exit 2
fi

# --slug is the change's natural key, meaningful only to sync.
# require it for sync; forbid it elsewhere — an illegal combo fails fast so a
# caller never thinks a plan/apply was scoped to one change (it never is).
if [[ "$MODE" == "sync" && -z "$SLUG" ]]; then
  echo "🐈 belay that..."
  echo ""
  echo "⛵ provision.database"
  echo "   ├─ absent required arg for sync: --slug"
  echo "   └─ hint: rhx provision.database --which livedb --env $ENV --mode sync --slug <change-slug>"
  exit 2
fi

if [[ "$MODE" != "sync" && -n "$SLUG" ]]; then
  echo "🐈 belay that..."
  echo ""
  echo "⛵ provision.database"
  echo "   ├─ --slug is only valid with --mode sync (got --mode $MODE)"
  echo "   └─ hint: drop --slug, or use --mode sync"
  exit 2
fi

# the retired word is caught at the FLAG, in the arg parse above (`--auth)`), which is
# where a real migration lands: a caller who carries the old contract types --auth. a
# `--gate as-cicd` (new flag, old value) falls to the enum guard below and reads
# "invalid gate: as-cicd / must be: for-ehmpath or for-cicd" — which names the valid set
# and is the same answer every kin skill gives for that input
# (rule.require.consistent-skill-contracts).
#
# validate --gate — fail loud on a typo rather than silently ignore it. an ignored value
# would fall back to the local meter, which could read as an opt into the cicd gate when
# it was not — a prod-write authorization decision made by a typo.
if [[ "$GATE" != "for-ehmpath" && "$GATE" != "for-cicd" ]]; then
  echo "🐈 belay that..."
  echo ""
  echo "⛵ provision.database"
  echo "   ├─ invalid gate: $GATE"
  echo "   └─ must be: for-ehmpath or for-cicd"
  exit 2
fi

# prod gate: prod writes are gated; only plan stays open (it alone reads).
# gate fail-closed — every mode but plan mutates prod (apply runs DDL, sync
# writes the changelog), so gate all non-plan modes. a future write mode is
# gated by default rather than a silent bypass of this safety control.
# placed before the rds wake so a blocked write never touches prod.
# --gate forwards VERBATIM to uses.check — no translation, because the gate skill speaks
# the same word. --gate for-cicd defers the prod-write gate to the ambient
# github-environment approval (CI) instead of the local meter.
if [[ "$ENV" == "prod" && "$MODE" != "plan" ]]; then
  DEPLOYER_SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  bash "$DEPLOYER_SKILL_DIR/uses._.check.sh" \
    --meter provision.uses --env prod --gate "$GATE" || exit $?
fi

# output header
echo "🐈 chartin course..."
echo ""
if [[ "$MODE" == "sync" ]]; then
  echo "⛵ provision.database --which $WHICH --env $ENV --mode $MODE --slug $SLUG"
else
  echo "⛵ provision.database --which $WHICH --env $ENV --mode $MODE"
fi
echo "   ├─ which: $WHICH"
echo "   ├─ env: $ENV"
echo "   ├─ mode: $MODE"
[[ "$MODE" == "sync" ]] && echo "   ├─ change: $SLUG"

# ensure database connectivity (handles keyrack, vpc tunnel, and pg_isready).
# frame the sub-skill's full output in its own treestruct sub.bucket so it is
# clearly delineated under its own header, not a wall at column 0. run_sub_bucket
# preserves the exit code, so a connectivity failure still fail-fasts via set -e.
source "$SKILL_DIR/_.nest.sh"
echo "   └─ lets get some sun..."
# explicit `|| exit $?` — run_sub_bucket runs the child in a process substitution,
# so a bare call would not reliably trip set -e; forward the child exit code so a
# connectivity failure fail-fasts exactly like a direct call.
run_sub_bucket "      " "$SKILL_DIR/use.rds.capacity.sh" --env "$ENV" || exit $?
echo ""

# source aws credentials from keyrack for the schema run (use.rds.capacity opened the
# tunnel and may have unlocked keyrack). skip entirely when aws creds are already set
# (CI/OIDC static creds) — never touch keyrack in CI, to match use.vpc.tunnel, and
# never override OIDC creds with a stale AWS_PROFILE. the guard is the ambient
# AWS_ACCESS_KEY_ID (the same signal use.vpc.tunnel uses), so every mode skips
# keyrack in CI regardless of --auth.
if [[ -z "${AWS_ACCESS_KEY_ID:-}" ]]; then
  AWS_PROFILE=$(rhx keyrack get --owner ehmpath --env "$ENV" --key AWS_PROFILE --value)
  eval "$(aws configure export-credentials --profile "$AWS_PROFILE" --format env)"
  unset AWS_PROFILE AWS_DEFAULT_PROFILE 2>/dev/null || true
fi

# set environment for getConfig()
export STAGE="$ENV"
export ACCESS="$ENV"
export NODE_ENV="production"
export AWS_SDK_LOAD_CONFIG=1

# scope the oidc grant getConfig hands to sql-schema-control:
#   - plan reads only  → GRANT=plan  (reader grant; least privilege)
#   - apply runs DDL   → GRANT=apply (writer grant; the default)
#   - sync writes the changelog table → GRANT=apply (a write, needs writer)
# set explicitly per mode so plan never borrows the writer grant, and a stale
# GRANT=plan from the caller's shell never starves a write of its rights.
# run the schema command with inherited fds — sql-schema-control's stdout (incl. the
# up-to-date and connect-timeout markers) propagates unmodified to the caller, so a
# workflow can `| tee ./plan.log` and grep it to decide whether a gated apply runs.
if [[ "$MODE" == "plan" ]]; then
  echo "   plan schema changes..."
  GRANT=plan npm run provision:schema:plan
elif [[ "$MODE" == "apply" ]]; then
  echo "   apply schema changes..."
  GRANT=apply npm run provision:schema:apply
elif [[ "$MODE" == "sync" ]]; then
  # reconcile the changelog for one change, no re-run of its sql. forward --slug
  # to sql-schema-control via npm's `--` passthrough.
  echo "   sync changelog for change: $SLUG ..."
  GRANT=apply npm run provision:schema:sync -- --slug "$SLUG"
fi

echo ""
echo "🐈 smooth sailin!"
echo ""
if [[ "$MODE" == "sync" ]]; then
  echo "⛵ provision.database --which $WHICH --env $ENV --mode $MODE --slug $SLUG"
  echo "   ├─ change: $SLUG"
  echo "   └─ changelog reconciled (no sql executed)"
else
  echo "⛵ provision.database --which $WHICH --env $ENV --mode $MODE"
  echo "   └─ provisioned"
fi
