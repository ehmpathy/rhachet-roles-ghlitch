#!/usr/bin/env bash
######################################################################
# 🔮 aws.cloudwatch.metrics.query — query lambda/sqs metrics via cloudwatch
#
# .what = queries CloudWatch metrics for lambdas or SQS queues
#
# .why  = enables quick access to lambda/sqs stats:
#         - count api calls per endpoint
#         - identify high/low traffic endpoints
#         - check dlq depths for failed tasks
#         - prioritize acceptance test coverage
#
# usage:
#   rhx aws.cloudwatch.metrics.query --env prod                    # 7d invocations, all lambdas
#   rhx aws.cloudwatch.metrics.query --env prod --since 30d        # 30d invocations
#   rhx aws.cloudwatch.metrics.query --env prod --metric Errors    # error counts
#   rhx aws.cloudwatch.metrics.query --env prep --lambda createJob # single lambda
#   rhx aws.cloudwatch.metrics.query --env prod --namespace sqs    # sqs queue metrics
#   rhx aws.cloudwatch.metrics.query --env prod --namespace sqs --metric ApproximateNumberOfMessagesVisible
#   rhx aws.cloudwatch.metrics.query --env prod --namespace sqs --queue derive-job-facts
#   rhx aws.cloudwatch.metrics.query help
#
# options:
#   --env ENV       environment: test, prep, or prod (required)
#   --since TIME    how far back to query (default: 7d) - e.g., 1d, 7d, 30d
#   --metric NAME   metric name (default: Invocations for lambda, ApproximateNumberOfMessagesVisible for sqs)
#   --lambda NAME   single lambda to query (default: all)
#   --queue NAME    filter queues by name (partial match, default: all)
#   --namespace NS  namespace: lambda (default), sqs
#   --prefix PREFIX service prefix (default: from package.json)
#
# guarantee:
#   - exit 0 = query completed
#   - exit 1 = malfunction (aws error, connection failure)
#   - exit 2 = constraint (absent args, bad env)
######################################################################
set -euo pipefail

# get git root
GIT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo ".")

# derive prefix from package.json
PREFIX=$(jq -r '.name' "$GIT_ROOT/package.json" 2>/dev/null || echo "")
if [[ -z "$PREFIX" ]]; then
  echo "🐈 belay that..."
  echo ""
  echo "🔮 aws.cloudwatch.metrics.query"
  echo "   └─ could not read service name from package.json"
  exit 2
fi

# defaults
ENV=""
SINCE="7d"
METRIC=""
LAMBDA=""
QUEUE=""
NAMESPACE="lambda"
USED_ALIAS=""

# get environment suffixes to search
# for prep, returns "prep dev" (fallback to -dev as historic alias)
# for others, returns just the env
get_env_suffixes() {
  local env="$1"
  if [[ "$env" == "prep" ]]; then
    echo "prep dev"
  else
    echo "$env"
  fi
}

show_help() {
  cat << 'EOF'
🐈 heres the deal...

🔮 aws.cloudwatch.metrics.query

usage:
  rhx aws.cloudwatch.metrics.query --env prod                    # 7d invocations, all lambdas
  rhx aws.cloudwatch.metrics.query --env prod --since 30d        # 30d invocations
  rhx aws.cloudwatch.metrics.query --env prod --metric Errors    # error counts
  rhx aws.cloudwatch.metrics.query --env prep --lambda createJob # single lambda
  rhx aws.cloudwatch.metrics.query --env prod --namespace sqs    # sqs queue metrics
  rhx aws.cloudwatch.metrics.query --env prod --namespace sqs --queue dlq  # dlq queues only

options:
  --env ENV       environment: test, prep, or prod (required)
  --since TIME    how far back to query (default: 7d) - e.g., 1d, 7d, 30d
  --metric NAME   metric name
                    lambda: Invocations (default), Errors, Duration, Throttles
                    sqs: ApproximateNumberOfMessagesVisible (default), NumberOfMessagesSent, NumberOfMessagesReceived
  --lambda NAME   single lambda to query (default: all)
  --queue NAME    filter queues by name (partial match, default: all)
  --namespace NS  namespace: lambda (default), sqs
  --prefix PREFIX service prefix (default: from package.json)
  --help          show this help
EOF
  exit 0
}

# help
if [[ "${1:-}" == "help" || "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  show_help
fi

# parse named args
while [[ $# -gt 0 ]]; do
  case $1 in
    --env)
      ENV="$2"
      shift 2
      ;;
    --since)
      SINCE="$2"
      shift 2
      ;;
    --metric)
      METRIC="$2"
      shift 2
      ;;
    --lambda)
      LAMBDA="$2"
      shift 2
      ;;
    --queue)
      QUEUE="$2"
      shift 2
      ;;
    --namespace)
      NAMESPACE="$2"
      shift 2
      ;;
    --prefix)
      PREFIX="$2"
      shift 2
      ;;
    --repo|--role|--skill)
      # rhachet passthrough args - ignore
      shift 2
      ;;
    --)
      shift
      ;;
    help|--help|-h)
      show_help
      ;;
    *)
      echo "🐈 belay that..."
      echo ""
      echo "🔮 aws.cloudwatch.metrics.query"
      echo "   ├─ unknown option: $1"
      echo "   └─ use --help for usage"
      exit 2
      ;;
  esac
done

# set default metric based on namespace
if [[ -z "$METRIC" ]]; then
  if [[ "$NAMESPACE" == "sqs" ]]; then
    METRIC="ApproximateNumberOfMessagesVisible"
  else
    METRIC="Invocations"
  fi
fi

# validate required args
if [[ -z "$ENV" ]]; then
  echo "🐈 belay that..."
  echo ""
  echo "🔮 aws.cloudwatch.metrics.query"
  echo "   ├─ absent required arg: --env"
  echo "   └─ must be: test, prep, or prod"
  exit 2
fi

if [[ "$ENV" != "test" && "$ENV" != "prep" && "$ENV" != "prod" ]]; then
  echo "🐈 belay that..."
  echo ""
  echo "🔮 aws.cloudwatch.metrics.query"
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
    echo "🔮 aws.cloudwatch.metrics.query"
    echo "   ├─ absent AWS_PROFILE from keyrack for env=$ENV"
    echo "   └─ hint: rhx keyrack unlock --owner ehmpath --env $ENV"
    exit 1
  fi

  # export static credentials only — do NOT export AWS_PROFILE
  # AWS SDK prefers AWS_PROFILE over static creds, which causes SSO failures
  if ! eval "$(aws configure export-credentials --profile "$AWS_PROFILE" --format env)"; then
    echo "🐈 wet paws..."
    echo ""
    echo "🔮 aws.cloudwatch.metrics.query"
    echo "   ├─ absent credentials from profile $AWS_PROFILE"
    echo "   └─ hint: aws sso login --profile $AWS_PROFILE"
    exit 1
  fi
  unset AWS_PROFILE AWS_DEFAULT_PROFILE
fi

# convert since to seconds
convert_since_to_seconds() {
  local since="$1"
  if [[ "$since" =~ ^([0-9]+)d$ ]]; then
    echo $((${BASH_REMATCH[1]} * 24 * 60 * 60))
  elif [[ "$since" =~ ^([0-9]+)h$ ]]; then
    echo $((${BASH_REMATCH[1]} * 60 * 60))
  else
    echo "🐈 belay that..." >&2
    echo "" >&2
    echo "🔮 aws.cloudwatch.metrics.query" >&2
    echo "   ├─ invalid --since format: $since" >&2
    echo "   └─ use: 1d, 7d, 30d, 1h, 24h" >&2
    exit 2
  fi
}

SECONDS_AGO=$(convert_since_to_seconds "$SINCE")
END_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ)
START_TIME=$(date -u -d "@$(($(date +%s) - SECONDS_AGO))" +%Y-%m-%dT%H:%M:%SZ)

echo "🐈 chartin course..."
echo ""
echo "🔮 aws.cloudwatch.metrics.query --env $ENV --namespace $NAMESPACE"
echo "   ├─ env: $ENV"
echo "   ├─ prefix: $PREFIX"
echo "   ├─ namespace: $NAMESPACE"
echo "   ├─ metric: $METRIC"
echo "   └─ since: $SINCE ($START_TIME to $END_TIME)"
echo ""

RESULTS=""

if [[ "$NAMESPACE" == "sqs" ]]; then
  # get list of sqs queues (search all env suffixes)
  QUEUES=()
  for suffix in $(get_env_suffixes "$ENV"); do
    mapfile -t SUFFIX_QUEUES < <(aws sqs list-queues \
      --queue-name-prefix "$PREFIX-$suffix" \
      --query 'QueueUrls' \
      --output text | tr '\t' '\n' | xargs -I{} basename {} | sort)

    for q in "${SUFFIX_QUEUES[@]}"; do
      [[ -n "$q" ]] && QUEUES+=("$q")
    done

    # track if we found via alias
    if [[ "$suffix" != "$ENV" && ${#SUFFIX_QUEUES[@]} -gt 0 ]]; then
      USED_ALIAS="$suffix"
    fi
  done

  # dedupe and sort
  mapfile -t QUEUES < <(printf '%s\n' "${QUEUES[@]}" | sort -u)

  # filter by queue name if specified
  if [[ -n "$QUEUE" ]]; then
    mapfile -t QUEUES < <(printf '%s\n' "${QUEUES[@]}" | grep -i "$QUEUE" || true)
  fi

  if [[ ${#QUEUES[@]} -eq 0 ]]; then
    echo "🐈 wet paws..."
    echo ""
    echo "🔮 aws.cloudwatch.metrics.query"
    echo "   ├─ no queues found for $PREFIX-$ENV"
    if [[ "$ENV" == "prep" ]]; then
      echo "   └─ (also checked historic -dev alias)"
    else
      echo "   └─ check: aws sqs list-queues --queue-name-prefix $PREFIX-$ENV"
    fi
    exit 1
  fi

  echo "   poll ${#QUEUES[@]} queues..."
  echo ""

  # query each queue
  for queue in "${QUEUES[@]}"; do
    # sqs metrics use Maximum for point-in-time values
    STAT="Maximum"
    if [[ "$METRIC" == "NumberOfMessagesSent" || "$METRIC" == "NumberOfMessagesReceived" ]]; then
      STAT="Sum"
    fi

    RESULT=$(aws cloudwatch get-metric-statistics \
      --namespace AWS/SQS \
      --metric-name "$METRIC" \
      --dimensions "Name=QueueName,Value=$queue" \
      --start-time "$START_TIME" \
      --end-time "$END_TIME" \
      --period "$SECONDS_AGO" \
      --statistics "$STAT" \
      --query "Datapoints[0].$STAT" \
      --output text)

    if [[ "$RESULT" == "None" || -z "$RESULT" ]]; then
      RESULT="0"
    fi

    # strip prefix for display (try all possible suffixes)
    DISPLAY_NAME="$queue"
    for suffix in $(get_env_suffixes "$ENV"); do
      stripped="${queue#"$PREFIX-$suffix-"}"
      if [[ "$stripped" != "$queue" ]]; then
        DISPLAY_NAME="$stripped"
        break
      fi
    done
    RESULTS+=$(printf "%12.0f  %s\n" "$RESULT" "$DISPLAY_NAME")
    RESULTS+=$'\n'
  done

else
  # lambda namespace (default)
  # track full function names with their display names
  declare -A LAMBDA_MAP  # full_name -> display_name

  if [[ -n "$LAMBDA" ]]; then
    # single lambda: try with fallback
    FUNCTION_NAME=""
    for suffix in $(get_env_suffixes "$ENV"); do
      TEST_NAME="$PREFIX-$suffix-$LAMBDA"
      if aws lambda get-function --function-name "$TEST_NAME" --query 'Configuration.FunctionName' --output text >/dev/null 2>&1; then
        FUNCTION_NAME="$TEST_NAME"
        LAMBDA_MAP["$FUNCTION_NAME"]="$LAMBDA"
        if [[ "$suffix" != "$ENV" ]]; then
          USED_ALIAS="$suffix"
        fi
        break
      fi
    done
    if [[ -z "$FUNCTION_NAME" ]]; then
      echo "🐈 wet paws..."
      echo ""
      echo "🔮 aws.cloudwatch.metrics.query"
      echo "   ├─ lambda not found: $PREFIX-$ENV-$LAMBDA"
      if [[ "$ENV" == "prep" ]]; then
        echo "   └─ (also checked historic -dev alias)"
      else
        echo "   └─ check: aws lambda get-function --function-name $PREFIX-$ENV-$LAMBDA"
      fi
      exit 1
    fi
  else
    # list all lambdas (search all env suffixes)
    for suffix in $(get_env_suffixes "$ENV"); do
      mapfile -t SUFFIX_LAMBDAS < <(aws lambda list-functions \
        --query "Functions[?starts_with(FunctionName, \`$PREFIX-$suffix-\`)].FunctionName" \
        --output text | tr '\t' '\n' | sort)

      for full_name in "${SUFFIX_LAMBDAS[@]}"; do
        if [[ -n "$full_name" ]]; then
          # strip prefix for display
          display_name="${full_name#"$PREFIX-$suffix-"}"
          LAMBDA_MAP["$full_name"]="$display_name"
        fi
      done

      # track if we found via alias
      if [[ "$suffix" != "$ENV" && ${#SUFFIX_LAMBDAS[@]} -gt 0 ]]; then
        USED_ALIAS="$suffix"
      fi
    done
  fi

  if [[ ${#LAMBDA_MAP[@]} -eq 0 ]]; then
    echo "🐈 wet paws..."
    echo ""
    echo "🔮 aws.cloudwatch.metrics.query"
    echo "   ├─ no lambdas found for $PREFIX-$ENV"
    if [[ "$ENV" == "prep" ]]; then
      echo "   └─ (also checked historic -dev alias)"
    else
      echo "   └─ check: aws lambda list-functions"
    fi
    exit 1
  fi

  echo "   poll ${#LAMBDA_MAP[@]} lambdas..."
  echo ""

  for FUNCTION_NAME in "${!LAMBDA_MAP[@]}"; do
    lambda="${LAMBDA_MAP[$FUNCTION_NAME]}"

    RESULT=$(aws cloudwatch get-metric-statistics \
      --namespace AWS/Lambda \
      --metric-name "$METRIC" \
      --dimensions "Name=FunctionName,Value=$FUNCTION_NAME" \
      --start-time "$START_TIME" \
      --end-time "$END_TIME" \
      --period "$SECONDS_AGO" \
      --statistics Sum \
      --query 'Datapoints[0].Sum' \
      --output text)

    if [[ "$RESULT" == "None" || -z "$RESULT" ]]; then
      RESULT="0"
    fi

    RESULTS+=$(printf "%12.0f  %s\n" "$RESULT" "$lambda")
    RESULTS+=$'\n'
  done
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# sort by count (highest first) and display
RESOURCE_TYPE="Lambda"
if [[ "$NAMESPACE" == "sqs" ]]; then
  RESOURCE_TYPE="Queue"
fi
printf "%12s  %s\n" "$METRIC" "$RESOURCE_TYPE"
printf "%12s  %s\n" "────────────" "──────────────────────────────────────────────────────"
echo "$RESULTS" | grep -v '^$' | sort -rn

# summary
TOTAL=$(echo "$RESULTS" | grep -v '^$' | awk '{sum+=$1} END {printf "%.0f", sum}')
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
printf "%12.0f  TOTAL\n" "$TOTAL"

echo ""
echo "🐈 caught it!"
echo ""
echo "🔮 aws.cloudwatch.metrics.query"
if [[ -n "$USED_ALIAS" ]]; then
  echo "   ├─ observed"
  echo "   └─ (found via historic -$USED_ALIAS alias)"
else
  echo "   └─ observed"
fi
