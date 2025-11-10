#!/bin/bash
# .what = compare AWS cost trends between two months via markdown summary
# .why = enables cost trend analysis and budgeting by identifying significant changes

set -euo pipefail

# define script directory for relative path resolution
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# generate iso datetime for default output path
ISO_DATETIME=$(date -u +%Y_%m_%dT%H_%M_%SZ)

# parse arguments
OUTPUT_DIR=""
MONTHS_SPEC=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --output)
      OUTPUT_DIR="$2"
      shift 2
      ;;
    --months)
      MONTHS_SPEC="$2"
      shift 2
      ;;
    *)
      echo "⛈️  Error: Unknown argument: $1"
      echo "Usage: $0 --months '<month1> <month2>' [--output <directory-path>]"
      exit 1
      ;;
  esac
done

# validate required arguments
if [[ -z "$MONTHS_SPEC" ]]; then
  echo "⛈️  Error: --months parameter is required"
  echo "Usage: $0 --months '<month1> <month2>' [--output <directory-path>]"
  echo ""
  echo "Examples:"
  echo "  $0 --months 'sofar last'                    # Compare current month vs last month"
  echo "  $0 --months '2025-09 2025-08'               # Compare September vs August 2025"
  exit 1
fi

# split months spec into two month specs
read -r MONTH1_SPEC MONTH2_SPEC <<< "$MONTHS_SPEC"

if [[ -z "$MONTH1_SPEC" ]] || [[ -z "$MONTH2_SPEC" ]]; then
  echo "⛈️  Error: --months must contain exactly two month specifications"
  echo "Usage: $0 --months '<month1> <month2>' [--output <directory-path>]"
  exit 1
fi

# set default output directory if not specified
if [[ -z "$OUTPUT_DIR" ]]; then
  OUTPUT_DIR=".temp/getCostTrendsComparison/${ISO_DATETIME}"
fi

# verify AWS authentication
echo "🔑 Verifying AWS authentication..."
if ! aws sts get-caller-identity > /dev/null 2>&1; then
  echo "⛈️  Error: AWS authentication failed"
  echo "Please authenticate to AWS first:"
  echo "  - Run: use.ahbode.dev"
  echo "  - Or set: AWS_PROFILE=ahbode.dev"
  exit 1
fi
echo "✨ AWS authentication verified"
echo ""

# create output directory
mkdir -p "$OUTPUT_DIR"

# define output file paths
COMPARISON_JSON_FILE="${OUTPUT_DIR}/comparison.json"
SUMMARY_MD_FILE="${OUTPUT_DIR}/summary.md"
DAILY_MD_FILE="${OUTPUT_DIR}/daily.md"

# create temporary directories for month data
TEMP_DIR1="${OUTPUT_DIR}/temp_month1_data"
TEMP_DIR2="${OUTPUT_DIR}/temp_month2_data"

echo "🌊 Comparing AWS cost trends between two months..."
echo "🍂 Months: $MONTH1_SPEC vs $MONTH2_SPEC"
echo "🍂 Output directory: $OUTPUT_DIR"
echo ""

# fetch data for both months
echo "🔭 Fetching cost data for first period ($MONTH1_SPEC)..."
bash "$SCRIPT_DIR/getCostsForMonth.sh" --month "$MONTH1_SPEC" --output "$TEMP_DIR1" > /dev/null 2>&1
echo "✨ Cost data retrieved for first period"
echo ""

echo "🔭 Fetching cost data for second period ($MONTH2_SPEC)..."
bash "$SCRIPT_DIR/getCostsForMonth.sh" --month "$MONTH2_SPEC" --output "$TEMP_DIR2" > /dev/null 2>&1
echo "✨ Cost data retrieved for second period"
echo ""

# verify trends files exist
if [[ ! -f "$TEMP_DIR1/trends.json" ]] || [[ ! -f "$TEMP_DIR2/trends.json" ]]; then
  echo "⛈️  Error: trends.json files not found for one or both months"
  exit 1
fi

# determine chronological order and normalize day counts
echo "🔭 Determining chronological order and normalizing comparison period..."
echo ""

# extract start dates to determine chronological order
START1=$(jq -r '.ResultsByTime[0].TimePeriod.Start' "$TEMP_DIR1/trends.json")
START2=$(jq -r '.ResultsByTime[0].TimePeriod.Start' "$TEMP_DIR2/trends.json")

# determine which is before and assign to before/after
if [[ "$START1" < "$START2" ]]; then
  BEFORE_DIR="$TEMP_DIR1"
  AFTER_DIR="$TEMP_DIR2"
  BEFORE_SPEC="$MONTH1_SPEC"
  AFTER_SPEC="$MONTH2_SPEC"
else
  BEFORE_DIR="$TEMP_DIR2"
  AFTER_DIR="$TEMP_DIR1"
  BEFORE_SPEC="$MONTH2_SPEC"
  AFTER_SPEC="$MONTH1_SPEC"
fi

# count days in each period
BEFORE_DAY_COUNT=$(jq '.ResultsByTime | length' "$BEFORE_DIR/trends.json")
AFTER_DAY_COUNT=$(jq '.ResultsByTime | length' "$AFTER_DIR/trends.json")

# extract YYYY-MM from periods for display
BEFORE_MONTH=$(echo "$START1" | cut -d'-' -f1-2)
AFTER_MONTH=$(echo "$START2" | cut -d'-' -f1-2)
if [[ "$START1" > "$START2" ]]; then
  BEFORE_MONTH=$(echo "$START2" | cut -d'-' -f1-2)
  AFTER_MONTH=$(echo "$START1" | cut -d'-' -f1-2)
fi

# determine comparison day count (minimum of the two)
COMPARISON_DAY_COUNT=$((BEFORE_DAY_COUNT < AFTER_DAY_COUNT ? BEFORE_DAY_COUNT : AFTER_DAY_COUNT))

echo "🍂 Before period: $BEFORE_SPEC ($BEFORE_MONTH) - $BEFORE_DAY_COUNT days"
echo "🍂 After period: $AFTER_SPEC ($AFTER_MONTH) - $AFTER_DAY_COUNT days"
echo "🍂 Comparing first $COMPARISON_DAY_COUNT days of each period"
echo ""

# truncate both periods to comparison day count
MONTH1_DIR="${OUTPUT_DIR}/before_month_data"
MONTH2_DIR="${OUTPUT_DIR}/after_month_data"

mkdir -p "$MONTH1_DIR" "$MONTH2_DIR"

# truncate before month data
jq ".ResultsByTime |= .[0:$COMPARISON_DAY_COUNT]" "$BEFORE_DIR/trends.json" > "$MONTH1_DIR/trends.json"

# truncate after month data
jq ".ResultsByTime |= .[0:$COMPARISON_DAY_COUNT]" "$AFTER_DIR/trends.json" > "$MONTH2_DIR/trends.json"

echo "🔭 Analyzing trends and calculating differences..."
echo ""

# process and compare trends data using jq
jq -s --argjson days_compared "$COMPARISON_DAY_COUNT" '
  # input is array of two trend files [month1, month2]
  .[0] as $month1 |
  .[1] as $month2 |

  # extract time periods
  {
    month1_period: {
      start: $month1.ResultsByTime[0].TimePeriod.Start,
      end: ($month1.ResultsByTime[-1].TimePeriod.End)
    },
    month2_period: {
      start: $month2.ResultsByTime[0].TimePeriod.Start,
      end: ($month2.ResultsByTime[-1].TimePeriod.End)
    },

    # get all unique services from both months
    services: (
      [
        ($month1.ResultsByTime[].Groups[] | select(.Metrics.UnblendedCost.Amount | tonumber > 0) | .Keys[0]),
        ($month2.ResultsByTime[].Groups[] | select(.Metrics.UnblendedCost.Amount | tonumber > 0) | .Keys[0])
      ] | unique
    ),

    # calculate daily aggregates for each service
    service_comparisons: (
      [
        ($month1.ResultsByTime[].Groups[] | select(.Metrics.UnblendedCost.Amount | tonumber > 0) | .Keys[0]),
        ($month2.ResultsByTime[].Groups[] | select(.Metrics.UnblendedCost.Amount | tonumber > 0) | .Keys[0])
      ] | unique | map(. as $service |

        # extract month1 daily data
        ($month1.ResultsByTime | map({
          date: .TimePeriod.Start,
          cost: ([.Groups[] | select(.Keys[0] == $service) | .Metrics.UnblendedCost.Amount | tonumber] | add // 0)
        })) as $month1_days |

        # extract month2 daily data
        ($month2.ResultsByTime | map({
          date: .TimePeriod.Start,
          cost: ([.Groups[] | select(.Keys[0] == $service) | .Metrics.UnblendedCost.Amount | tonumber] | add // 0)
        })) as $month2_days |

        # calculate totals for each month
        ($month1_days | map(.cost) | add // 0) as $month1_total |
        ($month2_days | map(.cost) | add // 0) as $month2_total |

        # calculate average daily costs using comparison day count
        (if $days_compared > 0 then ($month1_total / $days_compared) else 0 end) as $month1_avg_daily |
        (if $days_compared > 0 then ($month2_total / $days_compared) else 0 end) as $month2_avg_daily |

        # calculate difference and percentage change
        ($month2_total - $month1_total) as $diff |
        ($month2_avg_daily - $month1_avg_daily) as $avg_daily_diff |
        (if $month1_total > 0 then ($diff / $month1_total * 100) else (if $month2_total > 0 then 100 else 0 end) end) as $pct_change |

        # determine if change is significant (>20% change or >$10 difference, and >$1 difference)
        (((if $pct_change < 0 then -$pct_change else $pct_change end) > 20 or (if $diff < 0 then -$diff else $diff end) > 10) and (if $diff < 0 then -$diff else $diff end) > 1) as $is_significant |

        {
          service: $service,
          month1_total: $month1_total,
          month2_total: $month2_total,
          month1_avg_daily: $month1_avg_daily,
          month2_avg_daily: $month2_avg_daily,
          difference: $diff,
          avg_daily_difference: $avg_daily_diff,
          percent_change: $pct_change,
          is_significant: $is_significant,
          month1_daily: $month1_days,
          month2_daily: $month2_days
        }
      ) | sort_by(if .difference < 0 then -.difference else .difference end) | reverse
    )
  }
' "$MONTH1_DIR/trends.json" "$MONTH2_DIR/trends.json" > "$COMPARISON_JSON_FILE"

echo "✨ Comparison data written to: $COMPARISON_JSON_FILE"
echo ""

# generate summary markdown
cat > "$SUMMARY_MD_FILE" << 'EOF'
# aws cost trends comparison

## periods compared

EOF

# append period information
jq -r --arg before_spec "$BEFORE_SPEC" --arg after_spec "$AFTER_SPEC" --arg before_month "$BEFORE_MONTH" --arg after_month "$AFTER_MONTH" --arg day_count "$COMPARISON_DAY_COUNT" '
  "### before period (\($before_spec) - \($before_month))\n- start: \(.month1_period.start)\n- end: \(.month1_period.end)\n\n### after period (\($after_spec) - \($after_month))\n- start: \(.month2_period.start)\n- end: \(.month2_period.end)\n\n### comparison\n- days compared: \($day_count)\n"
' "$COMPARISON_JSON_FILE" >> "$SUMMARY_MD_FILE"

# add summary section
cat >> "$SUMMARY_MD_FILE" << 'EOF'

## summary

EOF

# calculate and add totals
jq -r '
  def round4: . * 10000 | round / 10000;

  (.service_comparisons | map(.month1_total) | add) as $total1 |
  (.service_comparisons | map(.month2_total) | add) as $total2 |
  ($total2 - $total1) as $diff |
  (if $total1 > 0 then ($diff / $total1 * 100) else 0 end) as $pct |

  "- before period total: $\($total1 | round4)\n" +
  "- after period total: $\($total2 | round4)\n" +
  "- difference: \(if $diff > 0 then "+" else "" end)$\($diff | round4) (\(if $diff > 0 then "+" else "" end)\($pct | round4)%)\n"
' "$COMPARISON_JSON_FILE" >> "$SUMMARY_MD_FILE"

# add significant changes section
cat >> "$SUMMARY_MD_FILE" << 'EOF'

## significant changes

Services with (>20% change or >$10 difference) and >$1 difference:

EOF

# list significant changes
jq -r --arg before_month "$BEFORE_MONTH" --arg after_month "$AFTER_MONTH" '
  def round4: . * 10000 | round / 10000;
  def leftpad(width): tostring | (width - length) as $pad | if $pad > 0 then (" " * $pad) + . else . end;

  .service_comparisons |
  map(select(.is_significant)) |
  if length == 0 then
    "no significant changes detected\n"
  else
    map(
      . as $svc |

      # calculate avg daily percent change
      (if $svc.month1_avg_daily > 0 then ($svc.avg_daily_difference / $svc.month1_avg_daily * 100) else (if $svc.month2_avg_daily > 0 then 100 else 0 end) end) as $avg_daily_pct_change |

      # round values for display
      ($svc.month1_total | round4) as $m1t |
      ($svc.month2_total | round4) as $m2t |
      ($svc.month1_avg_daily | round4) as $m1a |
      ($svc.month2_avg_daily | round4) as $m2a |
      ($svc.difference | round4) as $diff |
      ($svc.avg_daily_difference | round4) as $avgdiff |
      ($svc.percent_change | round4) as $pct |
      ($avg_daily_pct_change | round4) as $avgpct |

      # calculate max widths for padding
      (["total", "avg daily"] | max_by(length) | length) as $metric_width |

      ("before (\($before_month))" | length) as $before_header_len |
      ("after (\($after_month))" | length) as $after_header_len |

      ([
        ("$\($m1t)" | tostring | length),
        ("$\($m1a)" | tostring | length),
        $before_header_len
      ] | max) as $before_width |

      ([
        ("$\($m2t)" | tostring | length),
        ("$\($m2a)" | tostring | length),
        $after_header_len
      ] | max) as $after_width |

      ([
        ("\(if $diff > 0 then "+" else "" end)$\($diff)" | tostring | length),
        ("\(if $avgdiff > 0 then "+" else "" end)$\($avgdiff)" | tostring | length),
        4
      ] | max) as $diff_width |

      ([
        ("\(if $pct > 0 then "+" else "" end)\($pct)%" | tostring | length),
        ("\(if $avgpct > 0 then "+" else "" end)\($avgpct)%" | tostring | length),
        6
      ] | max) as $ratio_width |

      "### \($svc.service)\n\n" +
      "| \("metric" + (" " * ($metric_width - 6))) | \("before (\($before_month))" | leftpad($before_width)) | \("after (\($after_month))" | leftpad($after_width)) | \("diff" | leftpad($diff_width)) | \("diff %" | leftpad($ratio_width)) |\n" +
      "| \("-" * $metric_width) | \("-" * $before_width) | \("-" * $after_width) | \("-" * $diff_width) | \("-" * $ratio_width) |\n" +
      "| \("total" + (" " * ($metric_width - 5))) | \(("$\($m1t)" | tostring | leftpad($before_width))) | \(("$\($m2t)" | tostring | leftpad($after_width))) | \(("\(if $diff > 0 then "+" else "" end)$\($diff)" | tostring | leftpad($diff_width))) | \(("\(if $pct > 0 then "+" else "" end)\($pct)%" | tostring | leftpad($ratio_width))) |\n" +
      "| \("avg daily" + (" " * ($metric_width - 9))) | \(("$\($m1a)" | tostring | leftpad($before_width))) | \(("$\($m2a)" | tostring | leftpad($after_width))) | \(("\(if $avgdiff > 0 then "+" else "" end)$\($avgdiff)" | tostring | leftpad($diff_width))) | \(("\(if $avgpct > 0 then "+" else "" end)\($avgpct)%" | tostring | leftpad($ratio_width))) |\n"
    ) | join("\n")
  end
' "$COMPARISON_JSON_FILE" >> "$SUMMARY_MD_FILE"

# add all services summary section (without daily breakdowns)
cat >> "$SUMMARY_MD_FILE" << 'EOF'

## all services comparison

EOF

# generate summary tables (without daily breakdowns) for summary.md
jq -r --arg before_month "$BEFORE_MONTH" --arg after_month "$AFTER_MONTH" '
  def round4: . * 10000 | round / 10000;
  def leftpad(width): tostring | (width - length) as $pad | if $pad > 0 then (" " * $pad) + . else . end;

  .service_comparisons |
  map(
    . as $service_data |

    # calculate avg daily percent change
    (if $service_data.month1_avg_daily > 0 then ($service_data.avg_daily_difference / $service_data.month1_avg_daily * 100) else (if $service_data.month2_avg_daily > 0 then 100 else 0 end) end) as $avg_daily_pct_change |

    # round summary values
    ($service_data.month1_total | round4) as $m1t |
    ($service_data.month2_total | round4) as $m2t |
    ($service_data.month1_avg_daily | round4) as $m1a |
    ($service_data.month2_avg_daily | round4) as $m2a |
    ($service_data.difference | round4) as $diff |
    ($service_data.avg_daily_difference | round4) as $avgdiff |
    ($service_data.percent_change | round4) as $pct |
    ($avg_daily_pct_change | round4) as $avgpct |

    # calculate max widths for summary table
    (["total", "avg daily"] | max_by(length) | length) as $metric_width |

    ("before (\($before_month))" | length) as $before_header_len |
    ("after (\($after_month))" | length) as $after_header_len |

    ([
      ("$\($m1t)" | tostring | length),
      ("$\($m1a)" | tostring | length),
      $before_header_len
    ] | max) as $before_width |

    ([
      ("$\($m2t)" | tostring | length),
      ("$\($m2a)" | tostring | length),
      $after_header_len
    ] | max) as $after_width |

    ([
      ("\(if $diff > 0 then "+" else "" end)$\($diff)" | tostring | length),
      ("\(if $avgdiff > 0 then "+" else "" end)$\($avgdiff)" | tostring | length),
      4
    ] | max) as $diff_width |

    ([
      ("\(if $pct > 0 then "+" else "" end)\($pct)%" | tostring | length),
      ("\(if $avgpct > 0 then "+" else "" end)\($avgpct)%" | tostring | length),
      6
    ] | max) as $ratio_width |

    "### \($service_data.service)\n\n" +
    "| \("metric" + (" " * ($metric_width - 6))) | \("before (\($before_month))" | leftpad($before_width)) | \("after (\($after_month))" | leftpad($after_width)) | \("diff" | leftpad($diff_width)) | \("diff %" | leftpad($ratio_width)) |\n" +
    "| \("-" * $metric_width) | \("-" * $before_width) | \("-" * $after_width) | \("-" * $diff_width) | \("-" * $ratio_width) |\n" +
    "| \("total" + (" " * ($metric_width - 5))) | \(("$\($m1t)" | tostring | leftpad($before_width))) | \(("$\($m2t)" | tostring | leftpad($after_width))) | \(("\(if $diff > 0 then "+" else "" end)$\($diff)" | tostring | leftpad($diff_width))) | \(("\(if $pct > 0 then "+" else "" end)\($pct)%" | tostring | leftpad($ratio_width))) |\n" +
    "| \("avg daily" + (" " * ($metric_width - 9))) | \(("$\($m1a)" | tostring | leftpad($before_width))) | \(("$\($m2a)" | tostring | leftpad($after_width))) | \(("\(if $avgdiff > 0 then "+" else "" end)$\($avgdiff)" | tostring | leftpad($diff_width))) | \(("\(if $avgpct > 0 then "+" else "" end)\($avgpct)%" | tostring | leftpad($ratio_width))) |\n"
  ) | join("\n")
' "$COMPARISON_JSON_FILE" >> "$SUMMARY_MD_FILE"

# generate daily trends markdown
cat > "$DAILY_MD_FILE" << 'EOF'
# aws cost trends - daily breakdown

EOF

# add period information to daily trends
jq -r --arg before_spec "$BEFORE_SPEC" --arg after_spec "$AFTER_SPEC" --arg before_month "$BEFORE_MONTH" --arg after_month "$AFTER_MONTH" --arg day_count "$COMPARISON_DAY_COUNT" '
  "## periods compared\n\n### before period (\($before_spec) - \($before_month))\n- start: \(.month1_period.start)\n- end: \(.month1_period.end)\n\n### after period (\($after_spec) - \($after_month))\n- start: \(.month2_period.start)\n- end: \(.month2_period.end)\n\n### comparison\n- days compared: \($day_count)\n\n## daily breakdown by service\n"
' "$COMPARISON_JSON_FILE" >> "$DAILY_MD_FILE"

# generate daily breakdowns for daily.md
jq -r --arg before_month "$BEFORE_MONTH" --arg after_month "$AFTER_MONTH" '
  def round4: . * 10000 | round / 10000;
  def leftpad(width): tostring | (width - length) as $pad | if $pad > 0 then (" " * $pad) + . else . end;

  .service_comparisons |
  sort_by(-(if .month1_total > .month2_total then .month1_total else .month2_total end)) |
  map(
    . as $service_data |

    # calculate max widths for daily table
    ([$service_data.month1_daily, $service_data.month2_daily] | map(length) | max) as $day_count |
    (("day \($day_count)" | length) + 1) as $day_col_width |

    ("before (\($before_month))" | length) as $before_header_len |
    ("after (\($after_month))" | length) as $after_header_len |

    ([
      $service_data.month1_daily[] | ("$\(.cost | round4)" | tostring | length),
      $before_header_len
    ] | max) as $daily_before_width |

    ([
      $service_data.month2_daily[] | ("$\(.cost | round4)" | tostring | length),
      $after_header_len
    ] | max) as $daily_after_width |

    ([
      (
        range(0; $day_count) |
        . as $i |
        (if $i < ($service_data.month1_daily | length) then $service_data.month1_daily[$i] else {date: "-", cost: 0} end) as $d1 |
        (if $i < ($service_data.month2_daily | length) then $service_data.month2_daily[$i] else {date: "-", cost: 0} end) as $d2 |
        (($d2.cost - $d1.cost) | round4) |
        "\(if . > 0 then "+" else "" end)$\(.)" | tostring | length
      ),
      4
    ] | max) as $daily_diff_width |

    ([
      (
        range(0; $day_count) |
        . as $i |
        (if $i < ($service_data.month1_daily | length) then $service_data.month1_daily[$i] else {date: "-", cost: 0} end) as $d1 |
        (if $i < ($service_data.month2_daily | length) then $service_data.month2_daily[$i] else {date: "-", cost: 0} end) as $d2 |
        ($d2.cost - $d1.cost) as $diff |
        ((if $d1.cost > 0 then ($diff / $d1.cost * 100) else (if $d2.cost > 0 then 100 else 0 end) end) | round4) |
        "\(if . > 0 then "+" else "" end)\(.)%" | tostring | length
      ),
      6
    ] | max) as $daily_ratio_width |

    "### \($service_data.service)\n\n" +
    "| \("day" + (" " * ($day_col_width - 3))) | \("before (\($before_month))" | leftpad($daily_before_width)) | \("after (\($after_month))" | leftpad($daily_after_width)) | \("diff" | leftpad($daily_diff_width)) | \("diff %" | leftpad($daily_ratio_width)) |\n" +
    "| \("-" * $day_col_width) | \("-" * $daily_before_width) | \("-" * $daily_after_width) | \("-" * $daily_diff_width) | \("-" * $daily_ratio_width) |\n" +
    ([
      range(0; $day_count) |
      . as $i |
      (if $i < ($service_data.month1_daily | length) then $service_data.month1_daily[$i] else {date: "-", cost: 0} end) as $d1 |
      (if $i < ($service_data.month2_daily | length) then $service_data.month2_daily[$i] else {date: "-", cost: 0} end) as $d2 |
      (($d2.cost - $d1.cost) | round4) as $day_diff |
      ((if $d1.cost > 0 then ($day_diff / $d1.cost * 100) else (if $d2.cost > 0 then 100 else 0 end) end) | round4) as $day_pct |
      ("day \($i + 1)" | tostring) as $day_label |
      ("$\($d1.cost | round4)" | tostring) as $before_val |
      ("$\($d2.cost | round4)" | tostring) as $after_val |
      ("\(if $day_diff > 0 then "+" else "" end)$\($day_diff)" | tostring) as $diff_val |
      ("\(if $day_pct > 0 then "+" else "" end)\($day_pct)%" | tostring) as $ratio_val |
      "| \($day_label + (" " * ($day_col_width - ($day_label | length)))) | \($before_val | leftpad($daily_before_width)) | \($after_val | leftpad($daily_after_width)) | \($diff_val | leftpad($daily_diff_width)) | \($ratio_val | leftpad($daily_ratio_width)) |"
    ] | join("\n")) + "\n"
  ) | join("\n")
' "$COMPARISON_JSON_FILE" >> "$DAILY_MD_FILE"

# add footer to summary file
cat >> "$SUMMARY_MD_FILE" << EOF

---

generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF

# add footer to daily file
cat >> "$DAILY_MD_FILE" << EOF

---

generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF

echo "✨ Summary markdown written to: $SUMMARY_MD_FILE"
echo "✨ Daily trends markdown written to: $DAILY_MD_FILE"
echo ""

# display summary
echo "🌊 Cost Trends Comparison Summary:"
echo ""

jq -r '
  def round4: . * 10000 | round / 10000;

  (.service_comparisons | map(.month1_total) | add) as $total1 |
  (.service_comparisons | map(.month2_total) | add) as $total2 |
  ($total2 - $total1) as $diff |
  (if $total1 > 0 then ($diff / $total1 * 100) else 0 end) as $pct |

  "Before Period Total: $\($total1 | round4)\n" +
  "After Period Total: $\($total2 | round4)\n" +
  "Difference: \(if $diff > 0 then "+" else "" end)$\($diff | round4) (\(if $diff > 0 then "+" else "" end)\($pct | round4)%)\n\n" +
  "Significant Changes: \(.service_comparisons | map(select(.is_significant)) | length) services"
' "$COMPARISON_JSON_FILE"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Display top cost changes
jq -r '
  def round2: . * 100 | round / 100;

  # Get top 3 increases and decreases
  (.service_comparisons | sort_by(-.difference) | .[0:3]) as $top_increases |
  (.service_comparisons | sort_by(.difference) | .[0:3]) as $top_decreases |

  "🔥 growing costs:\n" +
  (
    if ($top_increases | map(select(.difference > 0)) | length) > 0 then
      ($top_increases | map(select(.difference > 0)) | map(
        "   ↑ \(.service | .[0:40])\n     \(if .difference > 0 then "+" else "" end)$\(.difference | round2) (\(if .percent_change > 0 then "+" else "" end)\(.percent_change | round2)%)"
      ) | join("\n"))
    else
      "   (none detected)"
    end
  ) + "\n\n" +
  "🌧️ falling costs:\n" +
  (
    if ($top_decreases | map(select(.difference < 0)) | length) > 0 then
      ($top_decreases | map(select(.difference < 0)) | map(
        "   ↓ \(.service | .[0:40])\n     \(if .difference > 0 then "+" else "" end)$\(.difference | round2) (\(if .percent_change > 0 then "+" else "" end)\(.percent_change | round2)%)"
      ) | join("\n"))
    else
      "   (none detected)"
    end
  ) + "\n"
' "$COMPARISON_JSON_FILE"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "🌾 reports ready:"
echo "   · summary: $SUMMARY_MD_FILE"
echo "   · trends: $DAILY_MD_FILE"
echo ""
echo "✨ done!"
echo ""
