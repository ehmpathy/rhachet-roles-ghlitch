#!/bin/bash
# .what = export S3 bucket storage metrics by storage class using CloudWatch metrics
# .why = simple table view of bucket name, storage class, size, file count, and cost

set -euo pipefail

# generate iso datetime for default output path
ISO_DATETIME=$(date -u +%Y_%m_%dT%H_%M_%SZ)

# parse arguments
OUTPUT_DIR=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --output)
      OUTPUT_DIR="$2"
      shift 2
      ;;
    *)
      echo "⛈️  Error: Unknown argument: $1"
      echo "Usage: $0 [--output <directory-path>]"
      exit 1
      ;;
  esac
done

# get current AWS account ID
echo "🔑 Getting current AWS account ID..."
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ACCOUNT_ALIAS=$(aws iam list-account-aliases --query 'AccountAliases[0]' --output text 2>/dev/null || echo "")
if [[ -n "$ACCOUNT_ALIAS" && "$ACCOUNT_ALIAS" != "None" ]]; then
  ACCOUNT_NAME="$ACCOUNT_ALIAS"
else
  ACCOUNT_NAME="$ACCOUNT_ID"
fi
echo "✨ Account: $ACCOUNT_NAME"
echo ""

# set default output directory if not specified
if [[ -z "$OUTPUT_DIR" ]]; then
  OUTPUT_DIR=".rhachet/getS3BucketExpenseEvaluator/${ISO_DATETIME}"
fi

# ensure output directory exists
mkdir -p "$OUTPUT_DIR"

# define output file paths
MARKDOWN_FILE="${OUTPUT_DIR}/summary.md"
CSV_FILE="${OUTPUT_DIR}/metrics.csv"
RAW_SIZE_METRICS_FILE="${OUTPUT_DIR}/raw_size_metrics.json"
RAW_OBJECT_METRICS_FILE="${OUTPUT_DIR}/raw_object_metrics.json"
RAW_METRIC_DATA_FILE="${OUTPUT_DIR}/raw_metric_data.json"

echo "🌊 Querying CloudWatch for all S3 metrics in bulk..."
echo ""

# cloudwatch metrics date range (last 2 days to get most recent daily snapshot)
CW_START_TIME=$(date -u -d '2 days ago' +%Y-%m-%dT%H:%M:%S)
CW_END_TIME=$(date -u +%Y-%m-%dT%H:%M:%S)

# storage pricing (approximate US East prices per GB/month)
declare -A STORAGE_PRICES
STORAGE_PRICES[StandardStorage]=0.023
STORAGE_PRICES[StandardIAStorage]=0.0125
STORAGE_PRICES[GlacierInstantRetrievalStorage]=0.004
STORAGE_PRICES[IntelligentTieringFAStorage]=0.023
STORAGE_PRICES[IntelligentTieringIAStorage]=0.0125

# query all BucketSizeBytes metrics across all buckets and storage types
echo "🔭 Fetching BucketSizeBytes metrics..."
SIZE_METRICS=$(aws cloudwatch list-metrics \
  --namespace AWS/S3 \
  --metric-name BucketSizeBytes \
  --output json)
echo "$SIZE_METRICS" > "$RAW_SIZE_METRICS_FILE"

# query all NumberOfObjects metrics
echo "🔭 Fetching NumberOfObjects metrics..."
OBJECT_METRICS=$(aws cloudwatch list-metrics \
  --namespace AWS/S3 \
  --metric-name NumberOfObjects \
  --output json)
echo "$OBJECT_METRICS" > "$RAW_OBJECT_METRICS_FILE"

# temp file to collect data
TEMP_DATA=$(mktemp)

# build metric queries for get-metric-data (batch API)
echo "🔭 Building metric queries..."

# build queries for object counts
OBJECT_QUERIES=$(echo "$OBJECT_METRICS" | jq -r '
  .Metrics[] |
  select((.Dimensions[] | select(.Name=="StorageType") | .Value) == "AllStorageTypes") |
  {
    Id: ("obj_" + (.Dimensions[] | select(.Name=="BucketName") | .Value | gsub("[^a-zA-Z0-9]"; "_"))),
    MetricStat: {
      Metric: {
        Namespace: "AWS/S3",
        MetricName: "NumberOfObjects",
        Dimensions: .Dimensions
      },
      Period: 86400,
      Stat: "Average"
    }
  }' | jq -s '.')

# build queries for bucket sizes
SIZE_QUERIES=$(echo "$SIZE_METRICS" | jq -r --argjson prices '{"StandardStorage":1,"StandardIAStorage":1,"GlacierInstantRetrievalStorage":1,"IntelligentTieringFAStorage":1,"IntelligentTieringIAStorage":1}' '
  .Metrics[] |
  select((.Dimensions[] | select(.Name=="StorageType") | .Value) as $st | $prices[$st]) |
  {
    Id: ("size_" + (.Dimensions[] | select(.Name=="BucketName") | .Value | gsub("[^a-zA-Z0-9]"; "_")) + "_" + (.Dimensions[] | select(.Name=="StorageType") | .Value)),
    MetricStat: {
      Metric: {
        Namespace: "AWS/S3",
        MetricName: "BucketSizeBytes",
        Dimensions: .Dimensions
      },
      Period: 86400,
      Stat: "Average"
    },
    ReturnData: true
  }' | jq -s '.')

# combine all queries (limit to 500 per batch as per AWS limits)
ALL_QUERIES=$(jq -s '.[0] + .[1]' <(echo "$OBJECT_QUERIES") <(echo "$SIZE_QUERIES"))
TOTAL_QUERIES=$(echo "$ALL_QUERIES" | jq 'length')

echo "🔭 Fetching $TOTAL_QUERIES metrics in batches..."

# fetch metrics in batches of 500
BATCH_SIZE=500
BATCH_NUM=0
ALL_RESULTS="[]"

while (( BATCH_NUM * BATCH_SIZE < TOTAL_QUERIES )); do
  BATCH_START=$((BATCH_NUM * BATCH_SIZE))
  CURRENT_BATCH=$(echo "$ALL_QUERIES" | jq ".[$BATCH_START:$BATCH_START+$BATCH_SIZE]")
  BATCH_COUNT=$(echo "$CURRENT_BATCH" | jq 'length')

  echo "   - Batch $((BATCH_NUM + 1)): fetching $BATCH_COUNT metrics..."

  BATCH_RESULTS=$(aws cloudwatch get-metric-data \
    --metric-data-queries "$CURRENT_BATCH" \
    --start-time "$CW_START_TIME" \
    --end-time "$CW_END_TIME" \
    --output json)

  # merge results
  ALL_RESULTS=$(jq -s '.[0].MetricDataResults + .[1].MetricDataResults | {MetricDataResults: .}' \
    <(echo "$ALL_RESULTS" | jq '{MetricDataResults: .}') \
    <(echo "$BATCH_RESULTS"))
  ALL_RESULTS=$(echo "$ALL_RESULTS" | jq '.MetricDataResults')

  BATCH_NUM=$((BATCH_NUM + 1))
done

# save raw metric data results
echo "$ALL_RESULTS" | jq '{MetricDataResults: .}' > "$RAW_METRIC_DATA_FILE"

echo "🔭 Processing results..."

# build object count lookup
declare -A BUCKET_OBJECT_COUNTS
while IFS= read -r result; do
  ID=$(echo "$result" | jq -r '.Id')
  if [[ ! "$ID" =~ ^obj_ ]]; then continue; fi

  VALUE=$(echo "$result" | jq -r '.Values[0] // 0')
  BUCKET_NAME=$(echo "$ID" | sed 's/^obj_//' | sed 's/_/-/g')
  BUCKET_OBJECT_COUNTS["$BUCKET_NAME"]=$(echo "$VALUE" | awk '{printf "%.0f", $0}')
done < <(echo "$ALL_RESULTS" | jq -c '.[]')

# process size metrics
while IFS= read -r result; do
  ID=$(echo "$result" | jq -r '.Id')
  if [[ ! "$ID" =~ ^size_ ]]; then continue; fi

  VALUE=$(echo "$result" | jq -r '.Values[0] // 0')
  if [[ "$VALUE" == "0" ]] || [[ -z "$VALUE" ]]; then continue; fi

  # parse ID: size_{bucket}_{storage_type}
  BUCKET_AND_TYPE=$(echo "$ID" | sed 's/^size_//')

  # extract storage type (last part after last underscore sequence)
  STORAGE_TYPE=$(echo "$BUCKET_AND_TYPE" | grep -oP '(StandardStorage|StandardIAStorage|GlacierInstantRetrievalStorage|IntelligentTieringFAStorage|IntelligentTieringIAStorage)$')

  # extract bucket name (everything before storage type)
  BUCKET_NAME=$(echo "$BUCKET_AND_TYPE" | sed "s/_${STORAGE_TYPE}$//" | sed 's/_/-/g')

  # convert to GB
  SIZE_BYTES=$VALUE
  SIZE_GB=$(echo "scale=6; $SIZE_BYTES / 1024 / 1024 / 1024" | bc)

  # calculate monthly cost
  PRICE_PER_GB=${STORAGE_PRICES[$STORAGE_TYPE]}
  MONTHLY_COST=$(echo "scale=6; $SIZE_GB * $PRICE_PER_GB" | bc)

  # clean storage class name
  STORAGE_CLASS=$(echo "$STORAGE_TYPE" | sed 's/Storage$//' | sed 's/IntelligentTiering/IT-/' | sed 's/GlacierInstantRetrieval/Glacier-IR/')

  # get object count
  TOTAL_OBJECTS=${BUCKET_OBJECT_COUNTS[$BUCKET_NAME]:-0}

  # write to temp file
  echo "$BUCKET_NAME|$STORAGE_CLASS|$SIZE_GB|$TOTAL_OBJECTS|$MONTHLY_COST" >> "$TEMP_DATA"
done < <(echo "$ALL_RESULTS" | jq -c '.[]')

echo "✨ Data collection complete"
echo ""

# write CSV file
echo "bucket.name,storage.class,bucket.size_gb,bucket.files,storage.cost_per_month" > "$CSV_FILE"
sort -t'|' -k5 -rn "$TEMP_DATA" | while IFS='|' read -r BUCKET CLASS SIZE FILES COST; do
  echo "$BUCKET,$CLASS,$SIZE,$FILES,$COST" >> "$CSV_FILE"
done

# write markdown file
{
  echo "# S3 Storage Metrics"
  echo ""
  echo "## Account: $ACCOUNT_NAME"
  echo ""
  echo "Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo ""
  echo "## Storage by Bucket and Class"
  echo ""
  printf "| %-50s | %-20s | %15s | %15s | %20s |\n" "bucket.name" "storage.class" "bucket.size_gb" "bucket.files" "storage.cost_per_mo"
  printf "| %-50s | %-20s | %15s | %15s | %20s |\n" "$(printf '%.0s-' {1..50})" "$(printf '%.0s-' {1..20})" "$(printf '%.0s-' {1..15})" "$(printf '%.0s-' {1..15})" "$(printf '%.0s-' {1..20})"
  sort -t'|' -k5 -rn "$TEMP_DATA" | while IFS='|' read -r BUCKET CLASS SIZE FILES COST; do
    printf "| %-50s | %-20s | %15.3f | %15.0f | \$%19.6f |\n" "$BUCKET" "$CLASS" "$SIZE" "$FILES" "$COST"
  done
  echo ""
} > "$MARKDOWN_FILE"

# calculate summary stats
TOTAL_SIZE=$(awk -F'|' '{sum+=$3} END {printf "%.3f", sum}' "$TEMP_DATA")
TOTAL_COST=$(awk -F'|' '{sum+=$5} END {printf "%.3f", sum}' "$TEMP_DATA")
ENTRY_COUNT=$(wc -l < "$TEMP_DATA")

# append summary to markdown
{
  echo "## Summary"
  echo ""
  echo "- **Total entries**: $ENTRY_COUNT"
  echo "- **Total storage**: ${TOTAL_SIZE} GB"
  echo "- **Total monthly cost**: \$${TOTAL_COST}"
  echo ""
} >> "$MARKDOWN_FILE"

# write JSON summary file
{
  echo "{"
  echo "  \"account\": \"$ACCOUNT_NAME\","
  echo "  \"generated\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\","
  echo "  \"summary\": {"
  echo "    \"total_entries\": $ENTRY_COUNT,"
  echo "    \"total_storage_gb\": $TOTAL_SIZE,"
  echo "    \"total_monthly_cost\": $TOTAL_COST"
  echo "  },"
  echo "  \"buckets\": ["
  sort -t'|' -k5 -rn "$TEMP_DATA" | while IFS='|' read -r BUCKET CLASS SIZE FILES COST; do
    echo "    {"
    echo "      \"bucket_name\": \"$BUCKET\","
    echo "      \"storage_class\": \"$CLASS\","
    echo "      \"size_gb\": $SIZE,"
    echo "      \"files\": $FILES,"
    echo "      \"monthly_cost\": $COST"
    echo "    },"
  done | sed '$ s/,$//'
  echo "  ]"
  echo "}"
} > "${OUTPUT_DIR}/summary.json"

# cleanup
rm -f "$TEMP_DATA"

echo ""
echo "🌊 Summary: $ENTRY_COUNT entries, ${TOTAL_SIZE} GB, \$${TOTAL_COST}/month"
echo ""
echo "🌿 Output files:"
echo "   - $MARKDOWN_FILE"
echo "   - $CSV_FILE"
echo "   - ${OUTPUT_DIR}/summary.json"
echo ""
echo "✨ Done!"
echo ""
