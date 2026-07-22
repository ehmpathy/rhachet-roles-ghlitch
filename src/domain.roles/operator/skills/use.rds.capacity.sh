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

# parse args — reject unknown options so a mistyped flag fails loud, not silent.
# .note = rhx prepends --skill/--repo/--role before user args, so allowlist them.
ENV=""
i=0
while [[ $i -lt ${#ARGS[@]} ]]; do
  case "${ARGS[$i]}" in
    --env) ENV="${ARGS[$((i+1))]}"; i=$((i + 2)) ;;
    --skill | --repo | --role) i=$((i + 2)) ;;
    *)
      echo "🐈 belay that..." >&2
      echo "" >&2
      echo "🦺 use.rds.capacity" >&2
      echo "   ├─ unknown option: ${ARGS[$i]}" >&2
      echo "   └─ hint: rhx use.rds.capacity help" >&2
      exit 2
      ;;
  esac
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

# .note = aws credentials are sourced by use.vpc.tunnel on its ssm path, not here.
#         use.rds.capacity's own work (getConfig read + pg_isready) needs no aws
#         access, and a localhost target needs no creds at all — so the tunnel owns
#         cred-sourcing, scoped to the one path that needs it.

# set STAGE for getConfig() and ACCESS for backwards compat
export STAGE="$ENV"
export ACCESS="$ENV"
export NODE_ENV="production"
export AWS_SDK_LOAD_CONFIG=1

echo "🐈 rise and shine..."
echo ""
echo "🦺 use.rds.capacity --env $ENV"
echo "   ├─ env: $ENV"

# open the vpc tunnel for this env
# .note = use.vpc.tunnel owns config-read, failfast, and tunnel-open (ssm or localhost);
#         use.rds.capacity composes it, then awaits db capacity. a non-zero exit
#         (e.g. absent config) propagates here via set -e, so we never reach the wait.
#         called by $SCRIPT_DIR path (matches invoke.command.sh / invoke.vital.sh
#         peer-call convention), so it resolves from any cwd.
# frame use.vpc.tunnel's full output in its own treestruct sub.bucket so it is
# clearly delineated under its own header; run_sub_bucket preserves the exit code,
# so an absent-config failfast still propagates via set -e.
source "$SCRIPT_DIR/_.nest.sh"
echo "   └─ lets open the channel..."
# explicit `|| exit $?` — run_sub_bucket runs the child in a process substitution,
# so a bare call would not reliably trip set -e; forward the child exit code so an
# absent-config failfast propagates exactly like a direct call would.
run_sub_bucket "      " "$SCRIPT_DIR/use.vpc.tunnel.sh" --env "$ENV" || exit $?

# read the local endpoint from config to poll for capacity
CONFIG_JSON=$(npx tsx -e "
  import { getConfig } from './src/utils/config/getConfig';
  (async () => {
    const c = await getConfig();
    console.log(JSON.stringify({
      host: c.database.tunnel.local.host,
      port: c.database.tunnel.local.port,
    }));
  })();
")
DB_HOST=$(echo "$CONFIG_JSON" | jq -r '.host')
DB_PORT=$(echo "$CONFIG_JSON" | jq -r '.port')

# await for the database to have capacity (awakens serverless rds if paused)
echo ""
echo "🦺 use.rds.capacity --env $ENV"
echo "   ├─ await capacity..."
echo "   ├─ host: $DB_HOST"
echo "   └─ port: $DB_PORT"

timeout 180 bash -c "until pg_isready -h $DB_HOST -p $DB_PORT; do sleep 5; done"

echo ""
echo "🐈 caught it!"
echo ""
echo "🦺 use.rds.capacity"
echo "   └─ database ready"
