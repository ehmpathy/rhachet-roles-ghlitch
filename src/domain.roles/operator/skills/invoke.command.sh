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

# the frame helper, sourced ONCE and unconditionally at the top. it belongs above the header,
# never inside a branch — a helper used by a child is not the property of whichever branch
# happened to need it first (rule.require.nest-subskill-output-in-buckets, `.how`).
# shellcheck source=/dev/null
source "$SCRIPT_DIR/_.nest.sh"

# ONE help text, reached from BOTH call sites. the pre-loop check serves a direct call where
# `help` is the first token; the in-loop arm serves an `rhx` call, which passes
# `--skill/--repo/--role` ahead of the caller's own args, so `$1` is never the caller's first
# token there (rule.require.skill-help, `.antipattern`).
show_help() {
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
  echo ""
  echo "examples:"
  echo "  rhx invoke.command --list"
  echo "  rhx invoke.command --name getJob --env prep --jobUuid abc-123"
  exit 0
}

# help, ahead of the loop — for a direct call where `help` is the first token
if [[ "${1:-}" == "help" || "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  show_help
fi

# require a value for a flag — belay fast when the next token cannot serve as the value.
# the same helper, message and value-set hint as every kin skill
# (rule.require.consistent-skill-contracts).
#
# it rejects TWO shapes, and the second is the subtle one:
#   1. absent — the flag was the last arg. without this, set -u trips a cryptic
#      unbound-variable crash instead of a helpful message
#   2. a FLAG token — `--name --env prep` would otherwise set NAME='--env' and eat the next
#      flag whole, so the run belays about the WRONG flag
require_val() {
  # $1 = flag name, $2 = the candidate value (pass "${2:-}" from the case),
  # $3 = optional comma-joined valid set, for flags whose values are a closed enum
  if [[ -z "$2" || "$2" == --* ]]; then
    echo "🐈 belay that..."
    echo ""
    echo "🦺 invoke.command"
    echo "   ├─ absent value for $1"
    [[ -n "${3:-}" ]] && echo "   ├─ fix: pass one of $3"
    echo "   └─ hint: rhx invoke.command help"
    exit 2
  fi
}

# parse args
NAME=""
ENV=""
LIST=false
PASSTHROUGH_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --name)
      # no value set named: a command name is free-form, and a fabricated set would mislead
      require_val --name "${2:-}"
      NAME="$2"
      shift 2
      ;;
    --env)
      require_val --env "${2:-}" "test,prep,prod"
      ENV="$2"
      PASSTHROUGH_ARGS+=("$1" "$2")
      shift 2
      ;;
    --list)
      LIST=true
      shift
      ;;
    help|--help|-h)
      show_help
      ;;
    --skill|--repo|--role)
      shift 2
      ;;
    *)
      PASSTHROUGH_ARGS+=("$1")
      shift
      ;;
  esac
done

# the command directory is where BOTH modes look, so it is checked once, here, ahead of them.
# it is absent when the skill is invoked outside a repo that holds commands — a constraint the
# caller fixes with a `cd`, not a malfunction, hence exit 2.
if [[ ! -d "$COMMANDS_DIR" ]]; then
  echo "🐈 belay that..."
  echo ""
  echo "🦺 invoke.command"
  echo "   ├─ no command directory at: src/contract/commands"
  echo "   └─ hint: run this from a repo that holds commands"
  exit 2
fi

# handle --list
if [[ "$LIST" == "true" ]]; then
  # ONE mascot, ONE header, ONE tree. this block used to print a bare `🦺 available commands:`
  # with no mascot above it and no tree item glyphs below it — an artifact header that was
  # neither introduced nor closed (rule.require.nest-subskill-output-in-buckets).
  echo "🐈 heres the deal..."
  echo ""
  echo "🦺 invoke.command --list"
  echo "   └─ commands available"

  # collected FIRST and counted, because the last child takes `└─` and that is unknowable
  # until the list is complete.
  COMMANDS=()
  for f in "$COMMANDS_DIR"/*.ts; do
    [[ -f "$f" ]] && COMMANDS+=("$(basename "$f" .ts)")
  done

  # an empty directory is an ANSWER, not an error — but it must still be SPOKEN. the block
  # used to render the header and then not one line below it, which reads as a skill that
  # broke rather than a repo that holds no commands.
  if [[ ${#COMMANDS[@]} -eq 0 ]]; then
    echo "      └─ (none)"
    exit 0
  fi

  IDX=0
  for name in "${COMMANDS[@]}"; do
    IDX=$((IDX + 1))
    if [[ $IDX -eq ${#COMMANDS[@]} ]]; then
      echo "      └─ $name"
    else
      echo "      ├─ $name"
    fi
  done
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
  AWS_PROFILE=$(rhx keyrack get --owner ehmpath --env "$ENV" --key AWS_PROFILE --value || echo "")
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
  #
  # the `if !` guard is the point: an unguarded eval let a failed credential read die under
  # set -e with aws's own message at column 0 and no belay at all — no mascot, no header, no
  # hint (rule.require.errors-name-the-fix).
  if ! eval "$(aws configure export-credentials --profile "$AWS_PROFILE" --format env)"; then
    echo "🐈 wet paws..."
    echo ""
    echo "🦺 invoke.command"
    echo "   ├─ absent credentials from profile $AWS_PROFILE"
    echo "   └─ hint: aws sso login --profile $AWS_PROFILE"
    exit 1
  fi

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
echo "   ├─ env: $ENV"

# ensure VPC tunnel is open (for database access)
# note: use.rds.capacity handles idempotent tunnel open
#
# this child is SILENCED, so it takes no bucket — but silence is a reason to speak FOR a
# child, never a reason to leave it undelineated. both arms report, at the same depth
# (rule.require.nest-subskill-output-in-buckets, `.a child you capture still needs a voice`).
#
# the failure arm used to print `   └─ warn: ...` — a SECOND `└─` on a tree the item above had
# already closed, so one run drew two closes and the reader could not tell where the tree ended.
if "$SCRIPT_DIR/use.rds.capacity.sh" --env "$ENV" >/dev/null 2>&1; then
  echo "   ├─ tunnel open"
else
  echo "   ├─ tunnel absent — the command may not reach the database"
fi

# run the command.
#
# `exec` used to stand here, which handed the terminal to the command and left its render at
# column 0 beneath a tree that never closed — and gave the run no success close at all. a
# command is a RENDER, not a payload: no caller was ever found that parses this skill's stdout,
# so the forward-contract exemption does not apply and the child is framed like any other
# (rule.require.nest-subskill-output-in-buckets, `.verify the contract before you honor the
# exemption`).
echo "   └─ invoke the command..."
INVOKE_RC=0
run_sub_bucket "      " npx tsx "$COMMAND_FILE" "${PASSTHROUGH_ARGS[@]}" || INVOKE_RC=$?

# the tree above is already closed by its own `└─` item, so a failure here needs no further
# close — only the belay. `wet paws` and the child's own code, because a command that failed is
# a malfunction of the run, not a constraint on the caller (rule.require.exit-code-semantics).
if [[ $INVOKE_RC -ne 0 ]]; then
  echo ""
  echo "🐈 wet paws..."
  echo ""
  echo "🦺 invoke.command"
  echo "   ├─ the command exited $INVOKE_RC"
  echo "   └─ hint: read the bucket above for what it said"
  exit "$INVOKE_RC"
fi

echo ""
echo "🐈 smooth sailin!"
echo ""
echo "🦺 invoke.command --name $NAME --env $ENV"
echo "   └─ command completed"
