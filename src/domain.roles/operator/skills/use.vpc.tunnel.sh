#!/usr/bin/env bash
######################################################################
# 🦺 use.vpc.tunnel — establish secure database tunnel for an env
#
# .what = opens an ssm tunnel to the env's rds endpoint via its bastion,
#         with target derived per-environment from repo config
#
# .why  = enables local database access without public rds exposure,
#         with the environment as the single source of truth so a prep
#         session can never be aimed at prod
#
# usage:
#   rhx use.vpc.tunnel --env test
#   rhx use.vpc.tunnel --env prep
#   rhx use.vpc.tunnel --env prod
#   rhx use.vpc.tunnel help
#
# options:
#   --env ENV    environment: test, prep, or prod (required)
#
# behavior:
#   - reads the env's tunnel target from repo config (getConfig)
#   - if the config host is localhost (local testdb, no bastion),
#     skips the ssm tunnel and points at localhost
#   - otherwise opens the ssm tunnel via declastruct
#
# guarantee:
#   - exit 0 = tunnel active (or localhost target confirmed)
#   - exit 1 = malfunction (aws error, ssm failure)
#   - exit 2 = constraint (absent/invalid env, absent config)
######################################################################
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

ARGS=("$@")

show_help() {
  echo "🐈 heres the deal..."
  echo ""
  echo "🦺 use.vpc.tunnel"
  echo ""
  echo "usage:"
  echo "  rhx use.vpc.tunnel --env test"
  echo "  rhx use.vpc.tunnel --env prep"
  echo "  rhx use.vpc.tunnel --env prod"
  echo ""
  echo "options:"
  echo "  --env    environment: test, prep, or prod (required)"
  echo "  --help   show this help"
  echo ""
  echo "behavior:"
  echo "  - derives the tunnel target per-env from repo config"
  echo "  - localhost target (local testdb) skips the ssm tunnel"
  echo "  - otherwise opens the ssm tunnel via declastruct"
  exit 0
}

# help — checked before validation, scans all args
# .note = rhx passes --skill/--repo/--role before user args, so check all positions
for arg in "${ARGS[@]}"; do
  if [[ "$arg" == "help" || "$arg" == "--help" || "$arg" == "-h" ]]; then
    show_help
  fi
done

# parse args — reject unknown options so old --bastion/--cluster/--port/--host
# (removed by design) fail loud instead of a silent no-op.
# .note = rhx prepends --skill/--repo/--role before user args, so allowlist them.
ENV=""
i=0
while [[ $i -lt ${#ARGS[@]} ]]; do
  case "${ARGS[$i]}" in
    --env) ENV="${ARGS[$((i + 1))]}"; i=$((i + 2)) ;;
    --skill | --repo | --role) i=$((i + 2)) ;;
    *)
      echo "🐈 belay that..." >&2
      echo "" >&2
      echo "🦺 use.vpc.tunnel" >&2
      echo "   ├─ unknown option: ${ARGS[$i]}" >&2
      echo "   └─ hint: rhx use.vpc.tunnel help" >&2
      exit 2
      ;;
  esac
done

# fail fast when --env is absent — never default an environment
if [[ -z "$ENV" ]]; then
  echo "🐈 belay that..." >&2
  echo "" >&2
  echo "🦺 use.vpc.tunnel" >&2
  echo "   ├─ absent required arg: --env" >&2
  echo "   └─ hint: rhx use.vpc.tunnel help" >&2
  exit 2
fi

# fail fast when --env is not a known environment
if [[ "$ENV" != "test" && "$ENV" != "prep" && "$ENV" != "prod" ]]; then
  echo "🐈 belay that..." >&2
  echo "" >&2
  echo "🦺 use.vpc.tunnel --env $ENV" >&2
  echo "   ├─ invalid env: $ENV" >&2
  echo "   └─ must be: test, prep, or prod" >&2
  exit 2
fi

# .note = aws credentials are sourced later, only on the ssm path (after the
#         localhost short-circuit) — a localhost target needs no aws access, so a
#         local dev with only a testdb can open it without keyrack. see the ssm branch.

# set STAGE for getConfig() and ACCESS for backwards compat
export STAGE="$ENV"
export ACCESS="$ENV"
export NODE_ENV="production"
export AWS_SDK_LOAD_CONFIG=1

echo "🐈 chartin course..."
echo ""
echo "🦺 use.vpc.tunnel --env $ENV"
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

VPC_TUNNEL_HOST=$(echo "$CONFIG_JSON" | jq -r '.host')
VPC_TUNNEL_PORT=$(echo "$CONFIG_JSON" | jq -r '.port')

# fail fast when the local host is absent — never proceed with a null host, else the
# localhost check falls through to the ssm path with a null host target
if [[ -z "$VPC_TUNNEL_HOST" || "$VPC_TUNNEL_HOST" == "null" ]]; then
  echo "" >&2
  echo "🐈 belay that..." >&2
  echo "" >&2
  echo "🦺 use.vpc.tunnel --env $ENV" >&2
  echo "   ├─ absent tunnel config for env: $ENV" >&2
  echo "   ├─ absent: database.tunnel.local.host" >&2
  echo "   └─ hint: set it in your repo config for $ENV (currently \"null\")" >&2
  exit 2
fi

# fail fast when the local port is absent — never default a port
if [[ -z "$VPC_TUNNEL_PORT" || "$VPC_TUNNEL_PORT" == "null" ]]; then
  echo "" >&2
  echo "🐈 belay that..." >&2
  echo "" >&2
  echo "🦺 use.vpc.tunnel --env $ENV" >&2
  echo "   ├─ absent tunnel config for env: $ENV" >&2
  echo "   ├─ absent: database.tunnel.local.port" >&2
  echo "   └─ hint: set it in your repo config for $ENV (currently \"null\")" >&2
  exit 2
fi

# localhost target (local testdb, no bastion) — skip the ssm tunnel
# .note = the localhost decision is config-driven (host == localhost),
#         not a hardcoded env == test check, so env values stay in config
if [[ "$VPC_TUNNEL_HOST" == "localhost" ]]; then
  echo ""
  echo "🦺 use.vpc.tunnel --env $ENV"
  echo "   ├─ target: localhost (local testdb)"
  echo "   └─ no ssm tunnel needed"
  echo ""
  echo "🐈 smooth sailin!"
  echo ""
  echo "🦺 use.vpc.tunnel --env $ENV"
  echo "   └─ points at localhost:$VPC_TUNNEL_PORT"
  exit 0
fi

# ssm target needs aws credentials — source them now, fail loud if absent
# .note = no failhide here: a non-zero from keyrack/aws halts via set -e with the
#         real error, so an absent credential never proceeds to an opaque ssm failure.
#         skipped when AWS creds are already set (e.g., CI static creds).
if [[ -z "${AWS_ACCESS_KEY_ID:-}" ]]; then
  # unlock keyrack scoped to this env — never unlock --env all
  rhx keyrack unlock --owner ehmpath --env "$ENV"

  # export static credentials only — do NOT export AWS_PROFILE
  # AWS SDK prefers AWS_PROFILE over static creds, which causes SSO failures
  AWS_PROFILE=$(rhx keyrack get --owner ehmpath --env "$ENV" --key AWS_PROFILE --value)
  eval "$(aws configure export-credentials --profile "$AWS_PROFILE" --format env)"
  unset AWS_PROFILE
fi

# ssm target — derive the rest of the tunnel config and open the tunnel
export VPC_TUNNEL_HOST VPC_TUNNEL_PORT
export VPC_TUNNEL_BASTION=$(echo "$CONFIG_JSON" | jq -r '.bastion.exid')
export VPC_TUNNEL_CLUSTER=$(echo "$CONFIG_JSON" | jq -r '.cluster.name')
export AWS_ACCOUNT_ID=$(echo "$CONFIG_JSON" | jq -r '.account')
export AWS_REGION="us-east-1"

# fail fast when ssm tunnel config is absent — guide the caller to fix their repo config
# .note = placeholder "null" means config was never filled in for this env; never proceed with it
absentKeys=()
if [[ -z "$VPC_TUNNEL_BASTION" || "$VPC_TUNNEL_BASTION" == "null" ]]; then absentKeys+=("database.tunnel.bastion.exid"); fi
if [[ -z "$VPC_TUNNEL_CLUSTER" || "$VPC_TUNNEL_CLUSTER" == "null" ]]; then absentKeys+=("database.tunnel.cluster.name"); fi
if [[ -z "$AWS_ACCOUNT_ID" || "$AWS_ACCOUNT_ID" == "null" ]]; then absentKeys+=("aws.account"); fi
if [[ ${#absentKeys[@]} -gt 0 ]]; then
  echo "" >&2
  echo "🐈 belay that..." >&2
  echo "" >&2
  echo "🦺 use.vpc.tunnel --env $ENV" >&2
  echo "   ├─ absent tunnel config for env: $ENV" >&2
  for key in "${absentKeys[@]}"; do
    echo "   ├─ absent: $key" >&2
  done
  echo "   └─ hint: set these in your repo config for $ENV (currently \"null\")" >&2
  exit 2
fi

echo ""
echo "🦺 use.vpc.tunnel --env $ENV"
echo "   ├─ account: $AWS_ACCOUNT_ID"
echo "   ├─ region: $AWS_REGION"
echo "   ├─ bastion: $VPC_TUNNEL_BASTION"
echo "   ├─ cluster: $VPC_TUNNEL_CLUSTER"
echo "   ├─ host: $VPC_TUNNEL_HOST"
echo "   └─ port: $VPC_TUNNEL_PORT"

# open the vpc tunnel
# .note = idempotent by design — declastruct reconciles the declared state (tunnel
#         status OPEN) against the actual state, so a re-run when the tunnel is already
#         open is a no-op, not a duplicate. no extra re-entry guard is needed here.
npx declastruct apply --plan yolo --wish "$SCRIPT_DIR/use.vpc.tunnel.ts"

echo ""
echo "🐈 smooth sailin!"
echo ""
echo "🦺 use.vpc.tunnel --env $ENV"
echo "   └─ tunnel open: $VPC_TUNNEL_HOST:$VPC_TUNNEL_PORT"
