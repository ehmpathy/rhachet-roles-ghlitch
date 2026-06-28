#!/usr/bin/env bash
######################################################################
# 🔮 aws.cloudwatch.logs.query — query cloudwatch logs for lambdas
#
# .what = searches cloudwatch logs via Logs Insights
#
# .why  = enables quick access to lambda logs for debug:
#         - diagnose failed requests
#         - trace request execution
#         - investigate errors in test/prep/prod
#
# usage:
#   rhx aws.cloudwatch.logs.query --list --env prod
#   rhx aws.cloudwatch.logs.query --lambda "cronTask" --env prod
#   rhx aws.cloudwatch.logs.query --lambda "cronTask" --env prod --since 1h
#   rhx aws.cloudwatch.logs.query --lambda "cronTask" --env prod --filter "ERROR"
#   rhx aws.cloudwatch.logs.query --prefix "svc-foo" --env prod --since 30m --filter "error"
#   rhx aws.cloudwatch.logs.query --prefix "svc-" --env prod --filter "abc123" --since 1h
#   rhx aws.cloudwatch.logs.query --prefix "svc-" --env prod --filter "abc123" --filter "FOO" --since 1h  # AND logic
#   rhx aws.cloudwatch.logs.query --env prod --query '@message like /foo/ or @message like /bar/' --since 1h
#   rhx aws.cloudwatch.logs.query help
#
# options:
#   --lambda NAME   lambda function name (without service prefix)
#   --prefix PREFIX search log groups by prefix (default: from package.json)
#                   if --lambda omitted, queries ALL log groups with prefix
#   --env ENV       environment: test, prep, or prod (required)
#   --since TIME    how far back to search (default: 1h) - e.g., 5m, 1h, 2d
#   --filter TERM   filter logs by term (case-insensitive, matches inside JSON)
#                   can be specified multiple times for AND logic
#   --query QUERY   raw Logs Insights filter clause (overrides --filter)
#   --limit N       max number of log events (default: 100)
#   --list          list available log groups instead of query
#   --tail          follow logs in real-time
#
# output:
#   - .agent/.cache/repo=ghlitch/role=observer/skills/aws.cloudwatch.logs.query/$isotimestamp.query.input.md
#   - .agent/.cache/repo=ghlitch/role=observer/skills/aws.cloudwatch.logs.query/$isotimestamp.query.output.json
#   - .agent/.cache/repo=ghlitch/role=observer/skills/aws.cloudwatch.logs.query/$isotimestamp.query.output.md
#
# guarantee:
#   - exit 0 = query completed
#   - exit 1 = malfunction (aws error, query failure)
#   - exit 2 = constraint (absent args, bad env)
######################################################################
set -euo pipefail

# get git root for output paths
GIT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo ".")

# help
if [[ "${1:-}" == "help" || "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  echo "🔮 aws.cloudwatch.logs.query"
  echo ""
  echo "usage:"
  echo "  rhx aws.cloudwatch.logs.query --lambda <name> --env <env>"
  echo "  rhx aws.cloudwatch.logs.query --prefix <prefix> --env <env>"
  echo "  rhx aws.cloudwatch.logs.query --list --env <env>"
  echo ""
  echo "options:"
  echo "  --lambda     lambda function name"
  echo "  --prefix     search log groups by prefix"
  echo "  --env        environment: test, prep, or prod"
  echo "  --since      how far back (default: 1h) - 5m, 1h, 2d"
  echo "  --filter     filter by term (can repeat for AND)"
  echo "  --query      raw Logs Insights filter clause"
  echo "  --limit      max events (default: 100)"
  echo "  --list       list available log groups"
  echo "  --tail       follow logs in real-time"
  exit 0
fi

# generate iso timestamp for output files
ISO_TIMESTAMP=$(date -u +"%Y-%m-%dT%H-%M-%SZ")

# output directory and file paths (standard skill cache dir)
OUTPUT_DIR="$GIT_ROOT/.agent/.cache/repo=ghlitch/role=observer/skills/aws.cloudwatch.logs.query"
OUTPUT_INPUT="$OUTPUT_DIR/$ISO_TIMESTAMP.query.input.md"
OUTPUT_JSON="$OUTPUT_DIR/$ISO_TIMESTAMP.query.output.json"
OUTPUT_MD="$OUTPUT_DIR/$ISO_TIMESTAMP.query.output.md"

# derive prefix from package.json
PREFIX=$(jq -r '.name' "$GIT_ROOT/package.json" 2>/dev/null || echo "")
if [[ -z "$PREFIX" ]]; then
  echo "🐈 belay that..."
  echo ""
  echo "🔮 aws.cloudwatch.logs.query"
  echo "   └─ absent service name from package.json"
  exit 2
fi

# defaults
ENV=""
LAMBDA=""
SINCE="1h"
FILTERS=()
CUSTOM_FILTER=""
LIMIT=100
LIST_ONLY=false
TAIL=false

# parse named args
while [[ $# -gt 0 ]]; do
  case $1 in
    --lambda)
      LAMBDA="$2"
      shift 2
      ;;
    --prefix)
      PREFIX="$2"
      shift 2
      ;;
    --env)
      ENV="$2"
      shift 2
      ;;
    --since)
      SINCE="$2"
      shift 2
      ;;
    --filter)
      FILTERS+=("$2")
      shift 2
      ;;
    --query)
      CUSTOM_FILTER="$2"
      shift 2
      ;;
    --limit)
      LIMIT="$2"
      shift 2
      ;;
    --list)
      LIST_ONLY=true
      shift
      ;;
    --tail)
      TAIL=true
      shift
      ;;
    --repo|--role|--skill)
      shift 2
      ;;
    --)
      shift
      ;;
    help|--help|-h)
      echo "🐈 heres the deal..."
      echo ""
      echo "🔮 aws.cloudwatch.logs.query"
      echo ""
      echo "usage:"
      echo "  rhx aws.cloudwatch.logs.query --lambda <name> --env <env>"
      echo "  rhx aws.cloudwatch.logs.query --prefix <prefix> --env <env>"
      echo "  rhx aws.cloudwatch.logs.query --list --env <env>"
      echo ""
      echo "options:"
      echo "  --lambda     lambda function name"
      echo "  --prefix     search log groups by prefix"
      echo "  --env        environment: test, prep, or prod"
      echo "  --since      how far back (default: 1h) - 5m, 1h, 2d"
      echo "  --filter     filter by term (can repeat for AND)"
      echo "  --query      raw Logs Insights filter clause"
      echo "  --limit      max events (default: 100)"
      echo "  --list       list available log groups"
      echo "  --tail       follow logs in real-time"
      exit 0
      ;;
    *)
      echo "🐈 belay that..."
      echo ""
      echo "🔮 aws.cloudwatch.logs.query"
      echo "   └─ unknown option: $1"
      exit 2
      ;;
  esac
done

# validate required args
if [[ -z "$ENV" ]]; then
  echo "🐈 belay that..."
  echo ""
  echo "🔮 aws.cloudwatch.logs.query"
  echo "   ├─ absent required arg: --env"
  echo "   └─ must be: test, prep, or prod"
  exit 2
fi

if [[ "$ENV" != "test" && "$ENV" != "prep" && "$ENV" != "prod" ]]; then
  echo "🐈 belay that..."
  echo ""
  echo "🔮 aws.cloudwatch.logs.query"
  echo "   ├─ invalid env: $ENV"
  echo "   └─ must be: test, prep, or prod"
  exit 2
fi

# validate --since format early (before expensive operations)
if [[ -n "$SINCE" && ! "$SINCE" =~ ^[0-9]+[mhd]$ ]]; then
  echo "🐈 belay that..."
  echo ""
  echo "🔮 aws.cloudwatch.logs.query"
  echo "   └─ invalid --since format: $SINCE (use 5m, 1h, 2d)"
  exit 2
fi

# validate --tail requires --lambda early (before expensive operations)
if [[ "$TAIL" == true && -z "$LAMBDA" ]]; then
  echo "🐈 belay that..."
  echo ""
  echo "🔮 aws.cloudwatch.logs.query --tail"
  echo "   ├─ --tail requires --lambda to specify a single log group"
  echo "   └─ hint: rhx aws.cloudwatch.logs.query --env $ENV --lambda <name> --tail"
  exit 2
fi

# source aws credentials from keyrack (skip if already set)
if [[ -z "${AWS_ACCESS_KEY_ID:-}" ]]; then
  AWS_PROFILE=$(rhx keyrack get --owner ehmpath --env "$ENV" --key AWS_PROFILE --value || echo "")
  if [[ -z "$AWS_PROFILE" ]]; then
    echo "🐈 wet paws..."
    echo ""
    echo "🔮 aws.cloudwatch.logs.query"
    echo "   ├─ absent AWS_PROFILE from keyrack for env=$ENV"
    echo "   └─ hint: rhx keyrack unlock --owner ehmpath --env $ENV"
    exit 1
  fi
  export AWS_PROFILE
fi

# convert since to seconds ago
convert_since_to_seconds() {
  local since="$1"
  local now_s=$(date +%s)

  if [[ "$since" =~ ^([0-9]+)m$ ]]; then
    echo $((now_s - ${BASH_REMATCH[1]} * 60))
  elif [[ "$since" =~ ^([0-9]+)h$ ]]; then
    echo $((now_s - ${BASH_REMATCH[1]} * 60 * 60))
  elif [[ "$since" =~ ^([0-9]+)d$ ]]; then
    echo $((now_s - ${BASH_REMATCH[1]} * 24 * 60 * 60))
  else
    echo "🐈 belay that..." >&2
    echo "" >&2
    echo "🔮 aws.cloudwatch.logs.query" >&2
    echo "   └─ invalid --since format: $since (use 5m, 1h, 2d)" >&2
    exit 2
  fi
}

# get env suffixes to search (prep aliases to both prep and dev)
# returns: space-separated list of suffixes to try
get_env_suffixes() {
  local env="$1"
  if [[ "$env" == "prep" ]]; then
    echo "prep dev"
  else
    echo "$env"
  fi
}

# write query input parameters to markdown
write_query_input() {
  mkdir -p "$OUTPUT_DIR"

  # findsert .gitignore
  if [[ ! -f "$OUTPUT_DIR/.gitignore" ]]; then
    cat > "$OUTPUT_DIR/.gitignore" << 'GITIGNORE'
# ignore all query outputs
*.json
*.md
!.gitignore
GITIGNORE
  fi

  local filter_display="(none)"
  local filter_query=""
  if [[ -n "$CUSTOM_FILTER" ]]; then
    filter_display="$CUSTOM_FILTER (raw)"
    filter_query="| filter $CUSTOM_FILTER"
  elif [[ ${#FILTERS[@]} -gt 0 ]]; then
    filter_display="${FILTERS[*]} (AND)"
    local parts=()
    for f in "${FILTERS[@]}"; do
      parts+=("@message like /(?i)$f/")
    done
    local joined="${parts[0]}"
    for ((i=1; i<${#parts[@]}; i++)); do
      joined="$joined and ${parts[$i]}"
    done
    filter_query="| filter $joined"
  fi

  cat > "$OUTPUT_INPUT" << EOF
# cloudwatch logs query input

## parameters

| parameter | value |
|-----------|-------|
| timestamp | $ISO_TIMESTAMP |
| log_group | $LOG_GROUP |
| env | $ENV |
| lambda | $LAMBDA |
| prefix | $PREFIX |
| since | $SINCE |
| filter | $filter_display |
| limit | $LIMIT |

## logs insights query

\`\`\`
fields @timestamp, @message
$filter_query
| sort @timestamp asc
| limit $LIMIT
\`\`\`
EOF
  echo "   ├─ input: $OUTPUT_INPUT"
}

# generate summary markdown from json output
generate_output_summary() {
  local json_file="$1"
  local md_file="$2"

  local event_count
  event_count=$(jq 'length' "$json_file")

  local first_timestamp=""
  local last_timestamp=""
  local error_count=0
  local warn_count=0

  if [[ "$event_count" -gt 0 ]]; then
    first_timestamp=$(jq -r '.[0].timestamp | . / 1000 | strftime("%Y-%m-%d %H:%M:%S UTC")' "$json_file")
    last_timestamp=$(jq -r '.[-1].timestamp | . / 1000 | strftime("%Y-%m-%d %H:%M:%S UTC")' "$json_file")
    error_count=$(jq '[.[] | select(.message | test("ERROR|Error|error"; "i"))] | length' "$json_file")
    warn_count=$(jq '[.[] | select(.message | test("WARN"; "i"))] | length' "$json_file")
  fi

  cat > "$md_file" << EOF
# cloudwatch logs query output

## summary

| metric | value |
|--------|-------|
| query timestamp | $ISO_TIMESTAMP |
| log group | $LOG_GROUP |
| time range | $SINCE |
| filter | ${FILTER_DISPLAY:-"(none)"} |
| total events | $event_count |
| errors | $error_count |
| warns | $warn_count |
| first event | ${first_timestamp:-"n/a"} |
| last event | ${last_timestamp:-"n/a"} |

## output files

- input: \`$OUTPUT_INPUT\`
- json: \`$OUTPUT_JSON\`
- summary: \`$OUTPUT_MD\`

EOF

  if [[ "$event_count" -gt 0 ]]; then
    cat >> "$md_file" << 'EOF'
## log preview (first 20 events)

```
EOF
    if jq -e '.[0].log' "$json_file" > /dev/null 2>&1; then
      jq -r '.[:20][] | "\(.timestamp | . / 1000 | strftime("%Y-%m-%d %H:%M:%S")) | \(.log | split("/")[-1]) | \(.message)"' "$json_file" >> "$md_file"
    else
      jq -r '.[:20][] | "\(.timestamp | . / 1000 | strftime("%Y-%m-%d %H:%M:%S")) | \(.message)"' "$json_file" >> "$md_file"
    fi
    cat >> "$md_file" << 'EOF'
```

EOF
  fi

  if [[ "$error_count" -gt 0 ]]; then
    cat >> "$md_file" << 'EOF'
## errors found

```
EOF
    if jq -e '.[0].log' "$json_file" > /dev/null 2>&1; then
      jq -r '[.[] | select(.message | test("ERROR|Error|error"; "i"))][:10][] | "\(.timestamp | . / 1000 | strftime("%Y-%m-%d %H:%M:%S")) | \(.log | split("/")[-1]) | \(.message)"' "$json_file" >> "$md_file"
    else
      jq -r '[.[] | select(.message | test("ERROR|Error|error"; "i"))][:10][] | "\(.timestamp | . / 1000 | strftime("%Y-%m-%d %H:%M:%S")) | \(.message)"' "$json_file" >> "$md_file"
    fi
    cat >> "$md_file" << 'EOF'
```
EOF
  fi

  echo "   └─ summary: $OUTPUT_MD"
}

# list log groups
if [[ "$LIST_ONLY" == true ]]; then
  echo "🐈 chartin course..."
  echo ""
  echo "🔮 aws.cloudwatch.logs.query --list --env $ENV"

  # collect log groups from all env suffixes
  ALL_GROUPS=()
  LIST_USED_ALIAS=""
  for suffix in $(get_env_suffixes "$ENV"); do
    mapfile -t SUFFIX_GROUPS < <(aws logs describe-log-groups \
      --log-group-name-prefix "/aws/lambda/$PREFIX-$suffix" \
      --query 'logGroups[].logGroupName' \
      --output text | tr '\t' '\n' | sed '/^$/d')
    ALL_GROUPS+=("${SUFFIX_GROUPS[@]}")

    # track if we found any via alias
    if [[ "$suffix" != "$ENV" && ${#SUFFIX_GROUPS[@]} -gt 0 ]]; then
      LIST_USED_ALIAS="$suffix"
    fi
  done

  # label the group set; fold alias hint into the label
  if [[ -n "$LIST_USED_ALIAS" ]]; then
    echo "   └─ log groups for $PREFIX-$ENV (includes historic -$LIST_USED_ALIAS alias)"
  else
    echo "   └─ log groups for $PREFIX-$ENV"
  fi

  # print groups as tree children under the label
  mapfile -t LIST_GROUPS < <(printf '%s\n' "${ALL_GROUPS[@]}" | sed '/^$/d' | sort -u)
  if [[ ${#LIST_GROUPS[@]} -eq 0 ]]; then
    echo "      └─ (none)"
  else
    for ((i=0; i<${#LIST_GROUPS[@]}; i++)); do
      if [[ $i -eq $((${#LIST_GROUPS[@]} - 1)) ]]; then
        echo "      └─ ${LIST_GROUPS[$i]}"
      else
        echo "      ├─ ${LIST_GROUPS[$i]}"
      fi
    done
  fi
  exit 0
fi

# determine log group(s) to query
MULTI_GROUP=false
USED_ALIAS=""
if [[ -n "$LAMBDA" ]]; then
  # try each env suffix until we find the log group
  LOG_GROUP=""
  for suffix in $(get_env_suffixes "$ENV"); do
    CANDIDATE="/aws/lambda/$PREFIX-$suffix-$LAMBDA"
    if aws logs describe-log-groups --log-group-name-prefix "$CANDIDATE" --query 'logGroups[0].logGroupName' --output text 2>/dev/null | grep -q "$CANDIDATE"; then
      LOG_GROUP="$CANDIDATE"
      if [[ "$suffix" != "$ENV" ]]; then
        USED_ALIAS="$suffix"
      fi
      break
    fi
  done

  if [[ -z "$LOG_GROUP" ]]; then
    echo "🐈 belay that..."
    echo ""
    echo "🔮 aws.cloudwatch.logs.query"
    echo "   ├─ log group not found: /aws/lambda/$PREFIX-$ENV-$LAMBDA"
    echo "   └─ available log groups:"
    # collect log groups; show errors if aws cli fails
    AVAILABLE_GROUPS=""
    for suffix in $(get_env_suffixes "$ENV"); do
      if SUFFIX_OUTPUT=$(aws logs describe-log-groups \
        --log-group-name-prefix "/aws/lambda/$PREFIX-$suffix" \
        --query 'logGroups[].logGroupName' \
        --output text 2>&1); then
        AVAILABLE_GROUPS+=$(echo "$SUFFIX_OUTPUT" | tr '\t' '\n')$'\n'
      else
        echo "      (error: could not list -$suffix log groups: $SUFFIX_OUTPUT)" >&2
      fi
    done
    # print as tree children under the "available log groups" node
    mapfile -t GROUP_LIST < <(echo "$AVAILABLE_GROUPS" | sed '/^$/d' | sort -u | head -20)
    if [[ ${#GROUP_LIST[@]} -eq 0 ]]; then
      echo "      └─ (none)"
    else
      for ((i=0; i<${#GROUP_LIST[@]}; i++)); do
        if [[ $i -eq $((${#GROUP_LIST[@]} - 1)) ]]; then
          echo "      └─ ${GROUP_LIST[$i]}"
        else
          echo "      ├─ ${GROUP_LIST[$i]}"
        fi
      done
    fi
    exit 2
  fi

  LOG_GROUPS=("$LOG_GROUP")
else
  MULTI_GROUP=true

  # collect log groups from all env suffixes
  ALL_GROUPS=()
  for suffix in $(get_env_suffixes "$ENV"); do
    mapfile -t SUFFIX_GROUPS < <(aws logs describe-log-groups \
      --log-group-name-prefix "/aws/lambda/$PREFIX-$suffix" \
      --query 'logGroups[].logGroupName' \
      --output text | tr '\t' '\n' | sed '/^$/d')
    ALL_GROUPS+=("${SUFFIX_GROUPS[@]}")

    # track if we found any via alias
    if [[ "$suffix" != "$ENV" && ${#SUFFIX_GROUPS[@]} -gt 0 ]]; then
      USED_ALIAS="$suffix"
    fi
  done

  # dedupe, sort, and filter empty strings
  mapfile -t LOG_GROUPS < <(printf '%s\n' "${ALL_GROUPS[@]}" | sed '/^$/d' | sort -u)

  if [[ ${#LOG_GROUPS[@]} -eq 0 ]]; then
    echo "🐈 belay that..."
    echo ""
    echo "🔮 aws.cloudwatch.logs.query"
    echo "   └─ no log groups found with prefix: /aws/lambda/$PREFIX-$ENV"
    exit 2
  fi

  if [[ "$ENV" == "prep" ]]; then
    LOG_GROUP="/aws/lambda/$PREFIX-{prep,dev} (all)"
  else
    LOG_GROUP="/aws/lambda/$PREFIX-$ENV (all)"
  fi

  # pluralize "group" based on count
  GROUP_NOUN="log group"
  if [[ ${#LOG_GROUPS[@]} -ne 1 ]]; then
    GROUP_NOUN="log groups"
  fi

  echo "🐈 chartin course..."
  echo ""
  echo "🔮 aws.cloudwatch.logs.query --env $ENV"
  if [[ -n "$USED_ALIAS" ]]; then
    echo "   ├─ found ${#LOG_GROUPS[@]} $GROUP_NOUN"
    echo "   └─ (includes historic -$USED_ALIAS alias)"
  else
    echo "   └─ found ${#LOG_GROUPS[@]} $GROUP_NOUN with prefix /aws/lambda/$PREFIX-$ENV"
  fi
fi

echo ""
echo "🔮 aws.cloudwatch.logs.query"
if [[ -n "$USED_ALIAS" && "$MULTI_GROUP" == false ]]; then
  echo "   ├─ log group: $LOG_GROUP"
  echo "   ├─ (found via historic -$USED_ALIAS alias)"
else
  echo "   ├─ log group: $LOG_GROUP"
fi
echo "   ├─ since: $SINCE ago"
if [[ -n "$CUSTOM_FILTER" ]]; then
  echo "   ├─ filter: $CUSTOM_FILTER (raw)"
elif [[ ${#FILTERS[@]} -gt 0 ]]; then
  echo "   ├─ filter: ${FILTERS[*]} (AND)"
fi

# tail mode (--tail requires --lambda; validated upfront before aws calls)
if [[ "$TAIL" == true ]]; then
  echo "   └─ tail logs (ctrl+c to stop)..."
  if [[ -n "$CUSTOM_FILTER" ]]; then
    echo "   note: tail mode uses server-side filter - --query not supported"
    aws logs tail "$LOG_GROUP" --follow
  elif [[ ${#FILTERS[@]} -gt 0 ]]; then
    if [[ ${#FILTERS[@]} -gt 1 ]]; then
      echo "   note: tail mode only uses first filter: ${FILTERS[0]}"
    fi
    aws logs tail "$LOG_GROUP" --follow --filter-pattern "${FILTERS[0]}"
  else
    aws logs tail "$LOG_GROUP" --follow
  fi
  exit 0
fi

# write query input to file
write_query_input

# query logs via CloudWatch Logs Insights
START_TIME=$(convert_since_to_seconds "$SINCE")
END_TIME=$(date +%s)

if [[ "$MULTI_GROUP" == true ]]; then
  FIELDS="fields @timestamp, @log, @message"
else
  FIELDS="fields @timestamp, @message"
fi

FILTER_CLAUSE=""
FILTER_DISPLAY=""
if [[ -n "$CUSTOM_FILTER" ]]; then
  FILTER_CLAUSE="| filter $CUSTOM_FILTER"
  FILTER_DISPLAY="$CUSTOM_FILTER"
elif [[ ${#FILTERS[@]} -gt 0 ]]; then
  FILTER_PARTS=()
  for f in "${FILTERS[@]}"; do
    ESCAPED=$(printf '%s' "$f" | sed 's/[.[\*^$()+?{|]/\\&/g')
    FILTER_PARTS+=("@message like /(?i)$ESCAPED/")
  done
  JOINED=$(printf '%s' "${FILTER_PARTS[0]}")
  for ((i=1; i<${#FILTER_PARTS[@]}; i++)); do
    JOINED="$JOINED and ${FILTER_PARTS[$i]}"
  done
  FILTER_CLAUSE="| filter $JOINED"
  FILTER_DISPLAY="$JOINED"
fi

QUERY="$FIELDS $FILTER_CLAUSE | sort @timestamp asc | limit $LIMIT"

echo "   ├─ query via Logs Insights..."

if [[ "$MULTI_GROUP" == true ]]; then
  QUERY_ID=$(aws logs start-query \
    --log-group-names "${LOG_GROUPS[@]}" \
    --start-time "$START_TIME" \
    --end-time "$END_TIME" \
    --query-string "$QUERY" \
    --output text --query 'queryId')
else
  QUERY_ID=$(aws logs start-query \
    --log-group-name "$LOG_GROUP" \
    --start-time "$START_TIME" \
    --end-time "$END_TIME" \
    --query-string "$QUERY" \
    --output text --query 'queryId')
fi


if [[ -z "$QUERY_ID" ]]; then
  echo "🐈 wet paws..."
  echo ""
  echo "🔮 aws.cloudwatch.logs.query"
  echo "   └─ query start failed"
  exit 1
fi

# poll for results (max 60 seconds)
POLL_COUNT=0
MAX_POLLS=30
while [[ $POLL_COUNT -lt $MAX_POLLS ]]; do
  RESULT=$(aws logs get-query-results --query-id "$QUERY_ID" --output json)
  STATUS=$(echo "$RESULT" | jq -r '.status')

  if [[ "$STATUS" == "Complete" ]]; then
    break
  elif [[ "$STATUS" == "Failed" || "$STATUS" == "Cancelled" ]]; then
    echo "🐈 wet paws..."
    echo ""
    echo "🔮 aws.cloudwatch.logs.query"
    echo "   └─ query $STATUS"
    exit 1
  fi

  sleep 2
  POLL_COUNT=$((POLL_COUNT + 1))
done

if [[ "$STATUS" != "Complete" ]]; then
  echo "🐈 wet paws..."
  echo ""
  echo "🔮 aws.cloudwatch.logs.query"
  echo "   └─ query timed out (status: $STATUS)"
  exit 1
fi

# transform Insights results
if [[ "$MULTI_GROUP" == true ]]; then
  echo "$RESULT" | jq '[.results[] | {
    timestamp: ((.[] | select(.field == "@timestamp") | .value) | gsub(" "; "T") | gsub("\\.\\d+$"; "Z") | fromdateiso8601 * 1000),
    log: ((.[] | select(.field == "@log") | .value) // "unknown"),
    message: (.[] | select(.field == "@message") | .value)
  }]' > "$OUTPUT_JSON"
else
  echo "$RESULT" | jq '[.results[] | {
    timestamp: ((.[] | select(.field == "@timestamp") | .value) | gsub(" "; "T") | gsub("\\.\\d+$"; "Z") | fromdateiso8601 * 1000),
    message: (.[] | select(.field == "@message") | .value)
  }]' > "$OUTPUT_JSON"
fi
echo "   ├─ json: $OUTPUT_JSON"

# generate summary
generate_output_summary "$OUTPUT_JSON" "$OUTPUT_MD"

echo ""
echo "🐈 caught it!"
echo ""
echo "🔮 aws.cloudwatch.logs.query"
echo "   └─ observed"
echo ""

# output formatted logs to stdout
if [[ "$MULTI_GROUP" == true ]]; then
  jq -r '.[] | "\(.timestamp | . / 1000 | strftime("%Y-%m-%d %H:%M:%S")) | \(.log | split("/")[-1]) | \(.message)"' "$OUTPUT_JSON"
else
  jq -r '.[] | "\(.timestamp | . / 1000 | strftime("%Y-%m-%d %H:%M:%S")) | \(.message)"' "$OUTPUT_JSON"
fi

exit 0
