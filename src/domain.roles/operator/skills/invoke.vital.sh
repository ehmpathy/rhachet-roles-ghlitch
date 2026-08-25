#!/usr/bin/env bash
######################################################################
# 🦺 invoke.vital — invoke vitals from src/contract/vitals/
#
# .what = runs any vital with proper credential setup
#
# .why  = vitals need infrastructure access:
#         - keyrack unlock for AWS credentials
#         - VPC tunnel via use.rds.capacity for database access
#         - passthrough of all vital args
#
# usage:
#   rhx invoke.vital --name checkCoverage --env prod
#   rhx invoke.vital --name checkCoverage --env prod --alert
#   rhx invoke.vital --name checkCoverage --env prod --alert --limit 100
#   rhx invoke.vital --list                    # list available vitals
#   rhx invoke.vital help
#
# options:
#   --name NAME     vital name (without path or .ts extension)
#   --env ENV       environment: test, prep, or prod (required)
#   --list          list available vitals
#   ...             all other args passed to the vital
#
# guarantee:
#   - exit 0 = vital completed
#   - exit 1 = malfunction (aws error, vital failure)
#   - exit 2 = constraint (absent args, bad env, vital not found)
######################################################################
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GIT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo ".")
VITALS_DIR="$GIT_ROOT/src/contract/vitals"

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
  echo "🦺 invoke.vital"
  echo ""
  echo "usage:"
  echo "  rhx invoke.vital --name <vital> --env <env> [args...]"
  echo "  rhx invoke.vital --list"
  echo ""
  echo "options:"
  echo "  --name   vital name (without path or .ts extension)"
  echo "  --env    environment: test, prep, or prod"
  echo "  --list   list available vitals"
  echo ""
  echo "examples:"
  echo "  rhx invoke.vital --list"
  echo "  rhx invoke.vital --name checkCoverage --env prep --alert"
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
    echo "🦺 invoke.vital"
    echo "   ├─ absent value for $1"
    [[ -n "${3:-}" ]] && echo "   ├─ fix: pass one of $3"
    echo "   └─ hint: rhx invoke.vital help"
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
      # no value set named: a vital name is free-form, and a fabricated set would mislead
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

# the vital directory is where BOTH modes look, so it is checked once, here, ahead of them.
# it is absent when the skill is invoked outside a repo that holds vitals — a constraint the
# caller fixes with a `cd`, not a malfunction, hence exit 2.
if [[ ! -d "$VITALS_DIR" ]]; then
  echo "🐈 belay that..."
  echo ""
  echo "🦺 invoke.vital"
  echo "   ├─ no vital directory at: src/contract/vitals"
  echo "   └─ hint: run this from a repo that holds vitals"
  exit 2
fi

# handle --list
if [[ "$LIST" == "true" ]]; then
  # ONE mascot, ONE header, ONE tree. this block used to print a bare `🦺 available vitals:`
  # with no mascot above it and no tree item glyphs below it — an artifact header that was
  # neither introduced nor closed (rule.require.nest-subskill-output-in-buckets).
  echo "🐈 heres the deal..."
  echo ""
  echo "🦺 invoke.vital --list"
  echo "   └─ vitals available"

  # collected FIRST and counted, because the last child takes `└─` and that is unknowable
  # until the list is complete.
  VITALS=()
  for f in "$VITALS_DIR"/*.ts; do
    [[ -f "$f" ]] && VITALS+=("$(basename "$f" .ts)")
  done

  # an empty directory is an ANSWER, not an error — but it must still be SPOKEN. the block
  # used to render the header and then not one line below it, which reads as a skill that
  # broke rather than a repo that holds no vital.
  if [[ ${#VITALS[@]} -eq 0 ]]; then
    echo "      └─ (none)"
    exit 0
  fi

  IDX=0
  for name in "${VITALS[@]}"; do
    IDX=$((IDX + 1))
    if [[ $IDX -eq ${#VITALS[@]} ]]; then
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
  echo "🦺 invoke.vital"
  echo "   ├─ absent required arg: --name"
  echo "   └─ hint: rhx invoke.vital --list"
  exit 2
fi

if [[ -z "$ENV" ]]; then
  echo "🐈 belay that..."
  echo ""
  echo "🦺 invoke.vital"
  echo "   ├─ absent required arg: --env"
  echo "   └─ must be: test, prep, or prod"
  exit 2
fi

if [[ "$ENV" != "test" && "$ENV" != "prep" && "$ENV" != "prod" ]]; then
  echo "🐈 belay that..."
  echo ""
  echo "🦺 invoke.vital"
  echo "   ├─ invalid env: $ENV"
  echo "   └─ must be: test, prep, or prod"
  exit 2
fi

# check vital exists
VITAL_FILE="$VITALS_DIR/$NAME.ts"
if [[ ! -f "$VITAL_FILE" ]]; then
  echo "🐈 belay that..."
  echo ""
  echo "🦺 invoke.vital"
  echo "   ├─ vital not found: $NAME"
  echo "   └─ hint: rhx invoke.vital --list"
  exit 2
fi

# source aws credentials from keyrack (skip if already set, e.g., in CI)
if [[ -z "${AWS_ACCESS_KEY_ID:-}" ]]; then
  AWS_PROFILE=$(rhx keyrack get --owner ehmpath --env "$ENV" --key AWS_PROFILE --value || echo "")
  if [[ -z "$AWS_PROFILE" ]]; then
    echo "🐈 wet paws..."
    echo ""
    echo "🦺 invoke.vital"
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
    echo "🦺 invoke.vital"
    echo "   ├─ absent credentials from profile $AWS_PROFILE"
    echo "   └─ hint: aws sso login --profile $AWS_PROFILE"
    exit 1
  fi

  # clear ALL profile-related vars so SDK uses only static credentials
  unset AWS_PROFILE AWS_DEFAULT_PROFILE
fi

# set environment vars for the vital
export ACCESS="$ENV"
export STAGE="$ENV"
export NODE_ENV="production"

echo "🐈 chartin course..."
echo ""
echo "🦺 invoke.vital --name $NAME --env $ENV"
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
  echo "   ├─ tunnel absent — the vital may not reach the database"
fi

# run the vital.
#
# `exec` used to stand here, which handed the terminal to the vital and left its render at
# column 0 beneath a tree that never closed — and gave the run no success close at all. a
# vital is a RENDER, not a payload: no caller was ever found that parses this skill's stdout,
# so the forward-contract exemption does not apply and the child is framed like any other
# (rule.require.nest-subskill-output-in-buckets, `.verify the contract before you honor the
# exemption`).
echo "   └─ invoke the vital..."
INVOKE_RC=0
run_sub_bucket "      " npx tsx "$VITAL_FILE" "${PASSTHROUGH_ARGS[@]}" || INVOKE_RC=$?

# the tree above is already closed by its own `└─` item, so a failure here needs no further
# close — only the belay. `wet paws` and the child's own code, because a vital that failed is
# a malfunction of the run, not a constraint on the caller (rule.require.exit-code-semantics).
if [[ $INVOKE_RC -ne 0 ]]; then
  echo ""
  echo "🐈 wet paws..."
  echo ""
  echo "🦺 invoke.vital"
  echo "   ├─ the vital exited $INVOKE_RC"
  echo "   └─ hint: read the bucket above for what it said"
  exit "$INVOKE_RC"
fi

echo ""
echo "🐈 smooth sailin!"
echo ""
echo "🦺 invoke.vital --name $NAME --env $ENV"
echo "   └─ vital completed"
