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

ARGS=("$@")

# help — checked before validation, and scans all args
# .note = rhx passes --skill/--repo/--role before user args, so check all positions
for arg in "${ARGS[@]}"; do
  if [[ "$arg" == "help" || "$arg" == "--help" || "$arg" == "-h" ]]; then
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
done

# parse --env from args (or fallback to ACCESS env var for backwards compat)
ENV=""
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

# try to source aws credentials from keyrack (skip if AWS creds already set, e.g., in CI)
if [[ -z "${AWS_ACCESS_KEY_ID:-}" ]]; then
  # unlock keyrack first to refresh AWS SSO if needed
  rhx keyrack unlock --owner ehmpath --env "$ENV" || true

  AWS_PROFILE=$(rhx keyrack get --owner ehmpath --env "$ENV" --key AWS_PROFILE --value || echo "")
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

echo "🐈 rise and shine..."
echo ""
echo "🦺 use.rds.capacity --env $ENV"
echo "   └─ env: $ENV"

# read tunnel config from repo's config/
CONFIG_JSON=$(npx tsx -e "
  import { getConfig } from './src/utils/config/getConfig';
  (async () => {
    const c = await getConfig();
    console.log(JSON.stringify({
      bastion: c.database.tunnel.bastion,
      cluster: c.database.tunnel.cluster,
      host: c.database.tunnel.local.host,
      port: c.database.tunnel.local.port,
      account: c.aws.account,
    }));
  })();
")

export VPC_TUNNEL_BASTION=$(echo "$CONFIG_JSON" | jq -r '.bastion.exid')
export VPC_TUNNEL_CLUSTER=$(echo "$CONFIG_JSON" | jq -r '.cluster.name')
export VPC_TUNNEL_HOST=$(echo "$CONFIG_JSON" | jq -r '.host')
export VPC_TUNNEL_PORT=$(echo "$CONFIG_JSON" | jq -r '.port')
export AWS_ACCOUNT_ID=$(echo "$CONFIG_JSON" | jq -r '.account')
export AWS_REGION="us-east-1"

# fail fast when tunnel config is absent — guide the caller to fix their repo config
# .note = placeholder "null" means config was never filled in for this env; never proceed with it
absentKeys=()
if [[ -z "$VPC_TUNNEL_BASTION" || "$VPC_TUNNEL_BASTION" == "null" ]]; then absentKeys+=("database.tunnel.bastion.exid"); fi
if [[ -z "$VPC_TUNNEL_CLUSTER" || "$VPC_TUNNEL_CLUSTER" == "null" ]]; then absentKeys+=("database.tunnel.cluster.name"); fi
if [[ -z "$AWS_ACCOUNT_ID" || "$AWS_ACCOUNT_ID" == "null" ]]; then absentKeys+=("aws.account"); fi
if [[ ${#absentKeys[@]} -gt 0 ]]; then
  echo "" >&2
  echo "🐈 belay that..." >&2
  echo "" >&2
  echo "🦺 use.rds.capacity --env $ENV" >&2
  echo "   ├─ absent tunnel config for env: $ENV" >&2
  for key in "${absentKeys[@]}"; do
    echo "   ├─ absent: $key" >&2
  done
  echo "   └─ hint: set these in your repo config for $ENV (currently \"null\")" >&2
  exit 2
fi

# open the vpc tunnel
npx declastruct apply --plan yolo --wish "$SCRIPT_DIR/use.vpc.tunnel.ts"

# read host and port from exported config
DB_HOST="$VPC_TUNNEL_HOST"
DB_PORT="$VPC_TUNNEL_PORT"

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
