#!/usr/bin/env bash
######################################################################
# ⛵ aws.cloudformation.status — check cloudformation stack status
#
# .what = shows stack status and failed events with reasons
#
# .why  = diagnose deploy failures by show stack state and
#         recent failed events with their reasons
#
# usage:
#   rhx aws.cloudformation.status --env prep
#   rhx aws.cloudformation.status --env prod
#   rhx aws.cloudformation.status --stack custom-stack-name
#   rhx aws.cloudformation.status help
#
# options:
#   --env ENV      environment: prep or prod
#   --stack NAME   explicit stack name (overrides --env)
#
# guarantee:
#   - exit 0 = status retrieved
#   - exit 1 = malfunction (aws error, stack not found)
#   - exit 2 = constraint (absent args, bad env)
######################################################################
set -euo pipefail

# help
if [[ "${1:-}" == "help" || "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  echo "🐈 heres the deal..."
  echo ""
  echo "⛵ aws.cloudformation.status"
  echo ""
  echo "usage:"
  echo "  rhx aws.cloudformation.status --env <env>"
  echo "  rhx aws.cloudformation.status --stack <name>"
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
      echo "⛵ aws.cloudformation.status"
      echo ""
      echo "usage:"
      echo "  rhx aws.cloudformation.status --env <env>"
      echo "  rhx aws.cloudformation.status --stack <name>"
      echo ""
      echo "options:"
      echo "  --env    environment: prep or prod"
      echo "  --stack  explicit stack name (overrides --env)"
      exit 0
      ;;
    *)
      echo "🐈 belay that..."
      echo ""
      echo "⛵ aws.cloudformation.status"
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
  echo "⛵ aws.cloudformation.status"
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
      echo "⛵ aws.cloudformation.status"
      echo "   ├─ invalid env: $ENV"
      echo "   └─ must be: prep or prod"
      exit 2
      ;;
  esac
  KEYRACK_ENV="$ENV"
else
  echo "🐈 belay that..."
  echo ""
  echo "⛵ aws.cloudformation.status"
  echo "   └─ --env or --stack is required"
  exit 2
fi

echo "🐈 chartin course..."
echo ""
echo "⛵ aws.cloudformation.status --stack $STACK_NAME"
echo "   └─ stack: $STACK_NAME"

# source aws credentials from keyrack
AWS_PROFILE=$(rhx keyrack get --owner ehmpath --env "$KEYRACK_ENV" --key AWS_PROFILE --value || echo "")
if [[ -z "$AWS_PROFILE" ]]; then
  echo "🐈 wet paws..."
  echo ""
  echo "⛵ aws.cloudformation.status"
  echo "   ├─ absent AWS_PROFILE from keyrack for env=$KEYRACK_ENV"
  echo "   └─ hint: rhx keyrack unlock --owner ehmpath --env $KEYRACK_ENV"
  exit 1
fi

# export credentials
if ! eval "$(aws configure export-credentials --profile "$AWS_PROFILE" --format env)"; then
  echo "🐈 wet paws..."
  echo ""
  echo "⛵ aws.cloudformation.status"
  echo "   ├─ absent credentials from profile $AWS_PROFILE"
  echo "   └─ hint: aws sso login --profile $AWS_PROFILE"
  exit 1
fi
unset AWS_PROFILE AWS_DEFAULT_PROFILE

# get stack status
STACK_JSON=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --output json)
STACK_STATUS=$(echo "$STACK_JSON" | jq -r '.Stacks[0].StackStatus')
STACK_REASON=$(echo "$STACK_JSON" | jq -r '.Stacks[0].StackStatusReason // empty')

echo "   status"
echo "   ├─ stack: $STACK_NAME"
echo "   ├─ status: $STACK_STATUS"
if [[ -n "$STACK_REASON" ]]; then
  echo "   └─ reason: $STACK_REASON"
else
  echo "   └─ reason: (none)"
fi

# get failed events
echo ""
echo "   failed events"
EVENTS_JSON=$(aws cloudformation describe-stack-events --stack-name "$STACK_NAME" --max-items 50 --output json)
FAILED_COUNT=$(echo "$EVENTS_JSON" | jq '[.StackEvents[] | select(.ResourceStatus | contains("FAILED"))] | length')

if [[ "$FAILED_COUNT" == "0" ]]; then
  echo "   └─ (none)"
else
  echo "$EVENTS_JSON" | jq -r --argjson total "$FAILED_COUNT" '
    [.StackEvents[] | select(.ResourceStatus | contains("FAILED"))]
    | to_entries[]
    | .key as $idx
    | .value as $ev
    | ($ev.Timestamp | split(".")[0] + "Z" | sub("T"; " ")) as $time
    | ($ev.ResourceStatusReason // "(no reason)" | gsub("\n"; " ")) as $reason
    | if $idx == ($total - 1) then
        "   └─ " + $time + " " + $ev.LogicalResourceId + " (" + $ev.ResourceStatus + ")\n" +
        "      └─ " + $reason
      else
        "   ├─ " + $time + " " + $ev.LogicalResourceId + " (" + $ev.ResourceStatus + ")\n" +
        "   │  └─ " + $reason
      end
  '
fi

echo ""
echo "🐈 smooth sailin!"
