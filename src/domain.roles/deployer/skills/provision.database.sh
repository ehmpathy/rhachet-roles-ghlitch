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
#   rhx provision.database help
#
# options:
#   --which WHICH   database target: livedb (required)
#   --env ENV       environment: prep or prod (required)
#   --mode MODE     operation mode: plan or apply (required)
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
  exit 0
fi

# get git root and skill dir
GIT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo ".")
SKILL_DIR="$GIT_ROOT/src/domain.roles/operator/skills"

# parse args
WHICH=""
ENV=""
MODE=""

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

# output header
echo "🐈 chartin course..."
echo ""
echo "⛵ provision.database --which $WHICH --env $ENV --mode $MODE"
echo "   ├─ which: $WHICH"
echo "   ├─ env: $ENV"
echo "   └─ mode: $MODE"
echo ""

# ensure database connectivity (handles keyrack, vpc tunnel, and pg_isready)
echo "   ensure database connectivity..."
"$SKILL_DIR/use.rds.capacity.sh" --env "$ENV"
echo ""

# source aws credentials from keyrack (use.rds.capacity may have unlocked it)
AWS_PROFILE=$(rhx keyrack get --owner ehmpath --env "$ENV" --key AWS_PROFILE --value 2>/dev/null || echo "")
if [[ -n "$AWS_PROFILE" ]]; then
  eval "$(aws configure export-credentials --profile "$AWS_PROFILE" --format env 2>/dev/null)" || true
fi
unset AWS_PROFILE AWS_DEFAULT_PROFILE 2>/dev/null || true

# set environment for getConfig()
export STAGE="$ENV"
export ACCESS="$ENV"
export NODE_ENV="production"
export AWS_SDK_LOAD_CONFIG=1

# run sql-schema-control
if [[ "$MODE" == "plan" ]]; then
  echo "   plan schema changes..."
  npm run provision:schema:plan
elif [[ "$MODE" == "apply" ]]; then
  echo "   apply schema changes..."
  npm run provision:schema:apply
fi

echo ""
echo "🐈 smooth sailin!"
echo ""
echo "⛵ provision.database --which $WHICH --env $ENV --mode $MODE"
echo "   └─ provisioned"
