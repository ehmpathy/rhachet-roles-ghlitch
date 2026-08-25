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

# require a value for a flag — belay fast when the next token cannot serve as the value.
# the same helper, message and value-set hint as every kin skill
# (rule.require.consistent-skill-contracts).
#
# it rejects TWO shapes, and the second is the subtle one:
#   1. absent — the flag was the last arg. without this, set -u trips a cryptic
#      unbound-variable crash instead of a helpful message
#   2. a FLAG token — `--env --metric Errors` would otherwise set ENV='--metric' and eat
#      the next flag whole, so the run belays about the WRONG flag
require_val() {
  # $1 = flag name, $2 = the candidate value (pass "${2:-}" from the case),
  # $3 = optional comma-joined valid set, for flags whose values are a closed enum
  if [[ -z "$2" || "$2" == --* ]]; then
    echo "🐈 belay that..."
    echo ""
    echo "🔮 aws.cloudwatch.metrics.query"
    echo "   ├─ absent value for $1"
    [[ -n "${3:-}" ]] && echo "   ├─ fix: pass one of $3"
    echo "   └─ hint: rhx aws.cloudwatch.metrics.query help"
    exit 2
  fi
}

# parse named args
while [[ $# -gt 0 ]]; do
  case $1 in
    --env)
      require_val --env "${2:-}" "test,prep,prod"
      ENV="$2"
      shift 2
      ;;
    --since)
      require_val --since "${2:-}" "1d,7d,30d,1h,24h"
      SINCE="$2"
      shift 2
      ;;
    --metric)
      # no value set named: the valid metrics differ per namespace, and one flat list
      # would name metrics that are invalid for the namespace in play
      require_val --metric "${2:-}"
      METRIC="$2"
      shift 2
      ;;
    --lambda)
      require_val --lambda "${2:-}"
      LAMBDA="$2"
      shift 2
      ;;
    --queue)
      require_val --queue "${2:-}"
      QUEUE="$2"
      shift 2
      ;;
    --namespace)
      require_val --namespace "${2:-}" "lambda,sqs"
      NAMESPACE="$2"
      shift 2
      ;;
    --prefix)
      require_val --prefix "${2:-}"
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

# --namespace decides which whole branch runs below, and it had NO validation at all: an
# unknown value silently took the lambda branch, because that branch is the `else`. so
# `--namespace sqz` reported lambda metrics under an sqs-shaped question
# (rule.forbid.unexpected-defaults).
if [[ "$NAMESPACE" != "lambda" && "$NAMESPACE" != "sqs" ]]; then
  echo "🐈 belay that..."
  echo ""
  echo "🔮 aws.cloudwatch.metrics.query"
  echo "   ├─ invalid namespace: $NAMESPACE"
  echo "   └─ must be: lambda or sqs"
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
# a `├─` continuation, never a `└─`: the poll step and the whole result table still follow.
# this line used to close the tree on its last ARG, after which two glyph-less strays
# (`   poll N queues...`, `   poll N lambdas...`) and a `━━━`-ruled table were printed under
# a tree that had already ended.
echo "   ├─ since: $SINCE ($START_TIME to $END_TIME)"

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

  # dedupe and sort.
  #
  # the `-gt 0` guard carries weight; it is not defensive noise. `printf '%s\n'` with NO
  # arguments still prints one newline, so an EMPTY array piped through here comes back with
  # one empty-string element in it. the count below then read 1, the "no queues" belay was
  # unreachable, and the run rendered a phantom queue with a `0` datapoint as if it had found
  # a real one.
  if [[ ${#QUEUES[@]} -gt 0 ]]; then
    mapfile -t QUEUES < <(printf '%s\n' "${QUEUES[@]}" | sort -u)
  fi

  # filter by queue name if specified
  if [[ -n "$QUEUE" && ${#QUEUES[@]} -gt 0 ]]; then
    mapfile -t QUEUES < <(printf '%s\n' "${QUEUES[@]}" | grep -i "$QUEUE" || true)
  fi

  if [[ ${#QUEUES[@]} -eq 0 ]]; then
    # the header tree is already open, so close it before the belay. `halted:` because the
    # exit is 1 (rule.require.consistent-skill-contracts).
    echo "   └─ halted: no queues to poll"
    echo ""
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

  echo "   ├─ polled ${#QUEUES[@]} queues"

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
      # the header tree is already open; close it before the belay
      echo "   └─ halted: lambda not found"
      echo ""
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
    # the header tree is already open; close it before the belay
    echo "   └─ halted: no lambdas to poll"
    echo ""
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

  echo "   ├─ polled ${#LAMBDA_MAP[@]} lambdas"

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

# ── the results ─────────────────────────────────────────────────────────────────────
# the results are the tree's CLOSING item and its children, never a detached table.
#
# they used to render as a `━━━`-ruled block at column 0, below a tree that had closed six
# lines earlier — three rulers, a printf header row, a dashed underline and a TOTAL line,
# not one of them a mascot, a header, or a tree item. the ruled form also cost the reader
# what the frame gives for free: which run these numbers belong to.
RESOURCE_TYPE="Lambda"
if [[ "$NAMESPACE" == "sqs" ]]; then
  RESOURCE_TYPE="Queue"
fi
echo "   └─ $METRIC by $RESOURCE_TYPE"

# sort by count, highest first. each row is a child at 6 spaces; the TOTAL takes the `└─`,
# so every measured row above it is a `├─` — which is also why the total is rendered last
# rather than merely printed last.
SORTED=$(echo "$RESULTS" | grep -v '^$' | sort -rn)
POLLED=0
while IFS= read -r row; do
  [[ -z "$row" ]] && continue
  printf '      ├─ %s\n' "$row"
  POLLED=$((POLLED + 1))
done <<< "$SORTED"

TOTAL=$(echo "$SORTED" | awk '{sum+=$1} END {printf "%.0f", sum}')
printf '      └─ %12.0f  TOTAL\n' "$TOTAL"

# the close states the ANSWER, never merely that a poll occurred. it used to read a bare
# `observed`, which told a human that the skill ran but not one thing it learned — so the
# human had to scroll back up the table to find the number they had asked for.
echo ""
echo "🐈 caught it!"
echo ""
echo "🔮 aws.cloudwatch.metrics.query --env $ENV --namespace $NAMESPACE"
if [[ -n "$USED_ALIAS" ]]; then
  echo "   ├─ $TOTAL $METRIC across $POLLED $RESOURCE_TYPE"
  echo "   └─ (found via historic -$USED_ALIAS alias)"
else
  echo "   └─ $TOTAL $METRIC across $POLLED $RESOURCE_TYPE"
fi
