#!/bin/bash
# .what = analyze S3 bucket object usage patterns for storage tier optimization using S3 Metadata
# .why = identify access patterns, path structure, and object sizes to inform tiering decisions

set -euo pipefail

# generate iso datetime for default output path
ISO_DATETIME=$(date -u +%Y_%m_%dT%H_%M_%SZ)

# parse arguments
BUCKET_NAME=""
OUTPUT_DIR=""
REGION=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --bucket)
      BUCKET_NAME="$2"
      shift 2
      ;;
    --output)
      OUTPUT_DIR="$2"
      shift 2
      ;;
    --region)
      REGION="$2"
      shift 2
      ;;
    *)
      echo "⛈️  Error: Unknown argument: $1"
      echo "Usage: $0 --bucket <bucket-name> [--output <directory-path>] [--region <region>]"
      exit 1
      ;;
  esac
done

# validate bucket name is provided
if [[ -z "$BUCKET_NAME" ]]; then
  echo "⛈️  Error: --bucket <bucket-name> is required"
  echo "Usage: $0 --bucket <bucket-name> [--output <directory-path>] [--region <region>]"
  exit 1
fi

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

# set default region if not specified
if [[ -z "$REGION" ]]; then
  REGION=$(aws configure get region || echo "us-east-2")
fi
echo "✨ Region: $REGION"
echo ""

# calculate account ID hash and bucket names
ACCOUNT_ID_HASH=$(echo -n "${ACCOUNT_ID}" | sha256sum | cut -c1-7)
BUCKET_ANALYSIS="ghlitch-${ACCOUNT_ID_HASH}-objects"
ATHENA_OUTPUT="s3://${BUCKET_ANALYSIS}/budget/stats/athena-results/"

# set default output directory if not specified
if [[ -z "$OUTPUT_DIR" ]]; then
  OUTPUT_DIR=".rhachet/getS3BucketUsageEvaluation/${ACCOUNT_NAME}/${BUCKET_NAME}/${ISO_DATETIME}"
fi

# ensure output directory exists
mkdir -p "$OUTPUT_DIR"

# define output file paths
MARKDOWN_FILE="${OUTPUT_DIR}/analysis.md"
CSV_FILE="${OUTPUT_DIR}/summary.csv"
PATH_TREE_FILE="${OUTPUT_DIR}/paths_over_1gb.tree"
ACCESS_TABLE_FILE="${OUTPUT_DIR}/access_tiers.csv"
RAW_RESULTS_DIR="${OUTPUT_DIR}/athena_results"

mkdir -p "$RAW_RESULTS_DIR"

echo "🌊 Step 1: Checking S3 Metadata configuration..."
echo ""

# check if S3 Metadata is configured for this bucket and get table ARNs
CONFIG_OUTPUT=$(aws s3api get-bucket-metadata-configuration \
  --bucket "$BUCKET_NAME" \
  --region "$REGION" 2>&1)

if [[ $? -ne 0 ]]; then
  echo "⛈️  Error: S3 Metadata is not configured for bucket: $BUCKET_NAME"
  echo ""
  echo "S3 Metadata must be enabled before running this analysis."
  echo ""
  echo "To enable S3 Metadata, run:"
  echo "  ./setS3BucketUsageObservability.sh --bucket $BUCKET_NAME --region $REGION"
  echo ""
  echo "This will:"
  echo "  1. Enable S3 Metadata (V2 API - AWS auto-creates tables)"
  echo "  2. Initial backfill completes within ~1 hour"
  echo ""
  echo "After backfill completes, re-run this script."
  exit 1
fi

echo "✓ S3 Metadata is configured"
echo ""

# extract table ARNs from configuration
INVENTORY_ARN=$(echo "$CONFIG_OUTPUT" | jq -r '.GetBucketMetadataConfigurationResult.MetadataConfigurationResult.InventoryTableConfigurationResult.TableArn')
INVENTORY_STATUS=$(echo "$CONFIG_OUTPUT" | jq -r '.GetBucketMetadataConfigurationResult.MetadataConfigurationResult.InventoryTableConfigurationResult.TableStatus')

if [[ -z "$INVENTORY_ARN" ]] || [[ "$INVENTORY_ARN" == "null" ]]; then
  echo "⛈️  Error: Could not retrieve inventory table ARN"
  echo ""
  echo "The S3 Metadata configuration may be incomplete or corrupted."
  echo ""
  exit 1
fi

echo "✓ Inventory table ARN: $INVENTORY_ARN"
echo "✓ Inventory table status: $INVENTORY_STATUS"
echo ""

# check if inventory table backfill is complete
if [[ "$INVENTORY_STATUS" == "BACKFILLING" ]]; then
  echo "⚠️  Warning: Inventory table is still backfilling"
  echo ""
  echo "The inventory table is being populated with existing object metadata."
  echo "This typically completes within 1 hour of enabling S3 Metadata."
  echo ""
  echo "You can:"
  echo "  1. Wait for backfill to complete for accurate historical data"
  echo "  2. Continue now for partial data (recently modified objects only)"
  echo ""
  read -p "Continue with partial data? [y/N] " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Exiting. Re-run this script after backfill completes."
    exit 0
  fi
  echo ""
fi

# Check if Glue table exists for this bucket
GLUE_TABLE_NAME=$(echo "${BUCKET_NAME}" | tr '-' '_' | tr '.' '_')_inventory
echo "🔭 Checking for Glue table: s3_metadata.${GLUE_TABLE_NAME}"

if aws glue get-table \
  --database-name "s3_metadata" \
  --name "${GLUE_TABLE_NAME}" \
  --region "$REGION" &>/dev/null; then
  echo "✓ Glue table found"
  TABLE_ARN="${GLUE_TABLE_NAME}"
  USE_GLUE_TABLE=true
else
  echo "⛈️  Error: Glue table not found for this bucket"
  echo ""
  echo "S3 Metadata V2 tables must be registered in Glue Data Catalog to query via Athena."
  echo ""
  echo "To register this bucket's metadata table, run:"
  echo "  ./setS3BucketUsageObservability.sh --bucket $BUCKET_NAME --region $REGION"
  echo ""
  echo "This will:"
  echo "  1. Ensure S3 Metadata is enabled"
  echo "  2. Create Glue database: s3_metadata"
  echo "  3. Register table: s3_metadata.${GLUE_TABLE_NAME}"
  echo ""
  exit 1
fi
echo ""

# ensure analysis bucket exists
echo "🔭 Checking analysis bucket..."
if ! aws s3api head-bucket --bucket "$BUCKET_ANALYSIS" &>/dev/null; then
  echo "Creating analysis bucket: $BUCKET_ANALYSIS"
  aws s3 mb "s3://${BUCKET_ANALYSIS}" --region "$REGION" > /dev/null
  echo "✓ Created analysis bucket"
else
  echo "✓ Analysis bucket exists"
fi
echo ""

echo "🌊 Step 2: Querying S3 Metadata via Athena..."
echo ""

# helper function to run athena query and wait for results
run_athena_query() {
  local QUERY="$1"
  local OUTPUT_FILE="$2"
  local DESCRIPTION="$3"

  echo "  Running: $DESCRIPTION"

  # start query execution
  EXECUTION_ID=$(aws athena start-query-execution \
    --query-string "$QUERY" \
    --result-configuration "OutputLocation=${ATHENA_OUTPUT}" \
    --query 'QueryExecutionId' \
    --output text \
    --region "$REGION")

  # wait for query to complete (timeout after 5 minutes)
  WAIT_COUNT=0
  while [[ $WAIT_COUNT -lt 60 ]]; do
    STATUS=$(aws athena get-query-execution \
      --query-execution-id "$EXECUTION_ID" \
      --query 'QueryExecution.Status.State' \
      --output text \
      --region "$REGION")

    if [[ "$STATUS" == "SUCCEEDED" ]]; then
      # get results and save
      aws athena get-query-results \
        --query-execution-id "$EXECUTION_ID" \
        --output json \
        --region "$REGION" > "$OUTPUT_FILE"
      echo "    ✓ Complete"
      return 0
    elif [[ "$STATUS" == "FAILED" ]] || [[ "$STATUS" == "CANCELLED" ]]; then
      ERROR_MSG=$(aws athena get-query-execution \
        --query-execution-id "$EXECUTION_ID" \
        --query 'QueryExecution.Status.StateChangeReason' \
        --output text \
        --region "$REGION")
      echo "    ✗ Query failed: $ERROR_MSG"
      return 1
    fi

    WAIT_COUNT=$((WAIT_COUNT + 1))
    sleep 5
  done

  echo "    ✗ Query timed out after 5 minutes"
  return 1
}

# query 1: access pattern analysis
QUERY_ACCESS_PATTERNS="
SELECT
  CASE
    WHEN DATE_DIFF('day', last_modified_date, CURRENT_TIMESTAMP) < 1 THEN '0-1 days'
    WHEN DATE_DIFF('day', last_modified_date, CURRENT_TIMESTAMP) < 3 THEN '1-3 days'
    WHEN DATE_DIFF('day', last_modified_date, CURRENT_TIMESTAMP) < 30 THEN '3-30 days'
    WHEN DATE_DIFF('day', last_modified_date, CURRENT_TIMESTAMP) < 90 THEN '30-90 days'
    WHEN DATE_DIFF('day', last_modified_date, CURRENT_TIMESTAMP) < 180 THEN '90-180 days'
    ELSE '180+ days'
  END as age_bucket,
  COUNT(*) as object_count,
  ROUND(SUM(size) / 1024.0 / 1024.0 / 1024.0, 3) as total_size_gb,
  SUM(CASE WHEN size < 131072 THEN 1 ELSE 0 END) as objects_lt_128kb,
  SUM(CASE WHEN size >= 131072 THEN 1 ELSE 0 END) as objects_gte_128kb
FROM s3_metadata.${TABLE_ARN}
GROUP BY 1
ORDER BY MIN(DATE_DIFF('day', last_modified_date, CURRENT_TIMESTAMP))
"

# query 2: path analysis (top-level directories over 1GB)
QUERY_PATH_ANALYSIS="
SELECT
  CASE
    WHEN POSITION('/' IN key) > 0
    THEN SUBSTRING(key, 1, POSITION('/' IN key) - 1)
    ELSE '(root)'
  END as path,
  COUNT(*) as object_count,
  ROUND(SUM(size) / 1024.0 / 1024.0 / 1024.0, 2) as total_size_gb
FROM s3_metadata.${TABLE_ARN}
GROUP BY 1
HAVING total_size_gb >= 1.0
ORDER BY total_size_gb DESC
LIMIT 100
"

# query 3: overall stats
QUERY_OVERALL_STATS="
SELECT
  COUNT(*) as total_objects,
  ROUND(SUM(size) / 1024.0 / 1024.0 / 1024.0, 2) as total_size_gb,
  SUM(CASE WHEN size < 131072 THEN 1 ELSE 0 END) as objects_lt_128kb,
  SUM(CASE WHEN size >= 131072 THEN 1 ELSE 0 END) as objects_gte_128kb
FROM s3_metadata.${TABLE_ARN}
"

# run queries
if ! run_athena_query "$QUERY_ACCESS_PATTERNS" "${RAW_RESULTS_DIR}/access_patterns.json" "Access pattern analysis"; then
  echo "Failed to query access patterns"
  exit 1
fi

if ! run_athena_query "$QUERY_PATH_ANALYSIS" "${RAW_RESULTS_DIR}/path_analysis.json" "Path analysis (>1GB)"; then
  echo "Failed to query path analysis"
  exit 1
fi

if ! run_athena_query "$QUERY_OVERALL_STATS" "${RAW_RESULTS_DIR}/overall_stats.json" "Overall statistics"; then
  echo "Failed to query overall statistics"
  exit 1
fi

echo ""
echo "🌊 Step 3: Processing results..."
echo ""

# parse overall stats
OVERALL_RESULTS=$(cat "${RAW_RESULTS_DIR}/overall_stats.json")
TOTAL_OBJECTS=$(echo "$OVERALL_RESULTS" | jq -r '.ResultSet.Rows[1].Data[0].VarCharValue')
TOTAL_SIZE_GB=$(echo "$OVERALL_RESULTS" | jq -r '.ResultSet.Rows[1].Data[1].VarCharValue')
TOTAL_SMALL=$(echo "$OVERALL_RESULTS" | jq -r '.ResultSet.Rows[1].Data[2].VarCharValue')
TOTAL_LARGE=$(echo "$OVERALL_RESULTS" | jq -r '.ResultSet.Rows[1].Data[3].VarCharValue')

echo "✨ Total objects: $(printf "%'d" "$TOTAL_OBJECTS" 2>/dev/null || echo "$TOTAL_OBJECTS")"
echo "✨ Total size: ${TOTAL_SIZE_GB} GB"
echo ""

# generate access tier CSV
{
  echo "access_tier,days_since_modified,size_gb,object_count,objects_lt_128kb,objects_gte_128kb"

  ACCESS_RESULTS=$(cat "${RAW_RESULTS_DIR}/access_patterns.json")
  ROW_COUNT=$(echo "$ACCESS_RESULTS" | jq '.ResultSet.Rows | length')

  for ((i=1; i<ROW_COUNT; i++)); do
    AGE_BUCKET=$(echo "$ACCESS_RESULTS" | jq -r ".ResultSet.Rows[$i].Data[0].VarCharValue")
    OBJ_COUNT=$(echo "$ACCESS_RESULTS" | jq -r ".ResultSet.Rows[$i].Data[1].VarCharValue")
    SIZE_GB=$(echo "$ACCESS_RESULTS" | jq -r ".ResultSet.Rows[$i].Data[2].VarCharValue")
    SMALL_COUNT=$(echo "$ACCESS_RESULTS" | jq -r ".ResultSet.Rows[$i].Data[3].VarCharValue")
    LARGE_COUNT=$(echo "$ACCESS_RESULTS" | jq -r ".ResultSet.Rows[$i].Data[4].VarCharValue")

    echo "$AGE_BUCKET,$AGE_BUCKET,$SIZE_GB,$OBJ_COUNT,$SMALL_COUNT,$LARGE_COUNT"
  done
} > "$ACCESS_TABLE_FILE"

# generate path tree
{
  echo "S3 Bucket Path Tree (paths with >1GB)"
  echo "Bucket: $BUCKET_NAME"
  echo "Account: $ACCOUNT_NAME"
  echo "Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo ""

  PATH_RESULTS=$(cat "${RAW_RESULTS_DIR}/path_analysis.json")
  PATH_COUNT=$(echo "$PATH_RESULTS" | jq '.ResultSet.Rows | length')
  PATH_COUNT=$((PATH_COUNT - 1))  # subtract header row

  if [[ $PATH_COUNT -eq 0 ]]; then
    echo "No paths found with >1GB of data"
  else
    echo "Found $PATH_COUNT paths with >1GB of data"
    echo ""

    for ((i=1; i<=PATH_COUNT; i++)); do
      PATH=$(echo "$PATH_RESULTS" | jq -r ".ResultSet.Rows[$i].Data[0].VarCharValue")
      OBJ_COUNT=$(echo "$PATH_RESULTS" | jq -r ".ResultSet.Rows[$i].Data[1].VarCharValue")
      SIZE_GB=$(echo "$PATH_RESULTS" | jq -r ".ResultSet.Rows[$i].Data[2].VarCharValue")

      if [[ $i -eq $PATH_COUNT ]]; then
        PREFIX="└──"
      else
        PREFIX="├──"
      fi

      echo "$PREFIX $PATH"
      echo "    ├── size: ${SIZE_GB} GB"
      echo "    └── files: $(printf "%'d" "$OBJ_COUNT" 2>/dev/null || echo "$OBJ_COUNT")"

      if [[ $i -ne $PATH_COUNT ]]; then
        echo ""
      fi
    done
  fi
} > "$PATH_TREE_FILE"

# generate markdown report
{
  echo "# S3 Bucket Usage Evaluation"
  echo ""
  echo "**Bucket:** $BUCKET_NAME"
  echo "**Account:** $ACCOUNT_NAME"
  echo "**Data Source:** S3 Metadata V2 API (via Athena)"
  echo "**Inventory Table ARN:** $INVENTORY_ARN"
  echo "**Inventory Status:** $INVENTORY_STATUS"
  echo "**Generated:** $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo ""
  echo "---"
  echo ""

  echo "## Summary"
  echo ""
  echo "- **Total objects:** $(printf "%'d" "$TOTAL_OBJECTS" 2>/dev/null || echo "$TOTAL_OBJECTS")"
  echo "- **Total size:** ${TOTAL_SIZE_GB} GB"

  PCT_SMALL=$(echo "scale=1; $TOTAL_SMALL * 100 / $TOTAL_OBJECTS" | bc)
  PCT_LARGE=$(echo "scale=1; $TOTAL_LARGE * 100 / $TOTAL_OBJECTS" | bc)

  echo "- **Objects <128KB:** $(printf "%'d" "$TOTAL_SMALL" 2>/dev/null || echo "$TOTAL_SMALL") (${PCT_SMALL}%)"
  echo "- **Objects ≥128KB:** $(printf "%'d" "$TOTAL_LARGE" 2>/dev/null || echo "$TOTAL_LARGE") (${PCT_LARGE}%)"
  echo ""

  echo "---"
  echo ""

  echo "## Access Tier Analysis"
  echo ""
  echo "Objects grouped by days since last modified (LastModified timestamp):"
  echo ""

  printf "| %-15s | %-20s | %15s | %15s | %20s | %20s |\n" "Access Tier" "Days Since Modified" "Size (GB)" "Object Count" "Objects <128KB" "Objects ≥128KB"
  printf "| %-15s | %-20s | %15s | %15s | %20s | %20s |\n" "$(printf '%.0s-' {1..15})" "$(printf '%.0s-' {1..20})" "$(printf '%.0s-' {1..15})" "$(printf '%.0s-' {1..15})" "$(printf '%.0s-' {1..20})" "$(printf '%.0s-' {1..20})"

  ACCESS_RESULTS=$(cat "${RAW_RESULTS_DIR}/access_patterns.json")
  ROW_COUNT=$(echo "$ACCESS_RESULTS" | jq '.ResultSet.Rows | length')

  for ((i=1; i<ROW_COUNT; i++)); do
    AGE_BUCKET=$(echo "$ACCESS_RESULTS" | jq -r ".ResultSet.Rows[$i].Data[0].VarCharValue")
    OBJ_COUNT=$(echo "$ACCESS_RESULTS" | jq -r ".ResultSet.Rows[$i].Data[1].VarCharValue")
    SIZE_GB=$(echo "$ACCESS_RESULTS" | jq -r ".ResultSet.Rows[$i].Data[2].VarCharValue")
    SMALL_COUNT=$(echo "$ACCESS_RESULTS" | jq -r ".ResultSet.Rows[$i].Data[3].VarCharValue")
    LARGE_COUNT=$(echo "$ACCESS_RESULTS" | jq -r ".ResultSet.Rows[$i].Data[4].VarCharValue")

    printf "| %-15s | %-20s | %15s | %15s | %20s | %20s |\n" \
      "$AGE_BUCKET" \
      "$AGE_BUCKET" \
      "$SIZE_GB" \
      "$(printf "%'d" "$OBJ_COUNT" 2>/dev/null || echo "$OBJ_COUNT")" \
      "$(printf "%'d" "$SMALL_COUNT" 2>/dev/null || echo "$SMALL_COUNT")" \
      "$(printf "%'d" "$LARGE_COUNT" 2>/dev/null || echo "$LARGE_COUNT")"
  done

  echo ""

  echo "---"
  echo ""

  echo "## Path Analysis"
  echo ""
  echo "Paths with >1GB of data (see \`paths_over_1gb.tree\` for detailed tree view):"
  echo ""

  PATH_RESULTS=$(cat "${RAW_RESULTS_DIR}/path_analysis.json")
  PATH_COUNT=$(echo "$PATH_RESULTS" | jq '.ResultSet.Rows | length')
  PATH_COUNT=$((PATH_COUNT - 1))

  if [[ $PATH_COUNT -eq 0 ]]; then
    echo "No paths found with >1GB of data"
  else
    echo "Found **$PATH_COUNT paths** with >1GB of data"
    echo ""
    echo "Top 10 paths by size:"
    echo ""

    printf "| %-60s | %15s | %15s |\n" "Path" "Size (GB)" "File Count"
    printf "| %-60s | %15s | %15s |\n" "$(printf '%.0s-' {1..60})" "$(printf '%.0s-' {1..15})" "$(printf '%.0s-' {1..15})"

    SHOW_COUNT=$((PATH_COUNT < 10 ? PATH_COUNT : 10))
    for ((i=1; i<=SHOW_COUNT; i++)); do
      PATH=$(echo "$PATH_RESULTS" | jq -r ".ResultSet.Rows[$i].Data[0].VarCharValue")
      OBJ_COUNT=$(echo "$PATH_RESULTS" | jq -r ".ResultSet.Rows[$i].Data[1].VarCharValue")
      SIZE_GB=$(echo "$PATH_RESULTS" | jq -r ".ResultSet.Rows[$i].Data[2].VarCharValue")

      # truncate path if too long
      DISPLAY_PATH="$PATH"
      if [[ ${#DISPLAY_PATH} -gt 60 ]]; then
        DISPLAY_PATH="${DISPLAY_PATH:0:57}..."
      fi

      printf "| %-60s | %15s | %15s |\n" \
        "$DISPLAY_PATH" \
        "$SIZE_GB" \
        "$(printf "%'d" "$OBJ_COUNT" 2>/dev/null || echo "$OBJ_COUNT")"
    done
  fi

  echo ""

  echo "---"
  echo ""

  echo "## Interpretation Notes"
  echo ""
  echo "### Access Tiers"
  echo ""
  echo "- **0-1 days:** Very recently modified - ideal for Standard storage"
  echo "- **1-3 days:** Recently modified - ideal for Standard storage"
  echo "- **3-30 days:** Modified within the month - consider Standard or Intelligent Tiering"
  echo "- **30-90 days:** Quarterly accessed - good candidates for Intelligent Tiering or Standard-IA"
  echo "- **90-180 days:** Semi-annually accessed - candidates for Intelligent Tiering Archive Access"
  echo "- **180+ days:** Rarely accessed - strong candidates for Glacier Instant Retrieval or Deep Archive"
  echo ""
  echo "### Object Size Considerations"
  echo ""
  echo "- **Objects <128KB:** Always charged at Frequent Access tier rate in Intelligent Tiering"
  echo "- **Objects ≥128KB:** Can benefit from automatic tiering based on access patterns"
  echo ""
  echo "If a large percentage of objects are <128KB, Intelligent Tiering monitoring costs may not be worthwhile."
  echo ""
  echo "### About S3 Metadata V2 API"
  echo ""
  echo "This analysis uses S3 Metadata V2 API, the modern replacement for S3 Inventory:"
  echo ""
  echo "- **Data freshness:** Hourly updates + near real-time journal table"
  echo "- **Query performance:** Apache Iceberg columnar format with predicate pushdown"
  echo "- **Cost:** ~\$0.0025 per million objects/month"
  echo "- **No setup delay:** First data available within 1 hour"
  echo "- **AWS-managed:** Tables auto-created in AWS S3 Tables bucket"
  echo ""
  echo "### Next Steps"
  echo ""
  echo "1. Review the access tier distribution above"
  echo "2. Consider enabling Intelligent Tiering if:"
  echo "   - >70% of data is in 90d+ tiers"
  echo "   - >50% of objects are ≥128KB"
  echo "   - Bucket costs >$1/month"
  echo "3. Use \`setS3BucketTierOptimization.sh\` to apply tier optimizations"
  echo "4. Review \`paths_over_1gb.tree\` to understand data organization"
  echo ""
} > "$MARKDOWN_FILE"

# write summary CSV
{
  echo "metric,value"
  echo "bucket_name,$BUCKET_NAME"
  echo "account,$ACCOUNT_NAME"
  echo "generated,$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "total_objects,$TOTAL_OBJECTS"
  echo "total_size_gb,$TOTAL_SIZE_GB"
  echo "objects_lt_128kb,$TOTAL_SMALL"
  echo "objects_gte_128kb,$TOTAL_LARGE"
  echo "pct_lt_128kb,$PCT_SMALL"
  echo "pct_gte_128kb,$PCT_LARGE"
  echo "data_source,s3_metadata_v2"
  echo "inventory_table_arn,$INVENTORY_ARN"
  echo "inventory_status,$INVENTORY_STATUS"
} > "$CSV_FILE"

echo "✨ Analysis complete!"
echo ""
echo "📊 Results:"
echo "   - Total objects: $(printf "%'d" "$TOTAL_OBJECTS" 2>/dev/null || echo "$TOTAL_OBJECTS")"
echo "   - Total size: ${TOTAL_SIZE_GB} GB"
echo "   - Objects <128KB: $(printf "%'d" "$TOTAL_SMALL" 2>/dev/null || echo "$TOTAL_SMALL") (${PCT_SMALL}%)"
echo "   - Objects ≥128KB: $(printf "%'d" "$TOTAL_LARGE" 2>/dev/null || echo "$TOTAL_LARGE") (${PCT_LARGE}%)"
echo ""
echo "🌿 Output files:"
echo "   - $MARKDOWN_FILE"
echo "   - $PATH_TREE_FILE"
echo "   - $ACCESS_TABLE_FILE"
echo "   - $CSV_FILE"
echo ""
echo "✨ Done!"
echo ""
