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

# require a value for a flag — belay fast when the next token cannot serve as the value.
# the same helper, message and value-set hint as every kin deployer skill
# (rule.require.consistent-skill-contracts).
#
# it rejects TWO shapes, and the second is the subtle one:
#   1. absent — the flag was the last arg. without this, set -u trips a cryptic
#      unbound-variable crash instead of a helpful message
#   2. a FLAG token — `--env --stack x` would otherwise set ENV='--stack' and eat the next
#      flag whole, so the run belays about the WRONG flag
require_val() {
  # $1 = flag name, $2 = the candidate value (pass "${2:-}" from the case),
  # $3 = optional comma-joined valid set, for flags whose values are a closed enum
  if [[ -z "$2" || "$2" == --* ]]; then
    echo "🐈 belay that..."
    echo ""
    echo "⛵ aws.cloudformation.rollback"
    echo "   ├─ absent value for $1"
    [[ -n "${3:-}" ]] && echo "   ├─ fix: pass one of $3"
    echo "   └─ hint: rhx aws.cloudformation.rollback help"
    exit 2
  fi
}

# parse arguments
ENV=""
STACK=""
while [[ $# -gt 0 ]]; do
  case $1 in
    --env)
      require_val --env "${2:-}" "prep,prod"
      ENV="$2"
      shift 2
      ;;
    --stack)
      # no value set named: a stack name is free-form, and a fabricated set would mislead
      require_val --stack "${2:-}"
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

echo "🐈 chartin course..."
echo ""
echo "⛵ aws.cloudformation.rollback --stack $STACK_NAME"
echo "   ├─ stack: $STACK_NAME"

# prod gate: prod rollbacks mutate prod and require a deploy.uses grant. framed in this
# skill's own treestruct sub.bucket, under a labeled item
# (rule.require.nest-subskill-output-in-buckets).
if [[ "$ENV" == "prod" ]]; then
  DEPLOYER_SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  # reach the nest helper PACKAGE-relatively, via BASH_SOURCE — never through
  # `git rev-parse --show-toplevel`, which resolves to the CONSUMER's repo root.
  OPERATOR_SKILL_DIR="$(cd "$DEPLOYER_SKILL_DIR/../../operator/skills" && pwd)"
  source "$OPERATOR_SKILL_DIR/_.nest.sh"
  echo "   ├─ check the gate..."
  # _or_belay, not `|| exit $?`: a blocked gate must close THIS tree and state the
  # verdict at column 0, never exit mid-frame and leave the ⛵ tree half-drawn.
  run_sub_bucket_or_belay "   │  " "⛵ aws.cloudformation.rollback" "blocked at the gate" \
    bash "$DEPLOYER_SKILL_DIR/uses._.check.sh" --meter deploy.uses --env prod
fi

# a `├─` continuation, never a `└─`: the credential step, the rollback call, and the
# event stream all still follow. this line used to close the tree, after which four more
# blocks were printed under a tree that had already ended — two of them (`   continue
# rollback...`, `   events`) with no branch glyph at all.
echo "   ├─ eyes on target..."

# source aws credentials from keyrack
AWS_PROFILE=$(rhx keyrack get --owner ehmpath --env "$KEYRACK_ENV" --key AWS_PROFILE --value || echo "")
if [[ -z "$AWS_PROFILE" ]]; then
  echo "   └─ halted: absent credentials"
  echo ""
  echo "🐈 wet paws..."
  echo ""
  echo "⛵ aws.cloudformation.rollback"
  echo "   ├─ absent AWS_PROFILE from keyrack for env=$KEYRACK_ENV"
  echo "   └─ hint: rhx keyrack unlock --owner ehmpath --env $KEYRACK_ENV"
  exit 1
fi

# export credentials
if ! eval "$(aws configure export-credentials --profile "$AWS_PROFILE" --format env)"; then
  echo "   └─ halted: absent credentials"
  echo ""
  echo "🐈 wet paws..."
  echo ""
  echo "⛵ aws.cloudformation.rollback"
  echo "   ├─ absent credentials from profile $AWS_PROFILE"
  echo "   └─ hint: aws sso login --profile $AWS_PROFILE"
  exit 1
fi
unset AWS_PROFILE AWS_DEFAULT_PROFILE

# `continue-update-rollback` answers with NO output on success — it is a silent command,
# not a render, so a bucket around it would frame an empty child, which is the defect
# rule.require.nest-subskill-output-in-buckets names under `.a bucket must never frame an
# empty child`. the honest treatment for a silent child is to capture it and speak for it:
# a tree item on success, a closed tree plus the captured error on failure.
#
# on failure aws DOES speak, on stderr — so capture both streams. an un-captured error
# here landed at column 0 in the middle of this tree, beside a `set -e` exit that left
# the ⛵ tree open with no close at all.
echo "   ├─ anchors away!"
if ! ROLLBACK_SAID="$(aws cloudformation continue-update-rollback --stack-name "$STACK_NAME" 2>&1)"; then
  echo "   └─ halted: aws rejected the rollback"
  echo ""
  echo "🐈 wet paws..."
  echo ""
  echo "⛵ aws.cloudformation.rollback"
  echo "   ├─ stack: $STACK_NAME"
  while IFS= read -r said; do
    [[ -n "$said" ]] && echo "   ├─ $said"
  done <<< "$ROLLBACK_SAID"
  echo "   └─ hint: rhx aws.cloudformation.status --stack $STACK_NAME"
  exit 1
fi
echo "   ├─ rollback continued"

echo "   ├─ events"

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
      # `halted:`, per the close-line vocabulary — a non-zero exit that closes an open tree
      # names its OUTCOME with the word that matches its exit code
      # (rule.require.consistent-skill-contracts). this used to close with the bare status,
      # which reads as one more event item rather than as the end of the run.
      echo "   └─ halted: $STACK_STATUS"
      echo ""
      echo "🐈 wet paws..."
      echo ""
      echo "⛵ aws.cloudformation.rollback"
      echo "   ├─ stack: $STACK_NAME"
      echo "   ├─ final status: $STACK_STATUS"
      # the old belay closed on a bare `rollback failed` and named no fix at all — a symptom
      # with no next move (rule.require.errors-name-the-fix).
      echo "   └─ hint: rhx aws.cloudformation.status --stack $STACK_NAME"
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
