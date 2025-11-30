#!/bin/bash
# .what = provision S3 Metadata configuration on existing bucket for Athena queryability
# .why = enable object metadata tracking and analysis via Apache Iceberg tables

set -euo pipefail

# parse arguments
BUCKET_NAME=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --bucket)
      BUCKET_NAME="$2"
      shift 2
      ;;
    *)
      echo "⛈️  Error: Unknown argument: $1"
      echo ""
      echo "Usage: $0 --bucket <bucket-name>"
      echo ""
      exit 1
      ;;
  esac
done

# validate bucket name provided
if [[ -z "$BUCKET_NAME" ]]; then
  echo "⛈️  Error: --bucket <bucket-name> is required"
  echo ""
  echo "Usage: $0 --bucket <bucket-name>"
  exit 1
fi

echo "🌊 S3 Metadata Provisioning"
echo ""
echo "Bucket: $BUCKET_NAME"
echo ""

# verify bucket exists and get its region
echo "🔭 Step 1: Verifying bucket exists..."

# disable exit-on-error temporarily to capture output
set +e
BUCKET_REGION=$(aws s3api get-bucket-location \
  --bucket "$BUCKET_NAME" \
  --query 'LocationConstraint' \
  --output text 2>&1)
BUCKET_EXIT_CODE=$?
set -e

# handle bucket not found
if [[ $BUCKET_EXIT_CODE -ne 0 ]]; then
  echo "⛈️  Error: Bucket does not exist or is not accessible: $BUCKET_NAME"
  echo ""
  echo "$BUCKET_REGION"
  exit 1
fi

# handle us-east-1 returning "None"
if [[ "$BUCKET_REGION" == "None" ]]; then
  BUCKET_REGION="us-east-1"
fi

echo "✓ Bucket exists in region: $BUCKET_REGION"
echo ""

# verify region is supported
SUPPORTED_REGIONS=("us-east-1" "us-east-2" "us-west-2")
REGION_SUPPORTED=false
for SUPPORTED_REGION in "${SUPPORTED_REGIONS[@]}"; do
  if [[ "$BUCKET_REGION" == "$SUPPORTED_REGION" ]]; then
    REGION_SUPPORTED=true
    break
  fi
done

# halt if region not supported
if [[ "$REGION_SUPPORTED" == "false" ]]; then
  echo "⛈️  Error: S3 Metadata is not available in region: $BUCKET_REGION"
  echo ""
  echo "Supported regions:"
  for SUPPORTED_REGION in "${SUPPORTED_REGIONS[@]}"; do
    echo "  - $SUPPORTED_REGION"
  done
  echo ""
  echo "S3 Metadata is currently in preview and only available in these regions."
  exit 1
fi

echo "✓ Region is supported for S3 Metadata"
echo ""

# check if metadata configuration already exists
echo "🔭 Step 2: Checking existing configuration..."
EXISTING_CONFIG=$(aws s3api get-bucket-metadata-configuration \
  --bucket "$BUCKET_NAME" \
  --region "$BUCKET_REGION" 2>&1 || true)

# check if configuration matches desired state
if echo "$EXISTING_CONFIG" | grep -q "MetadataConfigurationResult"; then
  echo "⚠️  S3 Metadata configuration already exists"
  echo ""

  JOURNAL_STATUS=$(echo "$EXISTING_CONFIG" | jq -r '.GetBucketMetadataConfigurationResult.MetadataConfigurationResult.JournalTableConfigurationResult.TableStatus' 2>/dev/null || echo "unknown")
  INVENTORY_STATUS=$(echo "$EXISTING_CONFIG" | jq -r '.GetBucketMetadataConfigurationResult.MetadataConfigurationResult.InventoryTableConfigurationResult.TableStatus' 2>/dev/null || echo "unknown")

  echo "Table status:"
  echo "  - Journal table: $JOURNAL_STATUS"
  echo "  - Inventory table: $INVENTORY_STATUS"
  echo ""

  # handle tables still being created
  if [[ "$JOURNAL_STATUS" == "CREATING" ]] || [[ "$INVENTORY_STATUS" == "CREATING" ]]; then
    echo "✓ Tables are still being provisioned"
    echo ""
    echo "Wait a few minutes for completion, then re-run to verify."
    exit 0
  fi

  # handle failed tables
  if [[ "$JOURNAL_STATUS" == "FAILED" ]] || [[ "$INVENTORY_STATUS" == "FAILED" ]]; then
    echo "⛈️  Table creation failed"
    echo ""
    echo "Table status:"
    echo "  - Journal table: $JOURNAL_STATUS"
    echo "  - Inventory table: $INVENTORY_STATUS"
    echo ""


    # extract error details
    JOURNAL_ERROR=$(echo "$EXISTING_CONFIG" | jq -r '.GetBucketMetadataConfigurationResult.MetadataConfigurationResult.JournalTableConfigurationResult.Error.ErrorMessage' 2>/dev/null || echo "")
    INVENTORY_ERROR=$(echo "$EXISTING_CONFIG" | jq -r '.GetBucketMetadataConfigurationResult.MetadataConfigurationResult.InventoryTableConfigurationResult.Error.ErrorMessage' 2>/dev/null || echo "")

    if [[ -n "$JOURNAL_ERROR" ]] && [[ "$JOURNAL_ERROR" != "null" ]]; then
      echo "Journal error: $JOURNAL_ERROR"
      echo ""
    fi

    if [[ -n "$INVENTORY_ERROR" ]] && [[ "$INVENTORY_ERROR" != "null" ]]; then
      echo "Inventory error: $INVENTORY_ERROR"
      echo ""
    fi

    # attempt automatic cleanup
    echo "🌊 Attempting automatic cleanup..."
    echo ""

    # get table bucket and namespace details
    TABLE_BUCKET_ARN=$(echo "$EXISTING_CONFIG" | jq -r '.GetBucketMetadataConfigurationResult.MetadataConfigurationResult.DestinationResult.TableBucketArn' 2>/dev/null || echo "")
    TABLE_NAMESPACE=$(echo "$EXISTING_CONFIG" | jq -r '.GetBucketMetadataConfigurationResult.MetadataConfigurationResult.DestinationResult.TableNamespace' 2>/dev/null || echo "")

    # delete metadata configuration
    echo "  - Deleting metadata configuration..."
    set +e
    aws s3api delete-bucket-metadata-configuration \
      --bucket "$BUCKET_NAME" \
      --region "$BUCKET_REGION" 2>&1 > /dev/null
    set -e

    # delete orphaned tables if we have the details
    if [[ -n "$TABLE_BUCKET_ARN" ]] && [[ "$TABLE_BUCKET_ARN" != "null" ]] && \
       [[ -n "$TABLE_NAMESPACE" ]] && [[ "$TABLE_NAMESPACE" != "null" ]]; then

      # list tables in namespace
      set +e
      ORPHAN_TABLES=$(aws s3tables list-tables \
        --table-bucket-arn "$TABLE_BUCKET_ARN" \
        --namespace "$TABLE_NAMESPACE" \
        --region "$BUCKET_REGION" 2>&1)
      LIST_EXIT_CODE=$?
      set -e

      # delete orphaned tables
      if [[ $LIST_EXIT_CODE -eq 0 ]]; then
        TABLE_COUNT=$(echo "$ORPHAN_TABLES" | jq '.tables | length' 2>/dev/null || echo "0")

        if [[ "$TABLE_COUNT" -gt 0 ]]; then
          echo "  - Deleting $TABLE_COUNT orphaned table(s)..."

          for TABLE_NAME in $(echo "$ORPHAN_TABLES" | jq -r '.tables[].name' 2>/dev/null); do
            echo "    - Deleting table: $TABLE_NAME"
            set +e
            aws s3tables delete-table \
              --table-bucket-arn "$TABLE_BUCKET_ARN" \
              --namespace "$TABLE_NAMESPACE" \
              --name "$TABLE_NAME" \
              --region "$BUCKET_REGION" 2>&1 > /dev/null
            set -e
          done
        fi
      fi
    fi

    echo ""
    echo "✓ Cleanup complete"
    echo ""
    echo "Re-run this operation to recreate the configuration:"
    echo "  $0 --bucket $BUCKET_NAME"
    exit 1
  fi

  RECORD_EXPIRATION=$(echo "$EXISTING_CONFIG" | jq -r '.GetBucketMetadataConfigurationResult.MetadataConfigurationResult.JournalTableConfigurationResult.RecordExpiration.Expiration' 2>/dev/null || echo "DISABLED")
  INVENTORY_STATE=$(echo "$EXISTING_CONFIG" | jq -r '.GetBucketMetadataConfigurationResult.MetadataConfigurationResult.InventoryTableConfigurationResult.ConfigurationState' 2>/dev/null || echo "DISABLED")
  TABLE_BUCKET_TYPE=$(echo "$EXISTING_CONFIG" | jq -r '.GetBucketMetadataConfigurationResult.MetadataConfigurationResult.DestinationResult.TableBucketType' 2>/dev/null || echo "")
  TABLE_BUCKET_ARN=$(echo "$EXISTING_CONFIG" | jq -r '.GetBucketMetadataConfigurationResult.MetadataConfigurationResult.DestinationResult.TableBucketArn' 2>/dev/null || echo "")
  TABLE_NAMESPACE=$(echo "$EXISTING_CONFIG" | jq -r '.GetBucketMetadataConfigurationResult.MetadataConfigurationResult.DestinationResult.TableNamespace' 2>/dev/null || echo "")

  # define desired state
  DESIRED_RECORD_EXPIRATION="DISABLED"
  DESIRED_INVENTORY_STATE="ENABLED"
  DESIRED_TABLE_BUCKET_TYPE="aws"

  # display current vs desired configuration
  echo "Current configuration:"
  echo "  - Record expiration: $RECORD_EXPIRATION"
  echo "  - Inventory state: $INVENTORY_STATE"
  echo "  - Table bucket type: $TABLE_BUCKET_TYPE"
  echo "  - Table bucket: $TABLE_BUCKET_ARN"
  echo "  - Table namespace: $TABLE_NAMESPACE"
  echo ""
  echo "Desired configuration:"
  echo "  - Record expiration: $DESIRED_RECORD_EXPIRATION"
  echo "  - Inventory state: $DESIRED_INVENTORY_STATE"
  echo "  - Table bucket type: $DESIRED_TABLE_BUCKET_TYPE (AWS-managed)"
  echo ""

  # check if configuration matches desired state
  if [[ "$RECORD_EXPIRATION" == "$DESIRED_RECORD_EXPIRATION" ]] && \
     [[ "$INVENTORY_STATE" == "$DESIRED_INVENTORY_STATE" ]] && \
     [[ "$TABLE_BUCKET_TYPE" == "$DESIRED_TABLE_BUCKET_TYPE" ]]; then
    echo "✓ Configuration matches desired state"
    echo ""

    # check analytics integration status
    echo "🔭 Checking Athena analytics integration..."
    set +e
    TABLE_BUCKET_STATUS=$(aws s3tables get-table-bucket \
      --table-bucket-arn "$TABLE_BUCKET_ARN" \
      --region "$BUCKET_REGION" 2>&1)
    BUCKET_STATUS_EXIT_CODE=$?
    set -e

    if [[ $BUCKET_STATUS_EXIT_CODE -eq 0 ]]; then
      ANALYTICS_ENABLED=$(echo "$TABLE_BUCKET_STATUS" | jq -r '.AnalyticsConfiguration.AnalyticsServicesEnabled' 2>/dev/null || echo "false")

      if [[ "$ANALYTICS_ENABLED" == "true" ]]; then
        echo "✓ Athena analytics integration enabled"
        echo ""

        # get account id
        ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
        TABLE_BUCKET_NAME=$(echo "$TABLE_BUCKET_ARN" | sed 's/.*bucket\///')

        echo "Catalog: s3tablescatalog"
        echo "Database: $TABLE_NAMESPACE"
        echo ""
      else
        echo "⚠️  Athena analytics integration not enabled"
        echo ""
        echo "Analytics integration must be enabled via AWS Console:"
        echo ""
        echo "1. Open AWS S3 Console"
        echo "2. Navigate to 'Table buckets'"
        echo "3. Select the bucket: aws-s3"
        echo "4. Click 'Actions' → 'Edit integration with AWS analytics services'"
        echo "5. Enable integration"
        echo ""
        echo "Note: AWS-managed table buckets (aws-s3) typically have analytics"
        echo "enabled by default. If not, manual console enablement is required."
        echo ""
        echo "Once enabled, use the s3tablescatalog in Athena queries."
        echo ""
      fi
    else
      echo "⚠️  Unable to check analytics integration status"
      echo ""
    fi

    echo "No changes needed."
    exit 0
  fi

  # configuration differs from desired state
  echo "⚠️  Configuration does not match desired state"
  echo ""
  echo "To update configuration:"
  echo "  1. Delete existing: aws s3api delete-bucket-metadata-configuration --bucket $BUCKET_NAME --region $BUCKET_REGION"
  echo "  2. Wait 5 minutes for cleanup"
  echo "  3. Re-run this operation"
  echo ""
  echo "Note: Encryption settings cannot be changed after creation - deletion and recreation required."
  exit 1
fi

echo "✓ No existing configuration found"
echo ""

# generate temporary config file
CONFIG_FILE=$(mktemp)
trap 'rm -f "$CONFIG_FILE"' EXIT

echo "🌿 Step 3: Creating metadata configuration..."

# build minimal configuration with journal + inventory, SSE-S3 encryption
cat > "$CONFIG_FILE" <<'EOF'
{
  "JournalTableConfiguration": {
    "RecordExpiration": {
      "Expiration": "DISABLED"
    },
    "EncryptionConfiguration": {
      "SseAlgorithm": "AES256"
    }
  },
  "InventoryTableConfiguration": {
    "ConfigurationState": "ENABLED",
    "EncryptionConfiguration": {
      "SseAlgorithm": "AES256"
    }
  }
}
EOF

echo "✓ Configuration prepared:"
cat "$CONFIG_FILE" | jq '.'
echo ""

# apply metadata configuration
echo "🌊 Step 4: Applying S3 Metadata configuration..."

# disable exit-on-error temporarily to capture output
set +e
CREATE_OUTPUT=$(aws s3api create-bucket-metadata-configuration \
  --bucket "$BUCKET_NAME" \
  --metadata-configuration "file://$CONFIG_FILE" \
  --region "$BUCKET_REGION" 2>&1)
CREATE_EXIT_CODE=$?
set -e

# handle creation errors
if [[ $CREATE_EXIT_CODE -ne 0 ]]; then
  echo "⛈️  Error creating metadata configuration:"
  echo ""
  echo "$CREATE_OUTPUT"
  echo ""

  # provide specific guidance for common errors
  if echo "$CREATE_OUTPUT" | grep -q "AccessDenied"; then
    echo "Missing required IAM permissions. Required actions:"
    echo "  - s3:CreateBucketMetadataTableConfiguration"
    echo "  - s3tables:CreateTableBucket"
    echo "  - s3tables:CreateNamespace"
    echo "  - s3tables:CreateTable"
    echo "  - s3tables:PutTablePolicy"
    echo ""
  elif echo "$CREATE_OUTPUT" | grep -q "KMS"; then
    echo "KMS key policy must grant access to S3 Metadata service principals:"
    echo "  - metadata.s3.amazonaws.com"
    echo "  - maintenance.s3tables.amazonaws.com"
    echo ""
    echo "Required actions: kms:GenerateDataKey, kms:Decrypt"
    echo ""
  elif echo "$CREATE_OUTPUT" | grep -q "InvalidArgument"; then
    echo "Invalid configuration argument."
    echo "This may indicate S3 Metadata is not available in this region or account."
    echo ""
  fi

  exit 1
fi

echo "✓ Metadata configuration created successfully"
echo ""

# wait briefly for configuration to propagate
sleep 3

# verify configuration and get table details
echo "🔭 Step 5: Verifying configuration..."

# disable exit-on-error temporarily to capture output
set +e
VERIFY_OUTPUT=$(aws s3api get-bucket-metadata-configuration \
  --bucket "$BUCKET_NAME" \
  --region "$BUCKET_REGION" 2>&1)
VERIFY_EXIT_CODE=$?
set -e

# handle verification errors
if [[ $VERIFY_EXIT_CODE -ne 0 ]]; then
  echo "⚠️  Configuration created but verification failed:"
  echo ""
  echo "$VERIFY_OUTPUT"
  echo ""
  echo "Configuration may still be propagating. Wait 1 minute and check manually:"
  echo "  aws s3api get-bucket-metadata-configuration --bucket $BUCKET_NAME --region $BUCKET_REGION"
  exit 0
fi

# extract table details
JOURNAL_ARN=$(echo "$VERIFY_OUTPUT" | jq -r '.GetBucketMetadataConfigurationResult.MetadataConfigurationResult.JournalTableConfigurationResult.TableArn')
JOURNAL_STATUS=$(echo "$VERIFY_OUTPUT" | jq -r '.GetBucketMetadataConfigurationResult.MetadataConfigurationResult.JournalTableConfigurationResult.TableStatus')
INVENTORY_ARN=$(echo "$VERIFY_OUTPUT" | jq -r '.GetBucketMetadataConfigurationResult.MetadataConfigurationResult.InventoryTableConfigurationResult.TableArn')
INVENTORY_STATUS=$(echo "$VERIFY_OUTPUT" | jq -r '.GetBucketMetadataConfigurationResult.MetadataConfigurationResult.InventoryTableConfigurationResult.TableStatus')
TABLE_BUCKET_ARN=$(echo "$VERIFY_OUTPUT" | jq -r '.GetBucketMetadataConfigurationResult.MetadataConfigurationResult.DestinationResult.TableBucketArn')
TABLE_NAMESPACE=$(echo "$VERIFY_OUTPUT" | jq -r '.GetBucketMetadataConfigurationResult.MetadataConfigurationResult.DestinationResult.TableNamespace')

echo "✓ Configuration verified"
echo ""
echo "📊 Metadata Tables:"
echo ""
echo "Journal Table:"
echo "  ARN: $JOURNAL_ARN"
echo "  Status: $JOURNAL_STATUS"
echo ""

# show inventory table details
echo "Inventory Table:"
echo "  ARN: $INVENTORY_ARN"
echo "  Status: $INVENTORY_STATUS"
echo ""

# warn about backfilling process
if [[ "$INVENTORY_STATUS" == "BACKFILLING" ]]; then
  echo "⏳ Inventory table is backfilling..."
  echo ""
  echo "The inventory table is scanning existing objects in the bucket."
  echo "This typically completes within 15 minutes to 1 hour depending on object count."
  echo ""
  echo "Monitor status with:"
  echo "  aws s3api get-bucket-metadata-configuration --bucket $BUCKET_NAME --region $BUCKET_REGION | jq '.GetBucketMetadataConfigurationResult.MetadataConfigurationResult.InventoryTableConfigurationResult.TableStatus'"
  echo ""
fi

# check analytics integration status
echo "🔭 Step 6: Checking Athena analytics integration..."

set +e
TABLE_BUCKET_STATUS=$(aws s3tables get-table-bucket \
  --table-bucket-arn "$TABLE_BUCKET_ARN" \
  --region "$BUCKET_REGION" 2>&1)
BUCKET_STATUS_EXIT_CODE=$?
set -e

if [[ $BUCKET_STATUS_EXIT_CODE -eq 0 ]]; then
  ANALYTICS_ENABLED=$(echo "$TABLE_BUCKET_STATUS" | jq -r '.AnalyticsConfiguration.AnalyticsServicesEnabled' 2>/dev/null || echo "false")

  if [[ "$ANALYTICS_ENABLED" == "true" ]]; then
    echo "✓ Athena analytics integration enabled"
    echo ""

    # get account id
    ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
    TABLE_BUCKET_NAME=$(echo "$TABLE_BUCKET_ARN" | sed 's/.*bucket\///')

    echo "Catalog identifier: ${ACCOUNT_ID}:s3tablescatalog/${TABLE_BUCKET_NAME}"
    echo ""
  else
    echo "⚠️  Athena analytics integration not enabled"
    echo ""
    echo "AWS-managed S3 Metadata buckets should have analytics enabled by default."
    echo "If queries fail, check integration status in S3 Console."
    echo ""
  fi
else
  echo "⚠️  Unable to check analytics integration status"
  echo ""
fi

# provide next steps for querying with Athena
echo "🌿 Next Steps:"
echo ""
echo "1. Wait for tables to become Active (journal: ~minutes, inventory: ~15min-1hr)"
echo ""
echo "2. Verify query access:"
echo "   ./addS3BucketUsageQueryPermission.sh --bucket $BUCKET_NAME"
echo ""
echo "3. Query with Athena using the s3tablescatalog:"
echo ""
echo "Example query:"
echo "  SELECT key, size, last_modified_date"
echo "  FROM \"s3tablescatalog\".\"$TABLE_NAMESPACE\".\"journal\""
echo "  LIMIT 10;"
echo ""
echo "✨ Provisioning complete!"
echo ""
