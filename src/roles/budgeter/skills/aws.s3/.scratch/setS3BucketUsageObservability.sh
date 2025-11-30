#!/bin/bash
# .what = enable S3 metadata export for usage observability
# .why = gain real-time visibility into object metadata and access patterns for cost optimization

set -euo pipefail

# ensure non-interactive AWS CLI execution
export AWS_PAGER=""

# generate iso datetime for default output path
ISO_DATETIME=$(date -u +%Y_%m_%dT%H_%M_%SZ)

# parse arguments
OUTPUT_DIR=""
BUCKET_NAMES=()
DRYRUN=false
REGION=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --output)
      OUTPUT_DIR="$2"
      shift 2
      ;;
    --bucket)
      BUCKET_NAMES+=("$2")
      shift 2
      ;;
    --region)
      REGION="$2"
      shift 2
      ;;
    --dryrun)
      DRYRUN=true
      shift
      ;;
    *)
      echo "⛈️  Error: Unknown argument: $1"
      echo "Usage: $0 --bucket <bucket-name> [--bucket <bucket-name> ...] [--output <directory-path>] [--region <region>] [--dryrun]"
      echo ""
      echo "Options:"
      echo "  --bucket <name>           Bucket to configure (required, can be repeated for multiple buckets)"
      echo "  --output <dir>            Output directory for logs (default: .rhachet/setS3BucketUsageObservability/<timestamp>)"
      echo "  --region <region>         AWS region (default: current region from AWS CLI config)"
      echo "  --dryrun                  Show what would be done without making changes"
      exit 1
      ;;
  esac
done

# validate required arguments
if [[ ${#BUCKET_NAMES[@]} -eq 0 ]]; then
  echo "⛈️  Error: --bucket argument is required"
  echo "Usage: $0 --bucket <bucket-name> [--bucket <bucket-name> ...] [--output <directory-path>] [--region <region>] [--dryrun]"
  exit 1
fi

# get current AWS account ID and region
echo "🔑 Getting current AWS account ID..."
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ACCOUNT_ALIAS=$(aws iam list-account-aliases --query 'AccountAliases[0]' --output text 2>/dev/null || echo "")
if [[ -n "$ACCOUNT_ALIAS" && "$ACCOUNT_ALIAS" != "None" ]]; then
  ACCOUNT_NAME="$ACCOUNT_ALIAS"
else
  ACCOUNT_NAME="$ACCOUNT_ID"
fi
echo "✨ Account: $ACCOUNT_NAME"

# set default region if not specified
if [[ -z "$REGION" ]]; then
  REGION=$(aws configure get region || echo "us-east-2")
fi
echo "✨ Region: $REGION"
echo ""

# calculate account ID hash for naming convention
ACCOUNT_ID_HASH=$(echo -n "${ACCOUNT_ID}" | sha256sum | cut -c1-7)

# set default output directory if not specified
if [[ -z "$OUTPUT_DIR" ]]; then
  OUTPUT_DIR=".rhachet/setS3BucketUsageObservability/${ACCOUNT_NAME}/${ISO_DATETIME}"
fi

# ensure output directory exists
mkdir -p "$OUTPUT_DIR"

# define output file paths
REPORT_FILE="${OUTPUT_DIR}/configuration_report.md"
SUCCESS_LOG="${OUTPUT_DIR}/success.log"

echo "🌊 Enabling S3 Metadata for Usage Observability..."
echo ""

if [[ "$DRYRUN" == "true" ]]; then
  echo "🔍 DRYRUN MODE - No changes will be made"
  echo ""
fi

# create Glue database for S3 Metadata tables if it doesn't exist
echo "🔭 Checking Glue database: s3_metadata"
if aws glue get-database --name "s3_metadata" --region "$REGION" &>/dev/null; then
  echo "✓ Glue database already exists"
else
  if [[ "$DRYRUN" == "true" ]]; then
    echo "[DRYRUN] Would create Glue database: s3_metadata"
  else
    echo "Creating Glue database: s3_metadata"
    if aws glue create-database \
      --database-input '{
        "Name": "s3_metadata",
        "Description": "S3 Metadata tables for cost optimization"
      }' \
      --region "$REGION" > /dev/null 2>&1; then
      echo "✓ Created Glue database"
    else
      echo "⚠️  Warning: Failed to create Glue database (Athena queries may require manual setup)"
    fi
  fi
fi
echo ""

# create analysis bucket for Athena query results
BUCKET_ANALYSIS="ghlitch-${ACCOUNT_ID_HASH}-objects"
echo "🔭 Checking analysis bucket: $BUCKET_ANALYSIS"
if aws s3api head-bucket --bucket "$BUCKET_ANALYSIS" &>/dev/null; then
  echo "✓ Analysis bucket already exists"
else
  if [[ "$DRYRUN" == "true" ]]; then
    echo "[DRYRUN] Would create analysis bucket: $BUCKET_ANALYSIS"
  else
    echo "Creating analysis bucket: $BUCKET_ANALYSIS"
    if aws s3 mb "s3://${BUCKET_ANALYSIS}" --region "$REGION" > /dev/null; then
      echo "✓ Created analysis bucket for Athena results"
    else
      echo "⚠️  Warning: Failed to create analysis bucket (Athena queries may fail)"
    fi
  fi
fi
echo ""

# display bucket configuration target
echo "🎯 Configuring ${#BUCKET_NAMES[@]} specified bucket(s)"
echo ""

# initialize counters
TOTAL_BUCKETS=${#BUCKET_NAMES[@]}
SUCCESS_COUNT=0
ERROR_COUNT=0
SKIPPED_COUNT=0

# initialize report
{
  echo "# S3 Metadata Configuration Report"
  echo ""
  echo "**Account:** $ACCOUNT_NAME"
  echo "**Region:** $REGION"
  echo "**Analysis Bucket:** $BUCKET_ANALYSIS"
  echo "**Athena Output Location:** s3://$BUCKET_ANALYSIS/budget/stats/athena-results/"
  echo "**Generated:** $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  if [[ "$DRYRUN" == "true" ]]; then
    echo "**Mode:** DRYRUN (no changes made)"
  else
    echo "**Mode:** LIVE"
  fi
  echo ""
  echo "---"
  echo ""
  echo "## What This Configuration Does"
  echo ""
  echo "Enables S3 Metadata (announced at re:Invent 2024, updated July 2025) for each bucket."
  echo ""
  echo "**S3 Metadata provides:**"
  echo ""
  echo "- **Journal Table:** Near real-time view of object-level changes (uploads, deletions, metadata updates)"
  echo "- **Live Inventory Table:** Complete snapshot of all objects and their metadata, refreshed hourly"
  echo ""
  echo "**Available metadata includes:**"
  echo ""
  echo "- Object key, size, last modified timestamp"
  echo "- Storage class and access tier (for Intelligent-Tiering objects)"
  echo "- ETag, version ID, encryption status, object tags"
  echo "- All metadata for existing objects (via backfill support)"
  echo ""
  echo "**Data availability:**"
  echo ""
  echo "- Journal Table: Near real-time updates (within minutes)"
  echo "- Live Inventory Table: Refreshed within 1 hour of changes"
  echo "- Backfill for existing objects: Completes within hours to days depending on bucket size"
  echo ""
  echo "**Use cases:**"
  echo ""
  echo "- Query object metadata with Athena or Spark"
  echo "- Identify storage tier optimization opportunities"
  echo "- Track access patterns and object lifecycle"
  echo "- Calculate cost savings from tier transitions"
  echo ""
  echo "---"
  echo ""
  echo "## Results"
  echo ""
} > "$REPORT_FILE"

# process each bucket
BUCKET_NUM=0
for BUCKET_NAME in "${BUCKET_NAMES[@]}"; do
  BUCKET_NUM=$((BUCKET_NUM + 1))
  echo "[$BUCKET_NUM/$TOTAL_BUCKETS] Processing: $BUCKET_NAME"

  # check if metadata is already configured
  echo "  Checking existing configuration..."
  METADATA_ALREADY_EXISTS=false
  if aws s3api get-bucket-metadata-configuration \
    --bucket "$BUCKET_NAME" \
    --region "$REGION" &>/dev/null; then
    echo "  ✓ Metadata already configured"
    METADATA_ALREADY_EXISTS=true
  fi

  # apply metadata configuration if not already configured
  METADATA_TABLE_NAME="${BUCKET_NAME}-metadata"
  BUCKET_SUCCESS=true
  BUCKET_ERRORS=""

  if [[ "$METADATA_ALREADY_EXISTS" == "false" ]]; then
    if [[ "$DRYRUN" == "true" ]]; then
      echo "  [DRYRUN] Would enable S3 Metadata"
      echo "  [DRYRUN] Table name: $METADATA_TABLE_NAME"
      BUCKET_SUCCESS=true
    else
      # create metadata table configuration
      echo "  Creating S3 Metadata configuration..."
      set +e
      ERROR_OUTPUT=$(aws s3api create-bucket-metadata-configuration \
        --bucket "$BUCKET_NAME" \
        --metadata-configuration "{
          \"JournalTableConfiguration\": {
            \"RecordExpiration\": {
              \"Expiration\": \"DISABLED\"
            },
            \"EncryptionConfiguration\": {
              \"SseAlgorithm\": \"AES256\"
            }
          },
          \"InventoryTableConfiguration\": {
            \"ConfigurationState\": \"ENABLED\",
            \"EncryptionConfiguration\": {
              \"SseAlgorithm\": \"AES256\"
            }
          }
        }" \
        --region "$REGION" 2>&1)
      CMD_EXIT_CODE=$?
      set -e

      if [[ $CMD_EXIT_CODE -eq 0 ]]; then
        echo "  ✓ Enabled S3 Metadata"
        echo "  ✓ Table name: $METADATA_TABLE_NAME"
        sleep 2  # Give AWS a moment to create the table
        SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
        echo "$BUCKET_NAME" >> "$SUCCESS_LOG"
      else
        echo "  ✗ Failed to enable S3 Metadata"
        echo "  Error: $ERROR_OUTPUT"
        BUCKET_ERRORS="Failed to enable S3 Metadata configuration: $ERROR_OUTPUT"
        BUCKET_SUCCESS=false
        ERROR_COUNT=$((ERROR_COUNT + 1))
      fi
    fi
  else
    # Metadata already exists, count as skipped for metadata creation
    SKIPPED_COUNT=$((SKIPPED_COUNT + 1))
  fi

  # Register/verify Glue table (always run, regardless of whether metadata was just created)
  if [[ "$BUCKET_SUCCESS" == "true" ]]; then
    if [[ "$DRYRUN" == "true" ]]; then
      echo "  [DRYRUN] Would check/create Glue table registration"
    else
      echo "  Checking Glue table registration..."

      # Get the inventory table ARN from metadata configuration
      METADATA_CONFIG=$(aws s3api get-bucket-metadata-configuration \
        --bucket "$BUCKET_NAME" \
        --region "$REGION" 2>/dev/null)

      if [[ $? -eq 0 ]]; then
        INVENTORY_ARN=$(echo "$METADATA_CONFIG" | jq -r '.GetBucketMetadataConfigurationResult.MetadataConfigurationResult.InventoryTableConfigurationResult.TableArn')

        if [[ -n "$INVENTORY_ARN" ]] && [[ "$INVENTORY_ARN" != "null" ]]; then
          # Create Glue table name (replace invalid characters)
          GLUE_TABLE_NAME=$(echo "${BUCKET_NAME}" | tr '-' '_' | tr '.' '_')_inventory

          # Check if Glue table already exists
          if aws glue get-table \
            --database-name "s3_metadata" \
            --name "${GLUE_TABLE_NAME}" \
            --region "$REGION" &>/dev/null; then
            echo "  ✓ Glue table already registered: s3_metadata.${GLUE_TABLE_NAME}"
          else
            # Create Glue table
            TABLE_LOCATION="s3tables://${INVENTORY_ARN}"
            echo "  Creating Glue table: s3_metadata.${GLUE_TABLE_NAME}"

            set +e
            aws glue create-table \
              --database-name "s3_metadata" \
              --table-input "{
                \"Name\": \"${GLUE_TABLE_NAME}\",
                \"Description\": \"S3 Metadata inventory table for ${BUCKET_NAME}\",
                \"TableType\": \"EXTERNAL_TABLE\",
                \"Parameters\": {
                  \"table_type\": \"ICEBERG\",
                  \"metadata_location\": \"${TABLE_LOCATION}\"
                },
                \"StorageDescriptor\": {
                  \"Location\": \"${TABLE_LOCATION}\",
                  \"InputFormat\": \"org.apache.iceberg.mr.hive.HiveIcebergInputFormat\",
                  \"OutputFormat\": \"org.apache.iceberg.mr.hive.HiveIcebergOutputFormat\",
                  \"SerdeInfo\": {
                    \"SerializationLibrary\": \"org.apache.iceberg.mr.hive.HiveIcebergSerDe\"
                  }
                }
              }" \
              --region "$REGION" > /dev/null 2>&1
            GLUE_EXIT_CODE=$?
            set -e

            if [[ $GLUE_EXIT_CODE -eq 0 ]]; then
              echo "  ✓ Registered in Glue: s3_metadata.${GLUE_TABLE_NAME}"
            else
              echo "  ⚠️  Warning: Failed to register in Glue (table may already exist or permissions issue)"
            fi
          fi
        else
          echo "  ⚠️  Warning: Could not retrieve inventory table ARN"
        fi
      else
        echo "  ⚠️  Warning: Could not retrieve metadata configuration"
      fi
    fi
  fi

  # record result in report
  if [[ "$BUCKET_SUCCESS" == "true" ]]; then
    {
      GLUE_TABLE_NAME=$(echo "${BUCKET_NAME}" | tr '-' '_' | tr '.' '_')_inventory
      echo "### ✓ $BUCKET_NAME"
      echo ""
      echo "- Status: ✓ S3 Metadata enabled"
      echo "- Inventory Table: \`$METADATA_TABLE_NAME\` (auto-created by AWS)"
      echo "- Glue Table: \`s3_metadata.${GLUE_TABLE_NAME}\`"
      echo ""
      echo "Query with Athena:"
      echo '```sql'
      echo "SELECT * FROM s3_metadata.${GLUE_TABLE_NAME} LIMIT 10;"
      echo '```'
      echo ""
    } >> "$REPORT_FILE"
  else
    {
      echo "### ✗ $BUCKET_NAME"
      echo ""
      echo "- Status: ✗ Failed"
      echo ""
      echo "**Errors:**"
      echo ""
      echo "$BUCKET_ERRORS"
      echo ""
    } >> "$REPORT_FILE"
  fi

  echo ""
done

# verify configuration for successfully configured buckets
if [[ "$DRYRUN" != "true" && $SUCCESS_COUNT -gt 0 ]]; then
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo "🔍 Verifying Configuration..."
  echo ""

  VERIFY_SUCCESS=0
  VERIFY_FAILED=0

  # read successfully configured buckets from success log
  if [[ -f "$SUCCESS_LOG" ]]; then
    while IFS= read -r BUCKET_NAME; do
      echo "  Checking: $BUCKET_NAME"
      if aws s3api get-bucket-metadata-configuration \
        --bucket "$BUCKET_NAME" \
        --region "$REGION" &>/dev/null; then
        echo "    ✓ Verified"
        VERIFY_SUCCESS=$((VERIFY_SUCCESS + 1))
      else
        echo "    ✗ Configuration not found"
        VERIFY_FAILED=$((VERIFY_FAILED + 1))
      fi
    done < "$SUCCESS_LOG"
  fi

  echo ""
  echo "  Verification: $VERIFY_SUCCESS/$SUCCESS_COUNT buckets confirmed"
  if [[ $VERIFY_FAILED -gt 0 ]]; then
    echo "  ⚠️  Warning: $VERIFY_FAILED bucket(s) failed verification"
  fi
  echo ""
fi

# append summary to report
{
  echo "---"
  echo ""
  echo "## Summary"
  echo ""
  echo "- **Total buckets:** $TOTAL_BUCKETS"
  echo "- **Successfully configured:** $SUCCESS_COUNT"
  echo "- **Already configured (skipped):** $SKIPPED_COUNT"
  echo "- **Errors:** $ERROR_COUNT"
  echo ""
  echo "---"
  echo ""
  echo "## Next Steps"
  echo ""
  echo "### 1. Query Metadata (after backfill completes)"
  echo ""
  echo "Query metadata using Athena with the s3tables:// protocol:"
  echo ""
  echo '```bash'
  echo "# Example: Query a bucket's metadata table"
  echo "BUCKET_NAME=\"your-bucket-name\""
  echo "# Note: With V2 API, AWS auto-creates S3 Tables buckets. Use get-bucket-metadata-configuration to find the table location."
  echo "ATHENA_OUTPUT=\"s3://${BUCKET_ANALYSIS}/budget/stats/athena-results/\""
  echo ""
  echo "# Run query via AWS CLI"
  echo "aws athena start-query-execution \\"
  echo "  --query-string \"SELECT COUNT(*) as total_objects FROM \\\"\${TABLE_ARN}\\\"\" \\"
  echo "  --result-configuration \"OutputLocation=\${ATHENA_OUTPUT}\""
  echo '```'
  echo ""
  echo "Example optimization query:"
  echo ""
  echo '```sql'
  echo "-- Find objects not accessed in 30+ days (candidates for Infrequent Access)"
  echo "-- Replace TABLE_ARN with: s3tables://arn:aws:s3tables:REGION:ACCOUNT_ID:bucket/BUCKET_S3METADATA/default/BUCKET_NAME-metadata"
  echo "SELECT"
  echo "  key,"
  echo "  size,"
  echo "  storage_class,"
  echo "  last_modified_date,"
  echo "  DATE_DIFF('day', last_modified_date, CURRENT_TIMESTAMP) as days_since_modified,"
  echo "  ROUND(size / 1024.0 / 1024.0 / 1024.0, 2) as size_gb"
  echo "FROM \"s3tables://arn:aws:s3tables:REGION:ACCOUNT_ID:bucket/BUCKET_S3METADATA/default/BUCKET_NAME-metadata\""
  echo "WHERE storage_class = 'STANDARD'"
  echo "  AND DATE_DIFF('day', last_modified_date, CURRENT_TIMESTAMP) > 30"
  echo "  AND size > 131072  -- 128 KB minimum for tiering"
  echo "ORDER BY size DESC"
  echo "LIMIT 100;"
  echo '```'
  echo ""
  echo "### 2. Monitor Backfill Progress"
  echo ""
  echo "Metadata backfill for existing objects will complete within hours to days depending on bucket size."
  echo "Check the S3 console or query the metadata tables to see progress."
  echo ""
  echo "### 3. Calculate Cost Savings"
  echo ""
  echo "Use the metadata to identify storage tier optimization opportunities:"
  echo ""
  echo "- Objects >30 days old: Consider Standard-IA or Intelligent-Tiering"
  echo "- Objects >90 days old: Consider Archive Instant Access tier"
  echo "- Objects with unpredictable access: Enable Intelligent-Tiering"
  echo ""
  echo "**Storage tier pricing (US East - Ohio, approximate):**"
  echo ""
  echo "- Standard: \$0.023/GB/month"
  echo "- Standard-IA: \$0.0125/GB/month (40% savings)"
  echo "- Intelligent-Tiering (Infrequent): \$0.0125/GB/month"
  echo "- Archive Instant Access: \$0.004/GB/month (68% savings)"
  echo ""
  echo "### 4. Implement Tier Optimization"
  echo ""
  echo "Use the companion script to apply tier optimizations:"
  echo ""
  echo '```bash'
  echo "./setS3BucketTierOptimization.sh --bucket <bucket-name>"
  echo '```'
  echo ""
} >> "$REPORT_FILE"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "🌊 Configuration Summary"
echo ""
echo "  Total buckets:             $TOTAL_BUCKETS"
echo "  Successfully configured:   $SUCCESS_COUNT"
echo "  Already configured:        $SKIPPED_COUNT"
echo "  Errors:                    $ERROR_COUNT"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "🌿 Output files:"
echo "   - $REPORT_FILE"
if [[ -f "$SUCCESS_LOG" ]]; then
  echo "   - $SUCCESS_LOG"
fi
echo ""

if [[ "$DRYRUN" == "true" ]]; then
  echo "✨ Dryrun complete - no changes were made"
else
  echo "✨ Done!"
  echo ""
  echo "📊 Next steps:"
  echo "   1. Wait for metadata backfill to complete (hours to days depending on bucket size)"
  echo "   2. Query metadata tables using Athena or Spark"
  echo "   3. Identify cost optimization opportunities"
  echo "   4. Apply tier optimizations using setS3BucketTierOptimization.sh"
fi
echo ""
