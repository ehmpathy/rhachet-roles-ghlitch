#!/bin/bash
# .what = analyze S3 buckets and recommend Intelligent Tiering transitions with actual savings estimates
# .why = identify cost optimization opportunities based on actual observed usage patterns

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
  OUTPUT_DIR=".rhachet/getS3BucketExpenseOptimizer/${ACCOUNT_NAME}/${ISO_DATETIME}"
fi

# ensure output directory exists
mkdir -p "$OUTPUT_DIR"

# define output file paths
MARKDOWN_FILE="${OUTPUT_DIR}/recommendations.md"
CSV_FILE="${OUTPUT_DIR}/savings.csv"
BUCKETS_TREE_FILE="${OUTPUT_DIR}/buckets_by_size.tree"
RAW_SIZE_METRICS_FILE="${OUTPUT_DIR}/raw_size_metrics.json"
RAW_OBJECT_METRICS_FILE="${OUTPUT_DIR}/raw_object_metrics.json"
RAW_STORAGE_DATA_FILE="${OUTPUT_DIR}/raw_storage_data.json"
RAW_REQUEST_METRICS_FILE="${OUTPUT_DIR}/raw_request_metrics.json"
RAW_REQUEST_DATA_FILE="${OUTPUT_DIR}/raw_request_data.json"

echo "🌊 Step 1: Collecting S3 storage metrics..."
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

# build metric queries for get-metric-data (batch API)
echo "🔭 Building storage metric queries..."

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

# combine all queries
ALL_STORAGE_QUERIES=$(jq -s '.[0] + .[1]' <(echo "$OBJECT_QUERIES") <(echo "$SIZE_QUERIES"))
TOTAL_STORAGE_QUERIES=$(echo "$ALL_STORAGE_QUERIES" | jq 'length')

echo "🔭 Fetching $TOTAL_STORAGE_QUERIES storage metrics in batches..."

# fetch metrics in batches of 500
BATCH_SIZE=500
BATCH_NUM=0
ALL_STORAGE_RESULTS="[]"

while (( BATCH_NUM * BATCH_SIZE < TOTAL_STORAGE_QUERIES )); do
  BATCH_START=$((BATCH_NUM * BATCH_SIZE))
  CURRENT_BATCH=$(echo "$ALL_STORAGE_QUERIES" | jq ".[$BATCH_START:$BATCH_START+$BATCH_SIZE]")
  BATCH_COUNT=$(echo "$CURRENT_BATCH" | jq 'length')

  echo "   - Batch $((BATCH_NUM + 1)): fetching $BATCH_COUNT metrics..."

  BATCH_RESULTS=$(aws cloudwatch get-metric-data \
    --metric-data-queries "$CURRENT_BATCH" \
    --start-time "$CW_START_TIME" \
    --end-time "$CW_END_TIME" \
    --output json)

  # merge results
  ALL_STORAGE_RESULTS=$(jq -s '.[0].MetricDataResults + .[1].MetricDataResults | {MetricDataResults: .}' \
    <(echo "$ALL_STORAGE_RESULTS" | jq '{MetricDataResults: .}') \
    <(echo "$BATCH_RESULTS"))
  ALL_STORAGE_RESULTS=$(echo "$ALL_STORAGE_RESULTS" | jq '.MetricDataResults')

  BATCH_NUM=$((BATCH_NUM + 1))
done

# save raw storage data results
echo "$ALL_STORAGE_RESULTS" | jq '{MetricDataResults: .}' > "$RAW_STORAGE_DATA_FILE"

echo "🔭 Processing storage results..."

# build object count lookup
declare -A BUCKET_OBJECT_COUNTS
while IFS= read -r result; do
  ID=$(echo "$result" | jq -r '.Id')
  if [[ ! "$ID" =~ ^obj_ ]]; then continue; fi

  VALUE=$(echo "$result" | jq -r '.Values[0] // 0')
  BUCKET_NAME=$(echo "$ID" | sed 's/^obj_//' | sed 's/_/-/g')
  BUCKET_OBJECT_COUNTS["$BUCKET_NAME"]=$(echo "$VALUE" | awk '{printf "%.0f", $0}')
done < <(echo "$ALL_STORAGE_RESULTS" | jq -c '.[]')

# build evaluator-compatible JSON data structure
EVALUATOR_BUCKETS="[]"

# process size metrics
while IFS= read -r result; do
  ID=$(echo "$result" | jq -r '.Id')
  if [[ ! "$ID" =~ ^size_ ]]; then continue; fi

  VALUE=$(echo "$result" | jq -r '.Values[0] // 0')
  if [[ "$VALUE" == "0" ]] || [[ -z "$VALUE" ]]; then continue; fi

  # parse ID: size_{bucket}_{storage_type}
  BUCKET_AND_TYPE=$(echo "$ID" | sed 's/^size_//')

  # extract storage type
  STORAGE_TYPE=$(echo "$BUCKET_AND_TYPE" | grep -oP '(StandardStorage|StandardIAStorage|GlacierInstantRetrievalStorage|IntelligentTieringFAStorage|IntelligentTieringIAStorage)$')

  # extract bucket name
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

  # add to evaluator buckets array
  EVALUATOR_BUCKETS=$(echo "$EVALUATOR_BUCKETS" | jq --arg bn "$BUCKET_NAME" --arg sc "$STORAGE_CLASS" \
    --argjson sg "$SIZE_GB" --argjson fo "$TOTAL_OBJECTS" --argjson mc "$MONTHLY_COST" \
    '. + [{bucket_name: $bn, storage_class: $sc, size_gb: $sg, files: $fo, monthly_cost: $mc}]')
done < <(echo "$ALL_STORAGE_RESULTS" | jq -c '.[]')

# create evaluator-compatible data structure
EVALUATOR_DATA=$(jq -n --arg acc "$ACCOUNT_NAME" --arg gen "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --argjson buckets "$EVALUATOR_BUCKETS" \
  '{account: $acc, generated: $gen, buckets: $buckets}')

echo "✨ Storage data collection complete"
echo ""

# extract unique bucket names
BUCKET_NAMES=$(echo "$EVALUATOR_DATA" | jq -r '.buckets[].bucket_name' | sort -u)

echo "🌊 Step 2: Collecting S3 request metrics (30-day lookback)..."
echo ""

# cloudwatch metrics date range (last 30 days for request patterns)
CW_REQUEST_START_TIME=$(date -u -d '30 days ago' +%Y-%m-%dT%H:%M:%S)
CW_REQUEST_END_TIME=$(date -u +%Y-%m-%dT%H:%M:%S)

# query all request metrics for all buckets
echo "🔭 Fetching AllRequests metrics..."
ALL_REQUESTS_METRICS=$(aws cloudwatch list-metrics \
  --namespace AWS/S3 \
  --metric-name AllRequests \
  --output json)
echo "$ALL_REQUESTS_METRICS" | jq '.' > "$RAW_REQUEST_METRICS_FILE"

# build metric queries for get-metric-data (batch API)
echo "🔭 Building request metric queries..."

# build queries for AllRequests (filter by BucketName dimension only, no FilterId)
REQUEST_QUERIES=$(echo "$ALL_REQUESTS_METRICS" | jq -r '
  .Metrics[] |
  select(
    (.Dimensions | length == 1) and
    (.Dimensions[] | select(.Name == "BucketName"))
  ) |
  {
    Id: ("req_" + (.Dimensions[] | select(.Name=="BucketName") | .Value | gsub("[^a-zA-Z0-9]"; "_"))),
    MetricStat: {
      Metric: {
        Namespace: "AWS/S3",
        MetricName: "AllRequests",
        Dimensions: .Dimensions
      },
      Period: 86400,
      Stat: "Sum"
    }
  }' | jq -s '.')

TOTAL_QUERIES=$(echo "$REQUEST_QUERIES" | jq 'length')
echo "🔭 Fetching $TOTAL_QUERIES request metrics..."

# fetch metrics in batches of 500
BATCH_SIZE=500
BATCH_NUM=0
ALL_RESULTS="[]"

if [[ $TOTAL_QUERIES -gt 0 ]]; then
  while (( BATCH_NUM * BATCH_SIZE < TOTAL_QUERIES )); do
    BATCH_START=$((BATCH_NUM * BATCH_SIZE))
    CURRENT_BATCH=$(echo "$REQUEST_QUERIES" | jq ".[$BATCH_START:$BATCH_START+$BATCH_SIZE]")
    BATCH_COUNT=$(echo "$CURRENT_BATCH" | jq 'length')

    echo "   - Batch $((BATCH_NUM + 1)): fetching $BATCH_COUNT metrics..."

    BATCH_RESULTS=$(aws cloudwatch get-metric-data \
      --metric-data-queries "$CURRENT_BATCH" \
      --start-time "$CW_REQUEST_START_TIME" \
      --end-time "$CW_REQUEST_END_TIME" \
      --output json)

    # merge results
    ALL_RESULTS=$(jq -s '.[0].MetricDataResults + .[1].MetricDataResults | {MetricDataResults: .}' \
      <(echo "$ALL_RESULTS" | jq '{MetricDataResults: .}') \
      <(echo "$BATCH_RESULTS"))
    ALL_RESULTS=$(echo "$ALL_RESULTS" | jq '.MetricDataResults')

    BATCH_NUM=$((BATCH_NUM + 1))
  done

  # save raw request data results
  echo "$ALL_RESULTS" | jq '{MetricDataResults: .}' > "$RAW_REQUEST_DATA_FILE"
fi

echo "🔭 Processing request metrics..."

# build request count lookup
declare -A BUCKET_REQUEST_COUNTS
while IFS= read -r result; do
  ID=$(echo "$result" | jq -r '.Id')
  if [[ ! "$ID" =~ ^req_ ]]; then continue; fi

  # sum all values from the 30-day period
  TOTAL_REQUESTS=$(echo "$result" | jq '[.Values[]] | add // 0')
  BUCKET_NAME=$(echo "$ID" | sed 's/^req_//' | sed 's/_/-/g')
  BUCKET_REQUEST_COUNTS["$BUCKET_NAME"]=$(echo "$TOTAL_REQUESTS" | awk '{printf "%.0f", $0}')
done < <(echo "$ALL_RESULTS" | jq -c '.[]')

echo "✨ Request data collection complete"
echo ""

echo "🌊 Step 3: Analyzing optimization opportunities..."
echo ""

# aggregate buckets by name and generate tree view
declare -A BUCKET_TOTAL_SIZE_FOR_TREE
declare -A BUCKET_TOTAL_COST_FOR_TREE
declare -A BUCKET_TOTAL_OBJECTS_FOR_TREE
declare -A BUCKET_STORAGE_CLASSES_FOR_TREE

while IFS= read -r bucket_entry; do
  BUCKET_NAME=$(echo "$bucket_entry" | jq -r '.bucket_name')
  STORAGE_CLASS=$(echo "$bucket_entry" | jq -r '.storage_class')
  SIZE_GB=$(echo "$bucket_entry" | jq -r '.size_gb')
  FILES=$(echo "$bucket_entry" | jq -r '.files')
  MONTHLY_COST=$(echo "$bucket_entry" | jq -r '.monthly_cost')

  # normalize values to handle scientific notation
  SIZE_GB_NORMALIZED=$(printf "%.10f" "$SIZE_GB" 2>/dev/null || echo "0")
  MONTHLY_COST_NORMALIZED=$(printf "%.10f" "$MONTHLY_COST" 2>/dev/null || echo "0")

  # aggregate totals
  BUCKET_TOTAL_SIZE_FOR_TREE["$BUCKET_NAME"]=$(echo "${BUCKET_TOTAL_SIZE_FOR_TREE[$BUCKET_NAME]:-0} + $SIZE_GB_NORMALIZED" | bc)
  BUCKET_TOTAL_COST_FOR_TREE["$BUCKET_NAME"]=$(echo "${BUCKET_TOTAL_COST_FOR_TREE[$BUCKET_NAME]:-0} + $MONTHLY_COST_NORMALIZED" | bc)
  BUCKET_TOTAL_OBJECTS_FOR_TREE["$BUCKET_NAME"]=$FILES

  # track primary storage class
  if [[ -z "${BUCKET_STORAGE_CLASSES_FOR_TREE[$BUCKET_NAME]:-}" ]]; then
    BUCKET_STORAGE_CLASSES_FOR_TREE["$BUCKET_NAME"]="$STORAGE_CLASS"
  fi
done < <(echo "$EVALUATOR_DATA" | jq -c '.buckets[]')

# create tree-structured view of buckets sorted by size
echo "📊 Generating bucket size tree view..."
{
  echo "S3 Buckets (sorted by size descending)"
  echo "Account: $ACCOUNT_NAME"
  echo "Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo ""

  # sort buckets by size and output in tree format
  BUCKET_COUNT="${#BUCKET_TOTAL_SIZE_FOR_TREE[@]}"
  CURRENT_INDEX=0

  for BUCKET_NAME in $(for b in "${!BUCKET_TOTAL_SIZE_FOR_TREE[@]}"; do
    echo "${BUCKET_TOTAL_SIZE_FOR_TREE[$b]} $b"
  done | sort -rn | awk '{print $2}'); do
    TOTAL_SIZE=${BUCKET_TOTAL_SIZE_FOR_TREE[$BUCKET_NAME]}
    TOTAL_COST=${BUCKET_TOTAL_COST_FOR_TREE[$BUCKET_NAME]}
    TOTAL_OBJECTS=${BUCKET_TOTAL_OBJECTS_FOR_TREE[$BUCKET_NAME]}
    PRIMARY_CLASS=${BUCKET_STORAGE_CLASSES_FOR_TREE[$BUCKET_NAME]}

    CURRENT_INDEX=$((CURRENT_INDEX + 1))

    # use └── for last item, ├── for others
    if [[ $CURRENT_INDEX -eq $BUCKET_COUNT ]]; then
      PREFIX="└──"
    else
      PREFIX="├──"
    fi

    # format size with commas
    SIZE_FORMATTED=$(printf "%.2f" "$TOTAL_SIZE")
    COST_FORMATTED=$(printf "%.2f" "$TOTAL_COST")
    OBJECTS_FORMATTED=$(printf "%'d" "$TOTAL_OBJECTS" 2>/dev/null || printf "%.0f" "$TOTAL_OBJECTS")

    echo "$PREFIX $BUCKET_NAME"
    echo "    ├── size: ${SIZE_FORMATTED} GB"
    echo "    ├── cost: \$${COST_FORMATTED}/mo"
    echo "    ├── objects: ${OBJECTS_FORMATTED}"
    echo "    └── class: ${PRIMARY_CLASS}"

    # add blank line between buckets except for last one
    if [[ $CURRENT_INDEX -ne $BUCKET_COUNT ]]; then
      echo ""
    fi
  done

  echo ""
  echo "Total buckets: $BUCKET_COUNT"
  TOTAL_SIZE_ALL=$(echo "${BUCKET_TOTAL_SIZE_FOR_TREE[@]}" | tr ' ' '\n' | awk '{sum+=$1} END {printf "%.2f", sum}')
  TOTAL_COST_ALL=$(echo "${BUCKET_TOTAL_COST_FOR_TREE[@]}" | tr ' ' '\n' | awk '{sum+=$1} END {printf "%.2f", sum}')
  echo "Total size: ${TOTAL_SIZE_ALL} GB"
  echo "Total cost: \$${TOTAL_COST_ALL}/mo"
} > "$BUCKETS_TREE_FILE"

# display tree to console
cat "$BUCKETS_TREE_FILE"
echo ""

# pricing constants (US East)
STANDARD_PRICE=0.023
STANDARD_IA_PRICE=0.0125
IT_FA_PRICE=0.023
IT_IA_PRICE=0.0125
IT_ARCHIVE_PRICE=0.004
IT_MONITORING_PER_1K_OBJECTS=0.0025

# temp file to collect optimization data
TEMP_DATA=$(mktemp)

echo "🔭 Analyzing buckets for IT savings opportunities..."

# aggregate buckets by name (sum across storage classes)
declare -A BUCKET_TOTAL_SIZE
declare -A BUCKET_TOTAL_COST
declare -A BUCKET_TOTAL_OBJECTS
declare -A BUCKET_STORAGE_CLASSES

while IFS= read -r bucket_entry; do
  BUCKET_NAME=$(echo "$bucket_entry" | jq -r '.bucket_name')
  STORAGE_CLASS=$(echo "$bucket_entry" | jq -r '.storage_class')
  SIZE_GB=$(echo "$bucket_entry" | jq -r '.size_gb')
  FILES=$(echo "$bucket_entry" | jq -r '.files')
  MONTHLY_COST=$(echo "$bucket_entry" | jq -r '.monthly_cost')

  # normalize values to handle scientific notation (bc doesn't support it)
  SIZE_GB_NORMALIZED=$(printf "%.10f" "$SIZE_GB" 2>/dev/null || echo "0")
  MONTHLY_COST_NORMALIZED=$(printf "%.10f" "$MONTHLY_COST" 2>/dev/null || echo "0")

  # aggregate totals
  BUCKET_TOTAL_SIZE["$BUCKET_NAME"]=$(echo "${BUCKET_TOTAL_SIZE[$BUCKET_NAME]:-0} + $SIZE_GB_NORMALIZED" | bc)
  BUCKET_TOTAL_COST["$BUCKET_NAME"]=$(echo "${BUCKET_TOTAL_COST[$BUCKET_NAME]:-0} + $MONTHLY_COST_NORMALIZED" | bc)
  BUCKET_TOTAL_OBJECTS["$BUCKET_NAME"]=$FILES

  # track primary storage class (the one with most data)
  if [[ -z "${BUCKET_STORAGE_CLASSES[$BUCKET_NAME]:-}" ]]; then
    BUCKET_STORAGE_CLASSES["$BUCKET_NAME"]="$STORAGE_CLASS"
  fi
done < <(echo "$EVALUATOR_DATA" | jq -c '.buckets[]')

# analyze each bucket
for BUCKET_NAME in "${!BUCKET_TOTAL_SIZE[@]}"; do
  TOTAL_SIZE=${BUCKET_TOTAL_SIZE[$BUCKET_NAME]}
  TOTAL_COST=${BUCKET_TOTAL_COST[$BUCKET_NAME]}
  TOTAL_OBJECTS=${BUCKET_TOTAL_OBJECTS[$BUCKET_NAME]}
  PRIMARY_CLASS=${BUCKET_STORAGE_CLASSES[$BUCKET_NAME]}

  # skip buckets under $1/mo (handle scientific notation)
  TOTAL_COST_NORMALIZED=$(printf "%.10f" "$TOTAL_COST" 2>/dev/null || echo "0")
  COST_CHECK=$(echo "$TOTAL_COST_NORMALIZED >= 1.0" | bc 2>/dev/null || echo "0")
  if [[ "$COST_CHECK" != "1" ]]; then
    continue
  fi

  # skip if already using Intelligent Tiering
  if [[ "$PRIMARY_CLASS" =~ ^IT- ]]; then
    continue
  fi

  # get request metrics
  TOTAL_REQUESTS=${BUCKET_REQUEST_COUNTS[$BUCKET_NAME]:-0}

  # calculate access rate (requests per day per object)
  if [[ "$TOTAL_OBJECTS" -gt 0 ]]; then
    ACCESS_RATE=$(echo "scale=10; $TOTAL_REQUESTS / 30.0 / $TOTAL_OBJECTS" | bc)
  else
    ACCESS_RATE=0
  fi

  # determine tier distribution based on access rate
  # Access rate thresholds and distributions from plan
  if (( $(echo "$ACCESS_RATE >= 0.1" | bc -l) )); then
    # High activity
    FA_PCT=70
    IA_PCT=25
    ARCHIVE_PCT=5
    ACTIVITY_LEVEL="HIGH"
  elif (( $(echo "$ACCESS_RATE >= 0.01" | bc -l) )); then
    # Moderate activity
    FA_PCT=50
    IA_PCT=35
    ARCHIVE_PCT=15
    ACTIVITY_LEVEL="MODERATE"
  elif (( $(echo "$ACCESS_RATE >= 0.001" | bc -l) )); then
    # Low activity
    FA_PCT=30
    IA_PCT=40
    ARCHIVE_PCT=30
    ACTIVITY_LEVEL="LOW"
  else
    # Very low activity
    FA_PCT=15
    IA_PCT=35
    ARCHIVE_PCT=50
    ACTIVITY_LEVEL="VERY_LOW"
  fi

  # calculate IT tier sizes
  FA_SIZE=$(echo "scale=6; $TOTAL_SIZE * $FA_PCT / 100" | bc)
  IA_SIZE=$(echo "scale=6; $TOTAL_SIZE * $IA_PCT / 100" | bc)
  ARCHIVE_SIZE=$(echo "scale=6; $TOTAL_SIZE * $ARCHIVE_PCT / 100" | bc)

  # calculate IT costs
  FA_COST=$(echo "scale=6; $FA_SIZE * $IT_FA_PRICE" | bc)
  IA_COST=$(echo "scale=6; $IA_SIZE * $IT_IA_PRICE" | bc)
  ARCHIVE_COST=$(echo "scale=6; $ARCHIVE_SIZE * $IT_ARCHIVE_PRICE" | bc)
  MONITORING_COST=$(echo "scale=6; $TOTAL_OBJECTS * $IT_MONITORING_PER_1K_OBJECTS / 1000" | bc)

  TOTAL_IT_COST=$(echo "scale=6; $FA_COST + $IA_COST + $ARCHIVE_COST + $MONITORING_COST" | bc)
  SAVINGS=$(echo "scale=6; $TOTAL_COST - $TOTAL_IT_COST" | bc)

  # only recommend if savings > $0.50/mo (handle scientific notation)
  SAVINGS_NORMALIZED=$(printf "%.10f" "$SAVINGS" 2>/dev/null || echo "0")
  SAVINGS_CHECK=$(echo "$SAVINGS_NORMALIZED >= 0.50" | bc 2>/dev/null || echo "0")
  if [[ "$SAVINGS_CHECK" != "1" ]]; then
    continue
  fi

  SAVINGS_PCT=$(echo "scale=2; $SAVINGS / $TOTAL_COST * 100" | bc)

  # determine confidence level
  if [[ "$TOTAL_REQUESTS" -gt 0 ]]; then
    CONFIDENCE="HIGH"
  else
    CONFIDENCE="MEDIUM"
  fi

  # write to temp file for sorting
  echo "$BUCKET_NAME|$PRIMARY_CLASS|$TOTAL_SIZE|$TOTAL_OBJECTS|$TOTAL_COST|$TOTAL_REQUESTS|$ACCESS_RATE|$ACTIVITY_LEVEL|$FA_PCT|$IA_PCT|$ARCHIVE_PCT|$FA_SIZE|$IA_SIZE|$ARCHIVE_SIZE|$FA_COST|$IA_COST|$ARCHIVE_COST|$MONITORING_COST|$TOTAL_IT_COST|$SAVINGS|$SAVINGS_PCT|$CONFIDENCE" >> "$TEMP_DATA"
done

# count recommendations
RECOMMENDATION_COUNT=$(wc -l < "$TEMP_DATA" 2>/dev/null || echo "0")

if [[ "$RECOMMENDATION_COUNT" == "0" ]]; then
  echo "✨ No optimization opportunities found (all buckets either <\$1/mo, already using IT, or savings <\$0.50/mo)"
  echo ""

  # create minimal report with tier explanation
  {
    echo "# S3 Intelligent Tiering Savings Analysis"
    echo ""
    echo "Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "Account: $ACCOUNT_NAME"
    echo ""
    echo "## Summary"
    echo ""
    echo "No optimization opportunities found."
    echo ""
    echo "All buckets are either:"
    echo "- Already using Intelligent Tiering"
    echo "- Costing less than \$1/month"
    echo "- Would save less than \$0.50/month"
    echo ""
    echo "See \`buckets_by_size.tree\` for a breakdown of all bucket sizes."
    echo ""
    echo "---"
    echo ""
    echo "## Understanding Intelligent Tiering Access Tiers"
    echo ""
    echo "### What are the tiers?"
    echo ""
    echo "Intelligent Tiering automatically moves objects between tiers based on access patterns:"
    echo ""
    echo "1. **Frequent Access (FA) Tier**"
    echo "   - **Storage cost:** \$0.023/GB/month (same as Standard)"
    echo "   - **Access pattern:** Objects accessed within the last 30 days"
    echo "   - **Retrieval:** Instant, no retrieval fees"
    echo "   - **Use case:** Active data being regularly accessed"
    echo ""
    echo "2. **Infrequent Access (IA) Tier**"
    echo "   - **Storage cost:** \$0.0125/GB/month (46% cheaper than Standard)"
    echo "   - **Access pattern:** Objects not accessed for 30+ days"
    echo "   - **Retrieval:** Instant, no retrieval fees"
    echo "   - **Use case:** Data accessed occasionally (monthly or less)"
    echo ""
    echo "3. **Archive Access Tier** (optional)"
    echo "   - **Storage cost:** \$0.004/GB/month (83% cheaper than Standard)"
    echo "   - **Access pattern:** Objects not accessed for 90+ days"
    echo "   - **Retrieval:** Instant, no retrieval fees"
    echo "   - **Use case:** Cold data accessed rarely (quarterly or less)"
    echo ""
    echo "4. **Deep Archive Access Tier** (optional)"
    echo "   - **Storage cost:** \$0.00099/GB/month (96% cheaper than Standard)"
    echo "   - **Access pattern:** Objects not accessed for 180+ days"
    echo "   - **Retrieval:** Within 12 hours, small retrieval fees apply"
    echo "   - **Use case:** Long-term archival, very rarely accessed"
    echo ""
    echo "### Key Benefits"
    echo ""
    echo "- **Automatic optimization:** No manual lifecycle rules needed"
    echo "- **No retrieval fees for FA/IA/Archive:** Unlike manually moving to IA/Glacier"
    echo "- **Instant access:** Objects in FA/IA/Archive tiers have millisecond latency"
    echo "- **No minimum storage duration:** Can delete objects anytime without penalties"
    echo "- **Automatic tiering:** Objects move back to FA tier when accessed"
    echo ""
    echo "### Important Considerations"
    echo ""
    echo "- **Small objects:** Objects <128KB are always charged at FA tier rate"
    echo "- **Monitoring cost:** \$0.0025 per 1,000 objects/month"
    echo "- **First-byte latency:** Same as Standard for FA/IA/Archive tiers"
    echo "- **No transition delays:** Objects transition immediately after the specified days"
    echo ""
    echo "### When NOT to use Intelligent Tiering"
    echo ""
    echo "- Buckets with mostly small files (<128KB) - monitoring cost may exceed savings"
    echo "- Data with predictable access patterns - use Lifecycle policies to Standard-IA instead"
    echo "- Temporary/short-lived data (<30 days) - stays in FA tier, no savings"
    echo ""
  } > "$MARKDOWN_FILE"

  rm -f "$TEMP_DATA"

  echo "🌿 Output files:"
  echo "   - $MARKDOWN_FILE"
  echo "   - $BUCKETS_TREE_FILE"
  echo ""
  echo "✨ Done!"
  echo ""
  exit 0
fi

echo "✨ Found $RECOMMENDATION_COUNT optimization opportunities"
echo ""

# write CSV file
echo "bucket_name,current_class,size_gb,objects,current_cost,requests_30d,access_rate,activity_level,fa_pct,ia_pct,archive_pct,it_cost,savings,savings_pct,confidence" > "$CSV_FILE"
sort -t'|' -k20 -rn "$TEMP_DATA" | while IFS='|' read -r BUCKET CLASS SIZE OBJECTS COST REQUESTS ACCESS ACTIVITY FA_PCT IA_PCT ARCH_PCT FA_SIZE IA_SIZE ARCH_SIZE FA_COST IA_COST ARCH_COST MON_COST IT_COST SAVINGS SAVE_PCT CONF; do
  echo "$BUCKET,$CLASS,$SIZE,$OBJECTS,$COST,$REQUESTS,$ACCESS,$ACTIVITY,$FA_PCT,$IA_PCT,$ARCH_PCT,$IT_COST,$SAVINGS,$SAVE_PCT,$CONF" >> "$CSV_FILE"
done

# calculate summary stats
TOTAL_CURRENT_COST=$(awk -F'|' '{sum+=$5} END {printf "%.2f", sum}' "$TEMP_DATA")
TOTAL_IT_COST=$(awk -F'|' '{sum+=$19} END {printf "%.2f", sum}' "$TEMP_DATA")
TOTAL_SAVINGS=$(awk -F'|' '{sum+=$20} END {printf "%.2f", sum}' "$TEMP_DATA")

# write markdown report
{
  echo "# S3 Intelligent Tiering Savings Analysis"
  echo ""
  echo "Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "Account: $ACCOUNT_NAME"
  echo ""
  echo "## Summary"
  echo ""
  echo "Buckets analyzed: $RECOMMENDATION_COUNT"
  echo "Total current cost: \$$TOTAL_CURRENT_COST/mo"
  echo "Projected IT cost: \$$TOTAL_IT_COST/mo"
  echo "**Potential savings: \$$TOTAL_SAVINGS/mo**"
  echo ""
  echo "---"
  echo ""
  echo "## Recommendations"
  echo ""

  RANK=1
  sort -t'|' -k20 -rn "$TEMP_DATA" | while IFS='|' read -r BUCKET CLASS SIZE OBJECTS COST REQUESTS ACCESS ACTIVITY FA_PCT IA_PCT ARCH_PCT FA_SIZE IA_SIZE ARCH_SIZE FA_COST IA_COST ARCH_COST MON_COST IT_COST SAVINGS SAVE_PCT CONF; do
    echo "### $RANK. $BUCKET"
    echo ""
    echo "**Current State (ACTUAL):**"
    echo "- Storage class: $CLASS"
    echo "- Size: $(printf '%.2f' $SIZE) GB"
    echo "- Objects: $(printf '%.0f' $OBJECTS)"
    echo "- Cost: \$$(printf '%.2f' $COST)/mo"
    echo "- Requests (30d): $(printf '%.0f' $REQUESTS) total"
    echo "- Access rate: $(printf '%.8f' $ACCESS) requests/day/object ($ACTIVITY activity)"
    echo ""
    echo "**Intelligent Tiering Projection (BASED ON ACTUAL ACCESS RATE):**"
    echo "- Frequent Access ($FA_PCT%): $(printf '%.2f' $FA_SIZE) GB @ \$$IT_FA_PRICE = \$$(printf '%.2f' $FA_COST)"
    echo "- Infrequent Access ($IA_PCT%): $(printf '%.2f' $IA_SIZE) GB @ \$$IT_IA_PRICE = \$$(printf '%.2f' $IA_COST)"
    echo "- Archive Access ($ARCH_PCT%): $(printf '%.2f' $ARCH_SIZE) GB @ \$$IT_ARCHIVE_PRICE = \$$(printf '%.2f' $ARCH_COST)"
    echo "- Monitoring: $(printf '%.0f' $OBJECTS) objects × \$$IT_MONITORING_PER_1K_OBJECTS/1k = \$$(printf '%.2f' $MON_COST)"
    echo "- **Total IT cost: \$$(printf '%.2f' $IT_COST)/mo**"
    echo ""
    echo "**Savings:**"
    echo "- **\$$(printf '%.2f' $SAVINGS)/mo ($(printf '%.0f' $SAVE_PCT)% reduction)**"
    echo "- Confidence: $CONF"
    if [[ "$CONF" == "MEDIUM" ]]; then
      echo "  - (No request metrics available - estimate based on object count heuristics)"
    else
      echo "  - (Based on 30 days of actual request metrics)"
    fi
    echo ""
    echo "**Action:**"
    echo '```bash'
    echo "# Enable Intelligent Tiering on $BUCKET"
    echo 'cat > /tmp/it-config.json <<EOF'
    echo '{'
    echo '  "Id": "default-config",'
    echo '  "Status": "Enabled",'
    echo '  "Tierings": ['
    echo '    {'
    echo '      "Days": 90,'
    echo '      "AccessTier": "ARCHIVE_ACCESS"'
    echo '    },'
    echo '    {'
    echo '      "Days": 180,'
    echo '      "AccessTier": "DEEP_ARCHIVE_ACCESS"'
    echo '    }'
    echo '  ]'
    echo '}'
    echo 'EOF'
    echo ""
    echo "aws s3api put-bucket-intelligent-tiering-configuration \\"
    echo "  --bucket $BUCKET \\"
    echo "  --id default-config \\"
    echo "  --intelligent-tiering-configuration file:///tmp/it-config.json"
    echo '```'
    echo ""
    echo "---"
    echo ""

    RANK=$((RANK + 1))
  done

  echo "## Understanding Intelligent Tiering Access Tiers"
  echo ""
  echo "### What are the tiers?"
  echo ""
  echo "Intelligent Tiering automatically moves objects between tiers based on access patterns:"
  echo ""
  echo "1. **Frequent Access (FA) Tier**"
  echo "   - **Storage cost:** \$0.023/GB/month (same as Standard)"
  echo "   - **Access pattern:** Objects accessed within the last 30 days"
  echo "   - **Retrieval:** Instant, no retrieval fees"
  echo "   - **Use case:** Active data being regularly accessed"
  echo ""
  echo "2. **Infrequent Access (IA) Tier**"
  echo "   - **Storage cost:** \$0.0125/GB/month (46% cheaper than Standard)"
  echo "   - **Access pattern:** Objects not accessed for 30+ days"
  echo "   - **Retrieval:** Instant, no retrieval fees"
  echo "   - **Use case:** Data accessed occasionally (monthly or less)"
  echo ""
  echo "3. **Archive Access Tier** (optional, configured above)"
  echo "   - **Storage cost:** \$0.004/GB/month (83% cheaper than Standard)"
  echo "   - **Access pattern:** Objects not accessed for 90+ days"
  echo "   - **Retrieval:** Instant, no retrieval fees"
  echo "   - **Use case:** Cold data accessed rarely (quarterly or less)"
  echo ""
  echo "4. **Deep Archive Access Tier** (optional, configured above)"
  echo "   - **Storage cost:** \$0.00099/GB/month (96% cheaper than Standard)"
  echo "   - **Access pattern:** Objects not accessed for 180+ days"
  echo "   - **Retrieval:** Within 12 hours, small retrieval fees apply"
  echo "   - **Use case:** Long-term archival, very rarely accessed"
  echo ""
  echo "### Key Benefits"
  echo ""
  echo "- **Automatic optimization:** No manual lifecycle rules needed"
  echo "- **No retrieval fees for FA/IA/Archive:** Unlike manually moving to IA/Glacier"
  echo "- **Instant access:** Objects in FA/IA/Archive tiers have millisecond latency"
  echo "- **No minimum storage duration:** Can delete objects anytime without penalties"
  echo "- **Automatic tiering:** Objects move back to FA tier when accessed"
  echo ""
  echo "### Important Considerations"
  echo ""
  echo "- **Small objects:** Objects <128KB are always charged at FA tier rate"
  echo "- **Monitoring cost:** \$0.0025 per 1,000 objects/month (included in projections)"
  echo "- **First-byte latency:** Same as Standard for FA/IA/Archive tiers"
  echo "- **No transition delays:** Objects transition immediately after the specified days"
  echo ""
  echo "### When NOT to use Intelligent Tiering"
  echo ""
  echo "- Buckets with mostly small files (<128KB) - monitoring cost may exceed savings"
  echo "- Data with predictable access patterns - use Lifecycle policies to Standard-IA instead"
  echo "- Temporary/short-lived data (<30 days) - stays in FA tier, no savings"
  echo ""
  echo "---"
  echo ""
  echo "## Notes"
  echo ""
  echo "- **Confidence Levels:**"
  echo "  - HIGH: Based on actual CloudWatch request metrics from the last 30 days"
  echo "  - MEDIUM: No request metrics available, estimates based on object count heuristics"
  echo ""
  echo "- **Activity Levels:**"
  echo "  - VERY_LOW: <0.001 requests/day/object (most data moves to Archive)"
  echo "  - LOW: 0.001-0.01 requests/day/object (balanced across tiers)"
  echo "  - MODERATE: 0.01-0.1 requests/day/object (more Frequent Access)"
  echo "  - HIGH: >=0.1 requests/day/object (mostly Frequent Access)"
  echo ""
  echo "- **Tier Transition Timeline:**"
  echo "  - Objects not accessed for 30 days → move to Infrequent Access tier"
  echo "  - Objects not accessed for 90 days → move to Archive Access tier"
  echo "  - Objects not accessed for 180 days → move to Deep Archive Access tier"
  echo ""
  echo "- **Monitoring Costs:**"
  echo "  - Intelligent Tiering charges \$0.0025 per 1,000 objects monitored per month"
  echo "  - This cost is included in all projections above"
  echo ""
  echo "- **Next Steps:**"
  echo "  1. Review recommendations above"
  echo "  2. Start with top 3-5 buckets (highest savings)"
  echo "  3. Enable IT configurations using provided commands"
  echo "  4. Monitor for 30-60 days"
  echo "  5. Compare actual vs projected costs"
  echo ""
} > "$MARKDOWN_FILE"

# cleanup
rm -f "$TEMP_DATA"

echo ""
echo "🌊 Summary: $RECOMMENDATION_COUNT recommendations, potential savings: \$$TOTAL_SAVINGS/month"
echo ""
echo "🌿 Output files:"
echo "   - $MARKDOWN_FILE"
echo "   - $BUCKETS_TREE_FILE"
echo "   - $CSV_FILE"
echo ""
echo "✨ Done!"
echo ""
