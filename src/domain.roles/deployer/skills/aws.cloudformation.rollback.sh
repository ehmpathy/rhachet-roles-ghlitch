#!/usr/bin/env bash
######################################################################
# ⛵ aws.cloudformation.rollback — continue a stuck cloudformation rollback
#
# .what = continues a stack rollback when in UPDATE_ROLLBACK_FAILED state
#
# .why  = when a stack is in UPDATE_ROLLBACK_FAILED state, it needs
#         manual intervention to complete the rollback
#
# usage:
#   rhx aws.cloudformation.rollback --env prep
#   rhx aws.cloudformation.rollback --env prod
#   rhx aws.cloudformation.rollback --stack custom-stack-name
#   rhx aws.cloudformation.rollback help
#
# options:
#   --env ENV      environment: prep or prod
#   --stack NAME   explicit stack name (overrides --env)
#
# guarantee:
#   - exit 0 = rollback completed
#   - exit 1 = malfunction (rollback failed, aws error)
#   - exit 2 = constraint (absent args, bad env)
######################################################################
set -euo pipefail

# help
if [[ "${1:-}" == "help" || "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  echo "🐈 heres the deal..."
  echo ""
  echo "⛵ aws.cloudformation.rollback"
  echo ""
  echo "usage:"
  echo "  rhx aws.cloudformation.rollback --env <env>"
  echo "  rhx aws.cloudformation.rollback --stack <name>"
  echo ""
  echo "options:"
  echo "  --env    environment: prep or prod"
  echo "  --stack  explicit stack name (overrides --env)"
  exit 0
fi

# clear extant AWS_PROFILE to avoid interference
unset AWS_PROFILE 2>/dev/null || true

# parse arguments
ENV=""
STACK=""
while [[ $# -gt 0 ]]; do
  case $1 in
    --env)
      ENV="$2"
      shift 2
      ;;
    --stack)
      STACK="$2"
      shift 2
      ;;
    --skill|--repo|--role)
      shift 2  # skip rhx passthrough args
      ;;
    --)
      shift
      ;;
    help|--help|-h)
      echo "🐈 heres the deal..."
      echo ""
      echo "⛵ aws.cloudformation.rollback"
      echo ""
      echo "usage:"
      echo "  rhx aws.cloudformation.rollback --env <env>"
      echo "  rhx aws.cloudformation.rollback --stack <name>"
      echo ""
      echo "options:"
      echo "  --env    environment: prep or prod"
      echo "  --stack  explicit stack name (overrides --env)"
      exit 0
      ;;
    *)
      echo "🐈 belay that..."
      echo ""
      echo "⛵ aws.cloudformation.rollback"
      echo "   ├─ unknown argument: $1"
      echo "   └─ use --help for usage"
      exit 2
      ;;
  esac
done

# get service name from package.json
GIT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo ".")
SERVICE=$(jq -r '.name' "$GIT_ROOT/package.json")
if [[ -z "$SERVICE" || "$SERVICE" == "null" ]]; then
  echo "🐈 belay that..."
  echo ""
  echo "⛵ aws.cloudformation.rollback"
  echo "   └─ could not read 'name' from package.json"
  exit 2
fi

# determine stack name and keyrack env
if [[ -n "$STACK" ]]; then
  STACK_NAME="$STACK"
  KEYRACK_ENV="prep"
elif [[ -n "$ENV" ]]; then
  case "$ENV" in
    prep) STACK_NAME="${SERVICE}-dev" ;;
    prod) STACK_NAME="${SERVICE}-prod" ;;
    *)
      echo "🐈 belay that..."
      echo ""
      echo "⛵ aws.cloudformation.rollback"
      echo "   ├─ invalid env: $ENV"
      echo "   └─ must be: prep or prod"
      exit 2
      ;;
  esac
  KEYRACK_ENV="$ENV"
else
  echo "🐈 belay that..."
  echo ""
  echo "⛵ aws.cloudformation.rollback"
  echo "   └─ --env or --stack is required"
  exit 2
fi

# prod gate: prod rollbacks mutate prod and require a deploy.uses grant
if [[ "$ENV" == "prod" ]]; then
  DEPLOYER_SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  bash "$DEPLOYER_SKILL_DIR/uses._.check.sh" --meter deploy.uses --env prod || exit $?
fi

echo "🐈 chartin course..."
echo ""
echo "⛵ aws.cloudformation.rollback --stack $STACK_NAME"
echo "   └─ stack: $STACK_NAME"
echo ""

# source aws credentials from keyrack
AWS_PROFILE=$(rhx keyrack get --owner ehmpath --env "$KEYRACK_ENV" --key AWS_PROFILE --value || echo "")
if [[ -z "$AWS_PROFILE" ]]; then
  echo "🐈 wet paws..."
  echo ""
  echo "⛵ aws.cloudformation.rollback"
  echo "   ├─ absent AWS_PROFILE from keyrack for env=$KEYRACK_ENV"
  echo "   └─ hint: rhx keyrack unlock --owner ehmpath --env $KEYRACK_ENV"
  exit 1
fi

# export credentials
if ! eval "$(aws configure export-credentials --profile "$AWS_PROFILE" --format env)"; then
  echo "🐈 wet paws..."
  echo ""
  echo "⛵ aws.cloudformation.rollback"
  echo "   ├─ absent credentials from profile $AWS_PROFILE"
  echo "   └─ hint: aws sso login --profile $AWS_PROFILE"
  exit 1
fi
unset AWS_PROFILE AWS_DEFAULT_PROFILE

echo "   continue rollback..."
aws cloudformation continue-update-rollback --stack-name "$STACK_NAME"

echo ""
echo "   events"

# track last seen event to avoid duplicates
LAST_SEEN=""
while true; do
  # get current stack status
  STACK_STATUS=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" \
    --query 'Stacks[0].StackStatus' --output text)

  # get recent events
  EVENTS=$(aws cloudformation describe-stack-events --stack-name "$STACK_NAME" \
    --max-items 10 --output json)

  # show new events (in reverse order so oldest first)
  echo "$EVENTS" | jq -r --arg last "$LAST_SEEN" '
    .StackEvents
    | reverse
    | .[]
    | select($last == "" or .Timestamp > $last)
    | (.Timestamp | split(".")[0] + "Z" | sub("T"; " ")) + " " +
      .LogicalResourceId + " " + .ResourceStatus
  ' | while read -r line; do
    if [[ -n "$line" ]]; then
      echo "   ├─ $line"
    fi
  done

  # update last seen
  NEWEST=$(echo "$EVENTS" | jq -r '.StackEvents[0].Timestamp // empty')
  if [[ -n "$NEWEST" ]]; then
    LAST_SEEN="$NEWEST"
  fi

  # check if done
  case "$STACK_STATUS" in
    UPDATE_ROLLBACK_COMPLETE|ROLLBACK_COMPLETE|CREATE_COMPLETE|UPDATE_COMPLETE)
      echo "   └─ $STACK_STATUS"
      break
      ;;
    *FAILED*)
      echo "   └─ $STACK_STATUS"
      echo ""
      echo "🐈 wet paws..."
      echo ""
      echo "⛵ aws.cloudformation.rollback"
      echo "   └─ rollback failed"
      exit 1
      ;;
  esac

  sleep 3
done

echo ""
echo "🐈 smooth sailin!"
echo ""
echo "⛵ aws.cloudformation.rollback --stack $STACK_NAME"
echo "   └─ rolled back"
