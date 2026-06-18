#!/usr/bin/env bash
######################################################################
# 🔮 query.database — run readonly SQL queries against the database
#
# .what = executes SQL queries with readonly safety
#
# .why  = enables quick database queries for debug:
#         - diagnose data state
#         - verify records
#         - investigate issues
#
# usage:
#   rhx query.database --env prod --sql "SELECT * FROM job LIMIT 5"
#   rhx query.database --env prod --sql "SELECT uuid, status FROM job WHERE id = 123"
#   echo "SELECT * FROM job LIMIT 5" | rhx query.database --env prod --sql @stdin
#   rhx query.database help
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

# help
if [[ "${1:-}" == "help" || "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  echo "🐈 heres the deal..."
  echo ""
  echo "🔮 query.database"
  echo ""
  echo "usage:"
  echo "  rhx query.database --env <env> --sql <query>"
  echo "  echo 'SELECT ...' | rhx query.database --env <env> --sql @stdin"
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
fi

# extract --env from args
ENV=""
ARGS=("$@")
for i in "${!ARGS[@]}"; do
  if [[ "${ARGS[$i]}" == "--env" ]]; then
    ENV="${ARGS[$((i+1))]}"
    break
  fi
done

# validate env
if [[ -z "$ENV" ]]; then
  echo "🐈 belay that..."
  echo ""
  echo "🔮 query.database"
  echo "   ├─ absent required arg: --env"
  echo "   └─ must be: test, prep, or prod"
  exit 2
fi

if [[ "$ENV" != "test" && "$ENV" != "prep" && "$ENV" != "prod" ]]; then
  echo "🐈 belay that..."
  echo ""
  echo "🔮 query.database"
  echo "   ├─ invalid env: $ENV"
  echo "   └─ must be: test, prep, or prod"
  exit 2
fi

# source aws credentials from keyrack (skip if already set)
if [[ -z "${AWS_ACCESS_KEY_ID:-}" ]]; then
  AWS_PROFILE=$(rhx keyrack get --owner ehmpath --env "$ENV" --key AWS_PROFILE --value 2>/dev/null || echo "")
  if [[ -z "$AWS_PROFILE" ]]; then
    echo "🐈 wet paws..."
    echo ""
    echo "🔮 query.database"
    echo "   ├─ absent AWS_PROFILE from keyrack for env=$ENV"
    echo "   └─ hint: rhx keyrack unlock --owner ehmpath --env $ENV"
    exit 1
  fi

  # export static credentials only — do NOT export AWS_PROFILE
  # AWS SDK prefers AWS_PROFILE over static creds, which causes SSO failures
  eval "$(aws configure export-credentials --profile "$AWS_PROFILE" --format env)"
  unset AWS_PROFILE AWS_DEFAULT_PROFILE
fi

# set STAGE for getConfig()
export STAGE="$ENV"
export NODE_ENV="production"

# run the TypeScript implementation
exec npx tsx "$SCRIPT_DIR/query.database.ts" "$@"
