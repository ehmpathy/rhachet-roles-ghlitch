#!/usr/bin/env bash
######################################################################
# ⛵ provision.database — provision database schema against live envs
#
# .what = applies schema migrations with plan/apply pattern
#
# .why  = enables schema migrations with plan/apply pattern:
#         - plan mode shows what changes will be made
#         - apply mode executes the changes
#         - uses sql-schema-control for schema management
#
# usage:
#   rhx provision.database --which livedb --env prep --mode plan
#   rhx provision.database --which livedb --env prep --mode apply
#   rhx provision.database --which livedb --env prod --mode plan
#   rhx provision.database --which livedb --env prod --mode apply
#   rhx provision.database --which livedb --env prod --mode apply --auth as-cicd
#   rhx provision.database --which livedb --env prod --mode plan
#   rhx provision.database help
#
# options:
#   --which WHICH   database target: livedb (required)
#   --env ENV       environment: prep or prod (required)
#   --mode MODE     operation mode: plan or apply (required)
#   --auth AUTH     prod-apply authorization source: as-cicd (optional). in CI, defers
#                   the prod-apply gate to the github-environment approval instead of
#                   the local human meter (requires CI=true). local runs omit it.
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

# help
if [[ "${1:-}" == "help" || "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  echo "🐈 heres the deal..."
  echo ""
  echo "⛵ provision.database"
  echo ""
  echo "usage:"
  echo "  rhx provision.database --which livedb --env <env> --mode <mode>"
  echo ""
  echo "options:"
  echo "  --which  database target: livedb"
  echo "  --env    environment: prep or prod"
  echo "  --mode   operation: plan or apply"
  echo "  --auth   prod-apply auth: as-cicd (defers to github-environment approval in CI)"
  exit 0
fi

# get git root and skill dir
GIT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo ".")
SKILL_DIR="$GIT_ROOT/src/domain.roles/operator/skills"

# parse args
WHICH=""
ENV=""
MODE=""
AUTH=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --which)
      WHICH="$2"
      shift 2
      ;;
    --env)
      ENV="$2"
      shift 2
      ;;
    --mode)
      MODE="$2"
      shift 2
      ;;
    --auth)
      AUTH="$2"
      shift 2
      ;;
    --skill|--role|--repo)
      # rhachet propagates these; ignore
      shift 2
      ;;
    --)
      shift
      ;;
    help|--help|-h)
      echo "🐈 heres the deal..."
      echo ""
      echo "⛵ provision.database"
      echo ""
      echo "usage:"
      echo "  rhx provision.database --which livedb --env <env> --mode <mode>"
      echo ""
      echo "options:"
      echo "  --which  database target: livedb"
      echo "  --env    environment: prep or prod"
      echo "  --mode   operation: plan or apply"
      echo "  --auth   prod-apply auth: as-cicd (defers to github-environment approval in CI)"
      exit 0
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
  echo "   └─ must be: plan or apply"
  exit 2
fi

if [[ "$MODE" != "plan" && "$MODE" != "apply" ]]; then
  echo "🐈 belay that..."
  echo ""
  echo "⛵ provision.database"
  echo "   ├─ invalid mode: $MODE"
  echo "   └─ must be: plan or apply"
  exit 2
fi

# validate --auth if supplied — only "as-cicd" is a recognized auth source. fail loud
# on a typo rather than silently ignore it (an ignored auth could look like it opted
# into the cicd auth when it did not).
if [[ -n "$AUTH" && "$AUTH" != "as-cicd" ]]; then
  echo "🐈 belay that..."
  echo ""
  echo "⛵ provision.database"
  echo "   ├─ invalid auth: $AUTH"
  echo "   └─ must be: as-cicd"
  exit 2
fi

# prod gate: only a prod APPLY is gated; plan stays open (it only reads).
# placed before the rds wake so a blocked apply never touches prod.
# --auth passes through to uses.check: --auth as-cicd defers the prod-apply gate to
# the ambient github-environment approval (CI) instead of the local human meter.
if [[ "$ENV" == "prod" && "$MODE" == "apply" ]]; then
  DEPLOYER_SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  GATE_ARGS=(--meter provision.uses --env prod)
  [[ -n "$AUTH" ]] && GATE_ARGS+=(--auth "$AUTH")
  bash "$DEPLOYER_SKILL_DIR/uses._.check.sh" "${GATE_ARGS[@]}" || exit $?
fi

# output header
echo "🐈 chartin course..."
echo ""
echo "⛵ provision.database --which $WHICH --env $ENV --mode $MODE"
echo "   ├─ which: $WHICH"
echo "   ├─ env: $ENV"
echo "   ├─ mode: $MODE"

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
# AWS_ACCESS_KEY_ID (the same signal use.vpc.tunnel uses), so plan and apply both skip
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
# set explicitly per mode so plan never borrows the writer grant, and a stale
# GRANT=plan from the caller's shell never starves an apply of its DDL rights.
# run the schema command with inherited fds — sql-schema-control's stdout (incl. the
# up-to-date and connect-timeout markers) propagates unmodified to the caller, so a
# workflow can `| tee ./plan.log` and grep it to decide whether a gated apply runs.
if [[ "$MODE" == "plan" ]]; then
  echo "   plan schema changes..."
  GRANT=plan npm run provision:schema:plan
elif [[ "$MODE" == "apply" ]]; then
  echo "   apply schema changes..."
  GRANT=apply npm run provision:schema:apply
fi

echo ""
echo "🐈 smooth sailin!"
echo ""
echo "⛵ provision.database --which $WHICH --env $ENV --mode $MODE"
echo "   └─ provisioned"
