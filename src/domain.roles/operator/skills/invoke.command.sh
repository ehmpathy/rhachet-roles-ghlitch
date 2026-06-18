#!/usr/bin/env bash
######################################################################
# 🦺 invoke.command — invoke commands from src/contract/commands/
#
# .what = runs any command with proper credential setup
#
# .why  = commands need infrastructure access:
#         - keyrack unlock for AWS credentials
#         - VPC tunnel via use.rds.capacity for database access
#         - passthrough of all command args
#
# usage:
#   rhx invoke.command --name requeueTaskDeriveJobFacts --env prod --mode plan --limit 5
#   rhx invoke.command --name repairCaptureTrails --env prod --mode plan --limit 100
#   rhx invoke.command --name getJob --env prod --jobUuid abc-123
#   rhx invoke.command --list                    # list available commands
#   rhx invoke.command help
#
# options:
#   --name NAME     command name (without path or .ts extension)
#   --env ENV       environment: test, prep, or prod (required)
#   --list          list available commands
#   ...             all other args passed to the command
#
# guarantee:
#   - exit 0 = command completed
#   - exit 1 = malfunction (aws error, command failure)
#   - exit 2 = constraint (absent args, bad env, command not found)
######################################################################
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GIT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo ".")
COMMANDS_DIR="$GIT_ROOT/src/contract/commands"

# help
if [[ "${1:-}" == "help" || "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  echo "🐈 heres the deal..."
  echo ""
  echo "🦺 invoke.command"
  echo ""
  echo "usage:"
  echo "  rhx invoke.command --name <command> --env <env> [args...]"
  echo "  rhx invoke.command --list"
  echo ""
  echo "options:"
  echo "  --name   command name (without path or .ts extension)"
  echo "  --env    environment: test, prep, or prod"
  echo "  --list   list available commands"
  exit 0
fi

# parse args
NAME=""
ENV=""
LIST=false
PASSTHROUGH_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --name)
      NAME="$2"
      shift 2
      ;;
    --env)
      ENV="$2"
      PASSTHROUGH_ARGS+=("$1" "$2")
      shift 2
      ;;
    --list)
      LIST=true
      shift
      ;;
    *)
      PASSTHROUGH_ARGS+=("$1")
      shift
      ;;
  esac
done

# handle --list
if [[ "$LIST" == "true" ]]; then
  echo "🦺 available commands:"
  echo ""
  for f in "$COMMANDS_DIR"/*.ts; do
    if [[ -f "$f" ]]; then
      basename "$f" .ts | sed 's/^/   ├─ /'
    fi
  done | sed '$ s/├─/└─/'
  exit 0
fi

# validate args
if [[ -z "$NAME" ]]; then
  echo "🐈 belay that..."
  echo ""
  echo "🦺 invoke.command"
  echo "   ├─ absent required arg: --name"
  echo "   └─ hint: rhx invoke.command --list"
  exit 2
fi

if [[ -z "$ENV" ]]; then
  echo "🐈 belay that..."
  echo ""
  echo "🦺 invoke.command"
  echo "   ├─ absent required arg: --env"
  echo "   └─ must be: test, prep, or prod"
  exit 2
fi

if [[ "$ENV" != "test" && "$ENV" != "prep" && "$ENV" != "prod" ]]; then
  echo "🐈 belay that..."
  echo ""
  echo "🦺 invoke.command"
  echo "   ├─ invalid env: $ENV"
  echo "   └─ must be: test, prep, or prod"
  exit 2
fi

# check command exists
COMMAND_FILE="$COMMANDS_DIR/$NAME.ts"
if [[ ! -f "$COMMAND_FILE" ]]; then
  echo "🐈 belay that..."
  echo ""
  echo "🦺 invoke.command"
  echo "   ├─ command not found: $NAME"
  echo "   └─ hint: rhx invoke.command --list"
  exit 2
fi

# source aws credentials from keyrack (skip if already set, e.g., in CI)
if [[ -z "${AWS_ACCESS_KEY_ID:-}" ]]; then
  AWS_PROFILE=$(rhx keyrack get --owner ehmpath --env "$ENV" --key AWS_PROFILE --value 2>/dev/null || echo "")
  if [[ -z "$AWS_PROFILE" ]]; then
    echo "🐈 wet paws..."
    echo ""
    echo "🦺 invoke.command"
    echo "   ├─ absent AWS_PROFILE from keyrack for env=$ENV"
    echo "   └─ hint: rhx keyrack unlock --owner ehmpath --env $ENV"
    exit 1
  fi

  # export static credentials only — do NOT export AWS_PROFILE
  # AWS SDK prefers AWS_PROFILE over static creds, which causes SSO failures
  eval "$(aws configure export-credentials --profile "$AWS_PROFILE" --format env)"

  # clear ALL profile-related vars so SDK uses only static credentials
  unset AWS_PROFILE AWS_DEFAULT_PROFILE
fi

# set environment vars for the command
export ACCESS="$ENV"
export STAGE="$ENV"
export NODE_ENV="production"

echo "🐈 chartin course..."
echo ""
echo "🦺 invoke.command --name $NAME --env $ENV"
echo "   ├─ name: $NAME"
echo "   └─ env: $ENV"

# ensure VPC tunnel is open (for database access)
# note: use.rds.capacity handles idempotent tunnel open
"$SCRIPT_DIR/use.rds.capacity.sh" --env "$ENV" >/dev/null 2>&1 || {
  echo "   └─ warn: could not open VPC tunnel, proceed anyway..."
}

# run the command
exec npx tsx "$COMMAND_FILE" "${PASSTHROUGH_ARGS[@]}"
