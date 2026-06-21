#!/usr/bin/env bash
######################################################################
# 🔮 aws.postgres.query — run readonly SQL queries against the database
#
# .what = executes SQL queries with readonly safety
#
# .why  = enables quick database queries for debug:
#         - diagnose data state
#         - verify records
#         - investigate issues
#
# usage:
#   rhx aws.postgres.query --env prod --sql "SELECT * FROM job LIMIT 5"
#   rhx aws.postgres.query --env prod --sql "SELECT uuid, status FROM job WHERE id = 123"
#   echo "SELECT * FROM job LIMIT 5" | rhx aws.postgres.query --env prod --sql @stdin
#   rhx aws.postgres.query help
#
# options:
#   --env ENV       environment: test, prep, or prod (required)
#   --sql QUERY     SQL query to execute (required)
#                   use @stdin to read query from stdin
#   --format FMT    output format: table (default), csv, json
#
# safety:
#   - connection-level: SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY
#   - PostgreSQL rejects any INSERT/UPDATE/DELETE/DROP at the driver level
#
# guarantee:
#   - exit 0 = query completed
#   - exit 1 = malfunction (db error, query failure)
#   - exit 2 = constraint (absent args, bad env)
######################################################################
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# save original args to pass to TypeScript
ORIGINAL_ARGS=("$@")

# parse arguments
ENV=""
while [[ $# -gt 0 ]]; do
  case $1 in
    --env)
      ENV="$2"
      shift 2
      ;;
    --sql|--format)
      # pass through to TypeScript
      shift 2
      ;;
    --skill|--repo|--role)
      # rhachet passes these, skip them
      shift 2
      ;;
    --)
      shift
      ;;
    help|--help|-h)
      echo "🐈 heres the deal..."
      echo ""
      echo "🔮 aws.postgres.query"
      echo ""
      echo "usage:"
      echo "  rhx aws.postgres.query --env <env> --sql <query>"
      echo "  echo 'SELECT ...' | rhx aws.postgres.query --env <env> --sql @stdin"
      echo ""
      echo "options:"
      echo "  --env      environment: test, prep, or prod"
      echo "  --sql      SQL query to execute (use @stdin to read from stdin)"
      echo "  --format   output format: table (default), csv, json"
      echo ""
      echo "safety:"
      echo "  - readonly enforced at connection level"
      echo "  - PostgreSQL rejects INSERT/UPDATE/DELETE/DROP"
      exit 0
      ;;
    *)
      # unknown arg, TypeScript will handle
      shift
      ;;
  esac
done

# validate env
if [[ -z "$ENV" ]]; then
  echo "🐈 belay that..."
  echo ""
  echo "🔮 aws.postgres.query"
  echo "   ├─ absent required arg: --env"
  echo "   └─ must be: test, prep, or prod"
  exit 2
fi

if [[ "$ENV" != "test" && "$ENV" != "prep" && "$ENV" != "prod" ]]; then
  echo "🐈 belay that..."
  echo ""
  echo "🔮 aws.postgres.query"
  echo "   ├─ invalid env: $ENV"
  echo "   └─ must be: test, prep, or prod"
  exit 2
fi

# source aws credentials from keyrack (skip if already set)
if [[ -z "${AWS_ACCESS_KEY_ID:-}" ]]; then
  AWS_PROFILE=$(rhx keyrack get --owner ehmpath --env "$ENV" --key AWS_PROFILE --value || echo "")
  if [[ -z "$AWS_PROFILE" ]]; then
    echo "🐈 wet paws..."
    echo ""
    echo "🔮 aws.postgres.query"
    echo "   ├─ absent AWS_PROFILE from keyrack for env=$ENV"
    echo "   └─ hint: rhx keyrack unlock --owner ehmpath --env $ENV"
    exit 1
  fi

  # export static credentials only — do NOT export AWS_PROFILE
  # AWS SDK prefers AWS_PROFILE over static creds, which causes SSO failures
  eval "$(aws configure export-credentials --profile "$AWS_PROFILE" --format env)"
  unset AWS_PROFILE AWS_DEFAULT_PROFILE
fi

# set ACCESS for TypeScript error hints
export ACCESS="$ENV"
export NODE_ENV="production"

# run the TypeScript implementation
exec npx tsx "$SCRIPT_DIR/aws.postgres.query.ts" "${ORIGINAL_ARGS[@]}"
