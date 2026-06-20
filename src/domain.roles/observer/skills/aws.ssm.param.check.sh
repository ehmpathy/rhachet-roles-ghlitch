#!/usr/bin/env bash
######################################################################
# 🔮 aws.ssm.param.check — check if SSM parameters exist
#
# .what = diagnoses SSM parameter resolution failures
#
# .why  = diagnose sdk-config parameter resolution failures by
#         confirm parameters exist at expected paths
#
# usage:
#   rhx aws.ssm.param.check --env prep --name ahbode.svc-jobs.prep.database.role.crud.password
#   rhx aws.ssm.param.check --env prep --pattern 'ahbode.svc-jobs.prep.*'
#   rhx aws.ssm.param.check --env prep --from config/prep.json
#   rhx aws.ssm.param.check help
#
# options:
#   --env        environment: test, prep, or prod (required)
#   --name       single parameter name to check
#   --pattern    pattern to search (contains match)
#   --from       extract $.at(aws::param/...) refs from config file
#
# guarantee:
#   - exit 0 = check completed
#   - exit 1 = malfunction (aws error, credential failure)
#   - exit 2 = constraint (absent args, bad env, file not found)
######################################################################
set -euo pipefail

# help
if [[ "${1:-}" == "help" || "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  echo "🔮 aws.ssm.param.check"
  echo ""
  echo "usage:"
  echo "  rhx aws.ssm.param.check --env <env> --name <param>"
  echo "  rhx aws.ssm.param.check --env <env> --pattern <search>"
  echo "  rhx aws.ssm.param.check --env <env> --from <config.json>"
  echo ""
  echo "options:"
  echo "  --env      environment: test, prep, or prod"
  echo "  --name     single parameter name to check"
  echo "  --pattern  pattern to search (contains match)"
  echo "  --from     extract aws::param refs from config file"
  exit 0
fi

# parse arguments
ENV=""
NAME=""
PATTERN=""
FROM=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --env)
      ENV="$2"
      shift 2
      ;;
    --name)
      NAME="$2"
      shift 2
      ;;
    --pattern)
      PATTERN="$2"
      shift 2
      ;;
    --from)
      FROM="$2"
      shift 2
      ;;
    --skill|--repo|--role)
      shift 2
      ;;
    --)
      shift
      ;;
    help|--help|-h)
      echo "🐈 heres the deal..."
      echo ""
      echo "🔮 aws.ssm.param.check"
      echo ""
      echo "usage:"
      echo "  rhx aws.ssm.param.check --env <env> --name <name>"
      echo "  rhx aws.ssm.param.check --env <env> --pattern <pattern>"
      echo "  rhx aws.ssm.param.check --env <env> --from <file>"
      echo ""
      echo "options:"
      echo "  --env      environment: test, prep, or prod"
      echo "  --name     exact parameter name"
      echo "  --pattern  glob pattern with * wildcards"
      echo "  --from     file with parameter names"
      echo ""
      echo "patterns:"
      echo "  --pattern 'ahbode.svc-jobs.*'    # all svc-jobs params"
      echo "  --pattern 'ahbode.*.livedb.uri'  # livedb uri across services"
      exit 0
      ;;
    *)
      echo "🐈 belay that..."
      echo ""
      echo "🔮 aws.ssm.param.check"
      echo "   └─ unknown argument: $1"
      exit 2
      ;;
  esac
done

# validate env
if [[ -z "$ENV" ]]; then
  echo "🐈 belay that..."
  echo ""
  echo "🔮 aws.ssm.param.check"
  echo "   ├─ absent required arg: --env"
  echo "   └─ must be: test, prep, or prod"
  exit 2
fi

if [[ "$ENV" != "test" && "$ENV" != "prep" && "$ENV" != "prod" ]]; then
  echo "🐈 belay that..."
  echo ""
  echo "🔮 aws.ssm.param.check"
  echo "   ├─ invalid env: $ENV"
  echo "   └─ must be: test, prep, or prod"
  exit 2
fi

# source aws credentials from keyrack (skip if already set)
if [[ -z "${AWS_ACCESS_KEY_ID:-}" ]]; then
  AWS_PROFILE=$(rhx keyrack get --owner ehmpath --env "$ENV" --key AWS_PROFILE --value || echo "")
  if [[ -z "$AWS_PROFILE" ]]; then
    echo "🐈 wet paws..."
    echo ""
    echo "🔮 aws.ssm.param.check"
    echo "   ├─ absent AWS_PROFILE from keyrack for env=$ENV"
    echo "   └─ hint: rhx keyrack unlock --owner ehmpath --env $ENV"
    exit 1
  fi

  # export static credentials only
  if ! eval "$(aws configure export-credentials --profile "$AWS_PROFILE" --format env)"; then
    echo "🐈 wet paws..."
    echo ""
    echo "🔮 aws.ssm.param.check"
    echo "   ├─ absent credentials from profile $AWS_PROFILE"
    echo "   └─ hint: aws sso login --profile $AWS_PROFILE"
    exit 1
  fi
  unset AWS_PROFILE AWS_DEFAULT_PROFILE
fi

echo "🐈 chartin course..."
echo ""
echo "🔮 aws.ssm.param.check --env $ENV"
echo "   └─ env: $ENV"
echo ""

# check single parameter
check_param() {
  local param_name="$1"
  if aws ssm get-parameter --name "$param_name" --query 'Parameter.Name' --output text >/dev/null; then
    echo "   ✅ $param_name"
  else
    echo "   ❌ $param_name (not found)"
  fi
}

# mode: single name
if [[ -n "$NAME" ]]; then
  echo "   check parameter:"
  echo ""
  check_param "$NAME"
  echo ""
  echo "🐈 caught it!"
  echo ""
  echo "🔮 aws.ssm.param.check"
  echo "   └─ observed"
  exit 0
fi

# mode: pattern search
if [[ -n "$PATTERN" ]]; then
  echo "   parameters that match '$PATTERN':"
  echo ""
  params=$(aws ssm describe-parameters \
    --parameter-filters "Key=Name,Option=Contains,Values=$PATTERN" \
    --query 'Parameters[].Name' \
    --output text)

  if [[ -z "$params" ]]; then
    echo "   (none found)"
  else
    for p in $params; do
      echo "   ✅ $p"
    done
  fi
  echo ""
  echo "🐈 caught it!"
  echo ""
  echo "🔮 aws.ssm.param.check"
  echo "   └─ observed"
  exit 0
fi

# mode: extract from config file
if [[ -n "$FROM" ]]; then
  if [[ ! -f "$FROM" ]]; then
    echo "🐈 belay that..."
    echo ""
    echo "🔮 aws.ssm.param.check"
    echo "   └─ file not found: $FROM"
    exit 2
  fi

  echo "   parameters from $FROM:"
  echo ""

  # extract $.at(aws::param/...) references
  refs=$(grep -oE '\$\.at\(aws::param/[^)]+\)' "$FROM" | sed 's/\$\.at(aws::param\///' | sed 's/)//' | sort -u)

  if [[ -z "$refs" ]]; then
    echo "   (no aws::param references found)"
    echo ""
    echo "🐈 caught it!"
  echo ""
  echo "🔮 aws.ssm.param.check"
  echo "   └─ observed"
    exit 0
  fi

  for ref in $refs; do
    check_param "$ref"
  done
  echo ""
  echo "🐈 caught it!"
  echo ""
  echo "🔮 aws.ssm.param.check"
  echo "   └─ observed"
  exit 0
fi

echo "🐈 belay that..."
echo ""
echo "🔮 aws.ssm.param.check"
echo "   └─ must specify --name, --pattern, or --from"
exit 2
