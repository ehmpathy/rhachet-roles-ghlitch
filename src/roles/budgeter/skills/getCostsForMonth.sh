#!/bin/bash
# .what = fetch AWS costs for the last month and write to JSON file
# .why = enables cost analysis and budgeting workflows by providing historical cost data

set -euo pipefail

# generate iso datetime for default output path
ISO_DATETIME=$(date -u +%Y_%m_%dT%H_%M_%SZ)

# parse arguments
OUTPUT_DIR=""
MONTH_SPEC=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --output)
      OUTPUT_DIR="$2"
      shift 2
      ;;
    --month)
      MONTH_SPEC="$2"
      shift 2
      ;;
    *)
      echo "⛈️  Error: Unknown argument: $1"
      echo "Usage: $0 --month <sofar|last|YYYY-MM> [--output <directory-path>]"
      exit 1
      ;;
  esac
done

# validate required arguments
if [[ -z "$MONTH_SPEC" ]]; then
  echo "⛈️  Error: --month parameter is required"
  echo "Usage: $0 --month <sofar|last|YYYY-MM> [--output <directory-path>]"
  echo ""
  echo "Examples:"
  echo "  $0 --month sofar              # Current month so far"
  echo "  $0 --month last               # Last complete month"
  echo "  $0 --month 2025-09            # Specific month (September 2025)"
  exit 1
fi

# calculate date range based on month specification
if [[ "$MONTH_SPEC" == "sofar" ]]; then
  # current month from 1st to today
  PERIOD_SINCE=$(date +%Y-%m-01)
  PERIOD_UPTIL=$(date +%Y-%m-%d)
  MONTH_DESC="current month (so far)"
elif [[ "$MONTH_SPEC" == "last" ]]; then
  # last complete month
  PERIOD_SINCE=$(date -d "$(date +%Y-%m-01) -1 month" +%Y-%m-%d)
  PERIOD_UPTIL=$(date +%Y-%m-01)
  MONTH_DESC="last month"
elif [[ "$MONTH_SPEC" =~ ^[0-9]{4}-[0-9]{2}$ ]]; then
  # specific month in YYYY-MM format
  PERIOD_SINCE="${MONTH_SPEC}-01"
  # calculate first day of next month
  PERIOD_UPTIL=$(date -d "${PERIOD_SINCE} +1 month" +%Y-%m-%d)
  MONTH_DESC="$MONTH_SPEC"
else
  echo "⛈️  Error: Invalid month specification: $MONTH_SPEC"
  echo "Valid formats: sofar, last, YYYY-MM (e.g., 2025-09)"
  exit 1
fi

# get current AWS account ID to filter costs
echo "🔑 Getting current AWS account ID..."
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ACCOUNT_ALIAS=$(aws iam list-account-aliases --query 'AccountAliases[0]' --output text 2>/dev/null || echo "")
if [[ -n "$ACCOUNT_ALIAS" && "$ACCOUNT_ALIAS" != "None" ]]; then
  ACCOUNT_DISPLAY="$ACCOUNT_ALIAS ($ACCOUNT_ID)"
  ACCOUNT_NAME="$ACCOUNT_ALIAS"
else
  ACCOUNT_DISPLAY="$ACCOUNT_ID"
  ACCOUNT_NAME="$ACCOUNT_ID"
fi
echo "✨ Account: $ACCOUNT_DISPLAY"
echo ""

# set default output directory if not specified (now that we have account info)
if [[ -z "$OUTPUT_DIR" ]]; then
  OUTPUT_DIR=".temp/getCostsForMonth/${ACCOUNT_NAME}/${ISO_DATETIME}"
fi

# define all output file paths
SUMMARY_JSON_FILE="${OUTPUT_DIR}/summary.json"
DETAILED_JSON_FILE="${OUTPUT_DIR}/detailed.json"
SUMMARY_MD_FILE="${OUTPUT_DIR}/summary.md"
DETAILED_MD_FILE="${OUTPUT_DIR}/detailed.md"
TRENDS_JSON_FILE="${OUTPUT_DIR}/trends.json"
TRENDS_MD_FILE="${OUTPUT_DIR}/trends.md"

echo "🌊 Fetching AWS costs for $MONTH_DESC..."
echo "🌿 Output directory: $OUTPUT_DIR"
echo ""

echo "🌊 Date range: $PERIOD_SINCE to $PERIOD_UPTIL"
echo ""

# fetch cost data from AWS Cost Explorer
echo "🔭 Querying AWS Cost Explorer for service-level costs..."
COST_DATA=$(aws ce get-cost-and-usage \
  --time-period Start="$PERIOD_SINCE",End="$PERIOD_UPTIL" \
  --granularity MONTHLY \
  --metrics "UnblendedCost" "UsageQuantity" \
  --group-by Type=DIMENSION,Key=SERVICE \
  --filter "{\"Dimensions\":{\"Key\":\"LINKED_ACCOUNT\",\"Values\":[\"$ACCOUNT_ID\"]}}" \
  --output json)

echo "✨ Service-level cost data retrieved"
echo ""

# fetch detailed breakdown by usage type within each service
echo "🔭 Querying AWS Cost Explorer for detailed usage breakdown..."
DETAILED_COST_DATA=$(aws ce get-cost-and-usage \
  --time-period Start="$PERIOD_SINCE",End="$PERIOD_UPTIL" \
  --granularity MONTHLY \
  --metrics "UnblendedCost" "UsageQuantity" \
  --group-by Type=DIMENSION,Key=SERVICE Type=DIMENSION,Key=USAGE_TYPE \
  --filter "{\"Dimensions\":{\"Key\":\"LINKED_ACCOUNT\",\"Values\":[\"$ACCOUNT_ID\"]}}" \
  --output json)

echo "✨ Detailed cost data retrieved"
echo ""

# fetch daily data for trends analysis
echo "🔭 Querying AWS Cost Explorer for daily trends..."
DAILY_TRENDS_DATA=$(aws ce get-cost-and-usage \
  --time-period Start="$PERIOD_SINCE",End="$PERIOD_UPTIL" \
  --granularity DAILY \
  --metrics "UnblendedCost" "UsageQuantity" \
  --group-by Type=DIMENSION,Key=SERVICE \
  --filter "{\"Dimensions\":{\"Key\":\"LINKED_ACCOUNT\",\"Values\":[\"$ACCOUNT_ID\"]}}" \
  --output json)

echo "✨ Daily trends data retrieved"
echo ""

# ensure output directory exists
if [[ ! -d "$OUTPUT_DIR" ]]; then
  echo "🌿 Creating output directory: $OUTPUT_DIR"
  mkdir -p "$OUTPUT_DIR"
fi

# write to output files
echo "$COST_DATA" > "$SUMMARY_JSON_FILE"
echo "$DETAILED_COST_DATA" > "$DETAILED_JSON_FILE"
echo "$DAILY_TRENDS_DATA" > "$TRENDS_JSON_FILE"

echo "✨ Summary data written to: $SUMMARY_JSON_FILE"
echo "✨ Detailed data written to: $DETAILED_JSON_FILE"
echo "✨ Trends data written to: $TRENDS_JSON_FILE"
echo ""

# calculate total and prepare service breakdown
TOTAL_COST=$(echo "$COST_DATA" | jq -r '[.ResultsByTime[0].Groups[].Metrics.UnblendedCost.Amount | tonumber] | add')
CURRENCY=$(echo "$COST_DATA" | jq -r '.ResultsByTime[0].Groups[0].Metrics.UnblendedCost.Unit // "USD"')

# write summary markdown
cat > "$SUMMARY_MD_FILE" << EOF
# aws cost summary

## account
**$ACCOUNT_DISPLAY**

## period
- since: $PERIOD_SINCE
- uptil: $PERIOD_UPTIL

## total cost
**\$$TOTAL_COST $CURRENCY**

## breakdown by service

EOF

# append formatted service breakdown table
echo "$COST_DATA" | jq -r '.ResultsByTime[0].Groups | map(select(.Metrics.UnblendedCost.Amount | tonumber > 0)) | sort_by(.Metrics.UnblendedCost.Amount | tonumber) | reverse | map("\(.Keys[0])|\(.Metrics.UnblendedCost.Amount)") | .[]' | \
while IFS='|' read -r service cost; do
  printf "| %-50s | %15s |\n" "$service" "\$$cost"
done | {
  # add table header
  printf "| %-50s | %15s |\n" "service" "cost"
  printf "|%-52s|%17s|\n" "----------------------------------------------------" "-----------------"
  cat
} >> "$SUMMARY_MD_FILE"

echo "">> "$SUMMARY_MD_FILE"
echo "---">> "$SUMMARY_MD_FILE"
echo "">> "$SUMMARY_MD_FILE"
echo "generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)">> "$SUMMARY_MD_FILE"

echo "✨ Summary written to: $SUMMARY_MD_FILE"
echo ""

# write detailed markdown with usage type breakdown
cat > "$DETAILED_MD_FILE" << EOF
# aws cost detailed breakdown

## account
**$ACCOUNT_DISPLAY**

## period
- since: $PERIOD_SINCE
- uptil: $PERIOD_UPTIL

## total cost
**\$$TOTAL_COST $CURRENCY**

## detailed breakdown by usage type

EOF

# group detailed costs by service and show usage types in tables
echo "$DETAILED_COST_DATA" | jq -r '
  .ResultsByTime[0].Groups
  | map(select(.Metrics.UnblendedCost.Amount | tonumber > 0))
  | group_by(.Keys[0])
  | map({
      service: .[0].Keys[0],
      total: ([.[].Metrics.UnblendedCost.Amount | tonumber] | add),
      usages: map({usage: .Keys[1], cost: .Metrics.UnblendedCost.Amount})
    })
  | sort_by(.total)
  | reverse
  | .[]
  | "### \(.service)\n\ntotal: $\(.total)\n\n" + (.usages | sort_by(.cost | tonumber) | reverse | map("\(.usage)|\(.cost)") | join("\n")) + "\n"
' | while IFS= read -r line; do
  if [[ "$line" =~ ^###\  ]]; then
    # service header
    echo "$line" >> "$DETAILED_MD_FILE"
  elif [[ "$line" =~ ^total: ]]; then
    # total line
    echo "" >> "$DETAILED_MD_FILE"
    echo "$line" >> "$DETAILED_MD_FILE"
    echo "" >> "$DETAILED_MD_FILE"
    # print table header
    printf "| %-70s | %15s |\n" "usage type" "cost" >> "$DETAILED_MD_FILE"
    printf "|%-72s|%17s|\n" "----------------------------------------------------------------------" "-----------------" >> "$DETAILED_MD_FILE"
  elif [[ "$line" =~ ^$ ]]; then
    # blank line between services
    echo "" >> "$DETAILED_MD_FILE"
  else
    # usage type row
    IFS='|' read -r usage_type cost <<< "$line"
    printf "| %-70s | %15s |\n" "$usage_type" "\$$cost" >> "$DETAILED_MD_FILE"
  fi
done

echo "">> "$DETAILED_MD_FILE"
echo "---">> "$DETAILED_MD_FILE"
echo "">> "$DETAILED_MD_FILE"
echo "generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)">> "$DETAILED_MD_FILE"

echo "✨ Detailed summary written to: $DETAILED_MD_FILE"
echo ""

# write trends markdown with daily breakdown
echo "🔭 Generating daily trends report..."

cat > "$TRENDS_MD_FILE" << EOF
# aws cost daily trends

## account
**$ACCOUNT_DISPLAY**

## period
- since: $PERIOD_SINCE
- uptil: $PERIOD_UPTIL

## daily trends by service

EOF

# process daily data into trends
echo "$DAILY_TRENDS_DATA" | jq -r '
  . as $root |

  # collect all unique services with costs > 0
  [.ResultsByTime[].Groups[] | select(.Metrics.UnblendedCost.Amount | tonumber > 0) | .Keys[0]] | unique as $services |

  # for each service, collect daily costs
  $services | map(. as $service |
    {
      service: $service,
      days: [
        $root.ResultsByTime[] |
        {
          date: .TimePeriod.Start,
          cost: ([.Groups[] | select(.Keys[0] == $service) | .Metrics.UnblendedCost.Amount | tonumber] | if length > 0 then .[0] else 0 end)
        }
      ],
      total: [$root.ResultsByTime[].Groups[] | select(.Keys[0] == $service) | .Metrics.UnblendedCost.Amount | tonumber] | add
    }
  ) |
  sort_by(.total) | reverse |

  # format output for each service
  .[] |
  .days as $all_days |
  "### \(.service)\n\ntotal cost: $\(.total)\n\n" +
  "date|cost|change\n" +
  ([
    $all_days | to_entries | .[] |
    if .key == 0 then
      "\(.value.date)|$\(.value.cost)|-"
    else
      (
        ($all_days[.key - 1].cost) as $prev |
        (.value.cost - $prev) as $change |
        if $prev > 0 then
          ($change / $prev * 100) as $pct |
          if $change > 0 then
            "\(.value.date)|$\(.value.cost)|+$\($change) (+\($pct | floor)%)"
          elif $change < 0 then
            "\(.value.date)|$\(.value.cost)|$\($change) (\($pct | floor)%)"
          else
            "\(.value.date)|$\(.value.cost)|no change"
          end
        else
          "\(.value.date)|$\(.value.cost)|-"
        end
      )
    end
  ] | join("\n")) +
  "\n"
' 2>&1 | while IFS= read -r line; do
  if [[ "$line" =~ ^###\  ]]; then
    # service header
    echo "$line" >> "$TRENDS_MD_FILE"
  elif [[ "$line" =~ ^total\ cost: ]]; then
    # total line
    echo "" >> "$TRENDS_MD_FILE"
    echo "$line" >> "$TRENDS_MD_FILE"
    echo "" >> "$TRENDS_MD_FILE"
  elif [[ "$line" =~ ^date\| ]]; then
    # table header - format as markdown table
    IFS='|' read -r col1 col2 col3 <<< "$line"
    printf "| %-12s | %15s | %30s |\n" "$col1" "$col2" "$col3" >> "$TRENDS_MD_FILE"
    printf "|%s|%s|%s|\n" "--------------" "-----------------" "--------------------------------" >> "$TRENDS_MD_FILE"
  elif [[ "$line" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}\| ]]; then
    # data row
    IFS='|' read -r date cost change <<< "$line"
    printf "| %-12s | %15s | %30s |\n" "$date" "$cost" "$change" >> "$TRENDS_MD_FILE"
  elif [[ "$line" =~ ^$ ]]; then
    # blank line between services
    echo "" >> "$TRENDS_MD_FILE"
  else
    echo "$line" >> "$TRENDS_MD_FILE"
  fi
done

echo "">> "$TRENDS_MD_FILE"
echo "---">> "$TRENDS_MD_FILE"
echo "">> "$TRENDS_MD_FILE"
echo "generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)">> "$TRENDS_MD_FILE"

echo "✨ Trends written to: $TRENDS_MD_FILE"
echo ""

# display summary
# sum costs from all service groups since Total is often empty when grouping by service
TOTAL_COST=$(echo "$COST_DATA" | jq -r '[.ResultsByTime[0].Groups[].Metrics.UnblendedCost.Amount | tonumber] | add')
CURRENCY=$(echo "$COST_DATA" | jq -r '.ResultsByTime[0].Groups[0].Metrics.UnblendedCost.Unit // "USD"')

echo "🌊 Total cost for period: \$$TOTAL_COST $CURRENCY"
echo ""

# display top services by cost
echo "🔭 Top services by cost:"
echo "$COST_DATA" | jq -r '.ResultsByTime[0].Groups[] | select(.Metrics.UnblendedCost.Amount | tonumber > 0) | "\(.Keys[0]): $\(.Metrics.UnblendedCost.Amount)"' | sort -t'$' -k2 -rn | head -10
echo ""

echo "✨ Done!"

echo ""
echo "🌿 JSON files:"
echo "   - summary: $SUMMARY_JSON_FILE"
echo "   - detailed: $DETAILED_JSON_FILE"
echo "   - trends: $TRENDS_JSON_FILE"
echo ""
echo "🌿 Markdown files:"
echo "   - summary: $SUMMARY_MD_FILE"
echo "   - detailed: $DETAILED_MD_FILE"
echo "   - trends: $TRENDS_MD_FILE"
echo ""
