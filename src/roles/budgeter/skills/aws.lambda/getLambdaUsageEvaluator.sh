#!/bin/bash
# .what = evaluate Lambda usage patterns by analyzing invocations over time for high-cost functions
# .why = provide visibility into usage trends to understand invocation patterns and identify anomalies

set -euo pipefail

# parse arguments
EXPENSES_JSON=""
OUTPUT_DIR=""
GRANULARITY="daily"  # default: daily breakdown (can be "hourly" or "daily")
MIN_COST_THRESHOLD=1.00  # minimum monthly cost to analyze (default $1/month)

while [[ $# -gt 0 ]]; do
  case $1 in
    --expenses)
      EXPENSES_JSON="$2"
      shift 2
      ;;
    --output)
      OUTPUT_DIR="$2"
      shift 2
      ;;
    --granularity)
      GRANULARITY="$2"
      shift 2
      ;;
    --min-cost)
      MIN_COST_THRESHOLD="$2"
      shift 2
      ;;
    *)
      echo "⛈️  Error: Unknown argument: $1"
      echo "Usage: $0 --expenses <expenses.json> [--output <directory>] [--granularity <hourly|daily>] [--min-cost <amount>]"
      exit 1
      ;;
  esac
done

# validate required arguments
if [[ -z "$EXPENSES_JSON" ]]; then
  echo "⛈️  Error: --expenses argument is required"
  echo "Usage: $0 --expenses <expenses.json> [--output <directory>] [--granularity <hourly|daily>] [--min-cost <amount>]"
  exit 1
fi

if [[ ! -f "$EXPENSES_JSON" ]]; then
  echo "⛈️  Error: Expenses file not found: $EXPENSES_JSON"
  exit 1
fi

# validate granularity
if [[ "$GRANULARITY" != "hourly" && "$GRANULARITY" != "daily" ]]; then
  echo "⛈️  Error: Invalid granularity: $GRANULARITY (must be 'hourly' or 'daily')"
  exit 1
fi

echo "🔭 Evaluating Lambda usage patterns..."
echo "📂 Expenses file: $EXPENSES_JSON"
echo "📊 Granularity: $GRANULARITY"
echo "💰 Cost threshold: ≥\$$MIN_COST_THRESHOLD/month"
echo ""

# set default output directory if not specified (same directory as input file)
if [[ -z "$OUTPUT_DIR" ]]; then
  OUTPUT_DIR="$(dirname "$EXPENSES_JSON")"
fi

# ensure output directory exists
mkdir -p "$OUTPUT_DIR"

# define output file paths
USAGE_JSON_FILE="${OUTPUT_DIR}/usage.json"
USAGE_MD_FILE="${OUTPUT_DIR}/usage.md"

# load expenses data
EXPENSES_DATA=$(cat "$EXPENSES_JSON")

# extract metadata
ACCOUNT_DISPLAY=$(echo "$EXPENSES_DATA" | jq -r '.account.display')
PERIOD_FROM=$(echo "$EXPENSES_DATA" | jq -r '.period.from')
PERIOD_TO=$(echo "$EXPENSES_DATA" | jq -r '.period.to')
PERIOD_DAYS=$(echo "$EXPENSES_DATA" | jq -r '.period.days')

echo "📊 Account: $ACCOUNT_DISPLAY"
echo "📊 Period: $PERIOD_FROM to $PERIOD_TO ($PERIOD_DAYS days)"
echo ""

# filter functions by cost threshold
FUNCTIONS_TO_ANALYZE=$(echo "$EXPENSES_DATA" | jq --argjson threshold "$MIN_COST_THRESHOLD" '
  .functions[] |
  select(.monthly_cost >= $threshold) |
  {
    function_name: .function_name,
    monthly_cost: .monthly_cost,
    invocations: .invocations,
    runtime: .runtime,
    architecture: .architecture
  }
' | jq -s '.')

FUNCTION_COUNT=$(echo "$FUNCTIONS_TO_ANALYZE" | jq 'length')

echo "✨ Found $FUNCTION_COUNT functions costing ≥\$$MIN_COST_THRESHOLD/month"
echo ""

if [[ "$FUNCTION_COUNT" == "0" ]]; then
  echo "⛈️  No functions meet the cost threshold. Exiting."
  exit 0
fi

# calculate CloudWatch Metrics parameters based on granularity
if [[ "$GRANULARITY" == "hourly" ]]; then
  CW_PERIOD=3600  # 1 hour in seconds
  TIME_UNIT="hour"
elif [[ "$GRANULARITY" == "daily" ]]; then
  CW_PERIOD=86400  # 1 day in seconds
  TIME_UNIT="day"
fi

# convert period dates to epoch seconds for CloudWatch
METRICS_START=$(date -d "$PERIOD_FROM" -u +%Y-%m-%dT00:00:00Z)
METRICS_END=$(date -d "$PERIOD_TO" -u +%Y-%m-%dT23:59:59Z)

echo "🔭 Querying CloudWatch for invocation patterns ($GRANULARITY breakdown)..."
echo ""

# create array to store usage data
declare -a USAGE_DATA=()

# process each function
FUNCTION_INDEX=0
echo "$FUNCTIONS_TO_ANALYZE" | jq -c '.[]' | while IFS= read -r FUNCTION; do
  FUNCTION_INDEX=$((FUNCTION_INDEX + 1))
  FUNCTION_NAME=$(echo "$FUNCTION" | jq -r '.function_name')
  MONTHLY_COST=$(echo "$FUNCTION" | jq -r '.monthly_cost')
  TOTAL_INVOCATIONS=$(echo "$FUNCTION" | jq -r '.invocations')

  echo "  [$FUNCTION_INDEX/$FUNCTION_COUNT] $FUNCTION_NAME (\$$(printf "%.2f" "$MONTHLY_COST")/mo, $(printf "%.0f" "$TOTAL_INVOCATIONS") invocations)"

  # query CloudWatch Metrics for invocation time series
  INVOCATION_DATA=$(aws cloudwatch get-metric-statistics \
    --namespace AWS/Lambda \
    --metric-name Invocations \
    --dimensions Name=FunctionName,Value="$FUNCTION_NAME" \
    --start-time "$METRICS_START" \
    --end-time "$METRICS_END" \
    --period "$CW_PERIOD" \
    --statistics Sum \
    --output json)

  # parse and format time series data
  TIME_SERIES=$(echo "$INVOCATION_DATA" | jq -r '
    .Datapoints |
    sort_by(.Timestamp) |
    map({
      timestamp: .Timestamp,
      invocations: (.Sum | floor)
    })
  ')

  # calculate statistics
  DATAPOINT_COUNT=$(echo "$TIME_SERIES" | jq 'length')

  if [[ "$DATAPOINT_COUNT" -gt 0 ]]; then
    AVG_INVOCATIONS=$(echo "$TIME_SERIES" | jq '[.[].invocations] | add / length | floor')
    MAX_INVOCATIONS=$(echo "$TIME_SERIES" | jq '[.[].invocations] | max')
    MIN_INVOCATIONS=$(echo "$TIME_SERIES" | jq '[.[].invocations] | min')

    # identify peak usage periods
    PEAK_PERIODS=$(echo "$TIME_SERIES" | jq --argjson avg "$AVG_INVOCATIONS" '
      map(select(.invocations > ($avg * 1.5))) |
      sort_by(-.invocations) |
      .[0:5]
    ')

    # identify low usage periods (potential idle times)
    LOW_PERIODS=$(echo "$TIME_SERIES" | jq --argjson avg "$AVG_INVOCATIONS" '
      map(select(.invocations < ($avg * 0.3) and .invocations > 0)) |
      sort_by(.invocations) |
      .[0:5]
    ')

    # count zero-invocation periods
    ZERO_PERIODS=$(echo "$TIME_SERIES" | jq '[.[] | select(.invocations == 0)] | length')

    echo "     📊 Stats: avg=$(printf "%.0f" "$AVG_INVOCATIONS")/$TIME_UNIT, max=$(printf "%.0f" "$MAX_INVOCATIONS")/$TIME_UNIT, min=$(printf "%.0f" "$MIN_INVOCATIONS")/$TIME_UNIT, zeros=$ZERO_PERIODS periods"

    # create JSON entry for this function
    FUNCTION_USAGE_JSON=$(jq -n \
      --arg function_name "$FUNCTION_NAME" \
      --argjson monthly_cost "$MONTHLY_COST" \
      --argjson total_invocations "$TOTAL_INVOCATIONS" \
      --argjson avg_invocations "$AVG_INVOCATIONS" \
      --argjson max_invocations "$MAX_INVOCATIONS" \
      --argjson min_invocations "$MIN_INVOCATIONS" \
      --argjson zero_periods "$ZERO_PERIODS" \
      --argjson datapoint_count "$DATAPOINT_COUNT" \
      --argjson time_series "$TIME_SERIES" \
      --argjson peak_periods "$PEAK_PERIODS" \
      --argjson low_periods "$LOW_PERIODS" \
      --arg granularity "$GRANULARITY" \
      '{
        function_name: $function_name,
        monthly_cost: $monthly_cost,
        total_invocations: $total_invocations,
        statistics: {
          avg_per_period: $avg_invocations,
          max_per_period: $max_invocations,
          min_per_period: $min_invocations,
          zero_invocation_periods: $zero_periods,
          datapoint_count: $datapoint_count
        },
        peak_periods: $peak_periods,
        low_usage_periods: $low_periods,
        time_series: $time_series,
        granularity: $granularity
      }')

    # write to temp file
    echo "$FUNCTION_USAGE_JSON" >> "${OUTPUT_DIR}/usage_${FUNCTION_INDEX}.json"
  else
    echo "     ⚠️  No CloudWatch data found for this period"
  fi
done

echo ""
echo "✨ Usage data collection complete"
echo ""

# combine all individual usage JSONs into one array
if ls "${OUTPUT_DIR}"/usage_*.json 1> /dev/null 2>&1; then
  USAGE_ARRAY=$(cat "${OUTPUT_DIR}"/usage_*.json | jq -s '.')
else
  USAGE_ARRAY="[]"
fi

# calculate aggregate statistics
TOTAL_FUNCTIONS_ANALYZED=$(echo "$USAGE_ARRAY" | jq 'length')
TOTAL_INVOCATIONS=$(echo "$USAGE_ARRAY" | jq '[.[].total_invocations] | add // 0')
TOTAL_COST=$(echo "$USAGE_ARRAY" | jq '[.[].monthly_cost] | add // 0')

# write usage JSON
jq -n \
  --arg account_display "$ACCOUNT_DISPLAY" \
  --arg period_from "$PERIOD_FROM" \
  --arg period_to "$PERIOD_TO" \
  --argjson period_days "$PERIOD_DAYS" \
  --arg analysis_date "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg granularity "$GRANULARITY" \
  --argjson cost_threshold "$MIN_COST_THRESHOLD" \
  --argjson total_functions "$TOTAL_FUNCTIONS_ANALYZED" \
  --argjson total_invocations "$TOTAL_INVOCATIONS" \
  --argjson total_cost "$TOTAL_COST" \
  --argjson functions "$USAGE_ARRAY" \
  '{
    account: $account_display,
    period: {
      from: $period_from,
      to: $period_to,
      days: $period_days
    },
    analysis_date: $analysis_date,
    granularity: $granularity,
    filters: {
      min_monthly_cost: $cost_threshold
    },
    summary: {
      functions_analyzed: $total_functions,
      total_invocations: $total_invocations,
      total_monthly_cost: $total_cost
    },
    functions: $functions
  }' > "$USAGE_JSON_FILE"

echo "✨ Usage data written to: $USAGE_JSON_FILE"
echo ""

# write usage markdown report
cat > "$USAGE_MD_FILE" << EOF
# Lambda Usage Patterns

**Account**: $ACCOUNT_DISPLAY
**Period**: $PERIOD_FROM to $PERIOD_TO ($PERIOD_DAYS days)
**Granularity**: $GRANULARITY
**Generated**: $(date -u +%Y-%m-%dT%H:%M:%SZ)

## Summary

- Functions Analyzed: $TOTAL_FUNCTIONS_ANALYZED (costing ≥\$$MIN_COST_THRESHOLD/month)
- Total Invocations: $(printf "%.0f" "$TOTAL_INVOCATIONS")
- Total Monthly Cost: \$$(printf "%.2f" "$TOTAL_COST")

## Usage Patterns by Function

EOF

# add function usage tables
echo "$USAGE_ARRAY" | jq -c '.[]' | while IFS= read -r FUNC_USAGE; do
  FUNCTION_NAME=$(echo "$FUNC_USAGE" | jq -r '.function_name')
  MONTHLY_COST=$(echo "$FUNC_USAGE" | jq -r '.monthly_cost')
  TOTAL_INVOCATIONS=$(echo "$FUNC_USAGE" | jq -r '.total_invocations')
  AVG_INVOCATIONS=$(echo "$FUNC_USAGE" | jq -r '.statistics.avg_per_period')
  MAX_INVOCATIONS=$(echo "$FUNC_USAGE" | jq -r '.statistics.max_per_period')
  MIN_INVOCATIONS=$(echo "$FUNC_USAGE" | jq -r '.statistics.min_per_period')
  ZERO_PERIODS=$(echo "$FUNC_USAGE" | jq -r '.statistics.zero_invocation_periods')
  DATAPOINT_COUNT=$(echo "$FUNC_USAGE" | jq -r '.statistics.datapoint_count')

  cat >> "$USAGE_MD_FILE" << EOF

### $FUNCTION_NAME

**Cost**: \$$(printf "%.2f" "$MONTHLY_COST")/month | **Total Invocations**: $(printf "%.0f" "$TOTAL_INVOCATIONS")

**Statistics** ($GRANULARITY):
- Average: $(printf "%.0f" "$AVG_INVOCATIONS") invocations/$TIME_UNIT
- Maximum: $(printf "%.0f" "$MAX_INVOCATIONS") invocations/$TIME_UNIT
- Minimum: $(printf "%.0f" "$MIN_INVOCATIONS") invocations/$TIME_UNIT
- Zero-invocation periods: $ZERO_PERIODS of $DATAPOINT_COUNT

EOF

  # add peak periods if any
  PEAK_COUNT=$(echo "$FUNC_USAGE" | jq '.peak_periods | length')
  if [[ "$PEAK_COUNT" -gt 0 ]]; then
    cat >> "$USAGE_MD_FILE" << EOF
**Peak Usage Periods** (>50% above average):

| Timestamp | Invocations |
|-----------|-------------|
EOF

    echo "$FUNC_USAGE" | jq -r '.peak_periods[] | "| \(.timestamp) | \(.invocations | floor) |"' >> "$USAGE_MD_FILE"

    echo "" >> "$USAGE_MD_FILE"
  fi

  # add low periods if any
  LOW_COUNT=$(echo "$FUNC_USAGE" | jq '.low_usage_periods | length')
  if [[ "$LOW_COUNT" -gt 0 ]]; then
    cat >> "$USAGE_MD_FILE" << EOF
**Low Usage Periods** (<30% of average):

| Timestamp | Invocations |
|-----------|-------------|
EOF

    echo "$FUNC_USAGE" | jq -r '.low_usage_periods[] | "| \(.timestamp) | \(.invocations | floor) |"' >> "$USAGE_MD_FILE"

    echo "" >> "$USAGE_MD_FILE"
  fi

  # add visual sparkline approximation using Unicode blocks
  cat >> "$USAGE_MD_FILE" << EOF
**Invocation Timeline**:

\`\`\`
EOF

  echo "$FUNC_USAGE" | jq -r '
    .time_series as $ts |
    ($ts | map(.invocations) | max) as $max |
    if $max > 0 then
      $ts[] |
      (.invocations / $max * 8 | floor) as $height |
      (.timestamp | split("T")[0]) as $date |
      (.timestamp | split("T")[1] | split(":")[0]) as $hour |
      (if ($height == 0) then " " elif ($height == 1) then "▁" elif ($height == 2) then "▂" elif ($height == 3) then "▃" elif ($height == 4) then "▄" elif ($height == 5) then "▅" elif ($height == 6) then "▆" elif ($height == 7) then "▇" else "█" end) as $bar |
      "\($date) \($hour):00 \($bar) \(.invocations | floor)"
    else
      "No data"
    end
  ' >> "$USAGE_MD_FILE"

  cat >> "$USAGE_MD_FILE" << EOF
\`\`\`

---

EOF
done

cat >> "$USAGE_MD_FILE" << EOF

## Key Insights

1. **High Variability Functions**: Functions with large differences between peak and average usage may benefit from reserved concurrency or provisioned concurrency during peak hours.

2. **Low Utilization Periods**: Functions with many zero-invocation periods may indicate opportunities for optimization or consolidation.

3. **Consistent Usage**: Functions with low variance between min/avg/max may be good candidates for reserved capacity pricing models.

## Next Steps

1. Identify functions with predictable usage patterns for cost optimization
2. Investigate anomalous peaks to ensure they are expected behavior
3. Consider consolidating functions with very low invocation counts
4. Set up CloudWatch alarms for unexpected usage spikes

---

*Note: Usage data is based on CloudWatch Metrics with $GRANULARITY granularity over a $PERIOD_DAYS day period.*

EOF

echo "✨ Usage report written to: $USAGE_MD_FILE"
echo ""

# clean up temp files
rm -f "${OUTPUT_DIR}"/usage_*.json

# display summary
echo "🌊 Lambda Usage Evaluation Complete"
echo ""
echo "📊 Summary:"
echo "   - Functions analyzed: $TOTAL_FUNCTIONS_ANALYZED"
echo "   - Total invocations: $(printf "%.0f" "$TOTAL_INVOCATIONS")"
echo "   - Total monthly cost: \$$(printf "%.2f" "$TOTAL_COST")"
echo "   - Granularity: $GRANULARITY"
echo ""
echo "✨ Done!"
echo ""
echo "🌿 Output files:"
echo "   - JSON: $USAGE_JSON_FILE"
echo "   - Markdown: $USAGE_MD_FILE"
echo ""
