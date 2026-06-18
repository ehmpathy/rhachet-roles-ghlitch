#!/usr/bin/env bash
######################################################################
# 🦺 use.rds.capacity — ensure rds database has capacity
#
# .what = wakes serverless rds if paused before tests or migrations
#
# .why  = serverless rds clusters pause after inactivity:
#         - opens vpc tunnel to database cluster
#         - polls database until it responds
#         - handles keyrack unlock and aws credential export
#
# usage:
#   rhx use.rds.capacity --env test
#   rhx use.rds.capacity --env prep
#   rhx use.rds.capacity --env prod
#
# options:
#   --env ENV       environment: test, prep, or prod (required)
#
# guarantee:
#   - exit 0 = database ready
#   - exit 1 = malfunction (aws error, timeout)
#   - exit 2 = constraint (absent args, bad env)
######################################################################
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# parse --env from args (or fallback to ACCESS env var for backwards compat)
ENV=""
ARGS=("$@")
for i in "${!ARGS[@]}"; do
  if [[ "${ARGS[$i]}" == "--env" ]]; then
    ENV="${ARGS[$((i+1))]}"
    break
  fi
done

# fallback to ACCESS env var for backwards compatibility
if [[ -z "$ENV" && -n "${ACCESS:-}" ]]; then
  ENV="$ACCESS"
fi

# validate env
if [[ -z "$ENV" ]]; then
  echo "🐈 belay that..."
  echo ""
  echo "🦺 use.rds.capacity"
  echo "   ├─ absent required arg: --env"
  echo "   └─ hint: rhx use.rds.capacity help"
  exit 2
fi

if [[ "$ENV" != "test" && "$ENV" != "prep" && "$ENV" != "prod" ]]; then
  echo "🐈 belay that..."
  echo ""
  echo "🦺 use.rds.capacity"
  echo "   ├─ invalid env: $ENV"
  echo "   └─ must be: test, prep, or prod"
  exit 2
fi

# help
if [[ "${1:-}" == "help" || "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  echo "🐈 heres the deal..."
  echo ""
  echo "🦺 use.rds.capacity"
  echo ""
  echo "usage:"
  echo "  rhx use.rds.capacity --env test"
  echo "  rhx use.rds.capacity --env prep"
  echo "  rhx use.rds.capacity --env prod"
  echo ""
  echo "options:"
  echo "  --env   environment: test, prep, or prod (required)"
  exit 0
fi

# try to source aws credentials from keyrack (skip if AWS creds already set, e.g., in CI)
if [[ -z "${AWS_ACCESS_KEY_ID:-}" ]]; then
  # unlock keyrack first to refresh AWS SSO if needed
  rhx keyrack unlock --owner ehmpath --env "$ENV" 2>/dev/null || true

  AWS_PROFILE=$(rhx keyrack get --owner ehmpath --env "$ENV" --key AWS_PROFILE --value 2>/dev/null || echo "")
  if [[ -n "$AWS_PROFILE" ]]; then
    # export static credentials only — do NOT export AWS_PROFILE
    # AWS SDK prefers AWS_PROFILE over static creds, which causes SSO failures
    eval "$(aws configure export-credentials --profile "$AWS_PROFILE" --format env)"
    unset AWS_PROFILE
  fi
fi

# set STAGE for getConfig() and ACCESS for backwards compat
export STAGE="$ENV"
export ACCESS="$ENV"
export NODE_ENV="production"
export AWS_SDK_LOAD_CONFIG=1

echo "🐈 chartin course..."
echo ""
echo "🦺 use.rds.capacity --env $ENV"
echo "   └─ env: $ENV"

# open the vpc tunnel
"$SCRIPT_DIR/use.vpc.tunnel.ts"

# extract host and port from tunnel plan
npx declastruct plan --wish "$SCRIPT_DIR/use.vpc.tunnel.ts" --into .temp/tunnel.plan.json
DB_HOST=$(jq -r '.changes[] | select(.forResource.class == "DeclaredUnixHostAlias") | .state.desired.from' .temp/tunnel.plan.json)
DB_PORT=$(jq -r '.changes[] | select(.forResource.class == "DeclaredAwsVpcTunnel") | .state.desired.from.port' .temp/tunnel.plan.json)

# await for the database to have capacity (awakens serverless rds if paused)
echo "   ├─ await capacity..."
echo "   ├─ host: $DB_HOST"
echo "   └─ port: $DB_PORT"

timeout 180 bash -c "until pg_isready -h $DB_HOST -p $DB_PORT; do sleep 5; done"

echo ""
echo "🐈 caught it!"
echo ""
echo "🦺 use.rds.capacity"
echo "   └─ database ready"
