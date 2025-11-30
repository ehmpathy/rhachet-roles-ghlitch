#!/bin/bash
# .what = enable S3 Tables integration with Athena for querying S3 Metadata tables
# .why = allows querying S3 Metadata tables via Athena using the s3tablescatalog

set -euo pipefail

# parse arguments
BUCKET_NAME=""
REGION=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --bucket)
      BUCKET_NAME="$2"
      shift 2
      ;;
    --region)
      REGION="$2"
      shift 2
      ;;
    *)
      echo "⛈️  Error: Unknown argument: $1"
      echo ""
      echo "Usage: $0 --bucket <bucket-name> [--region <region>]"
      echo ""
      exit 1
      ;;
  esac
done

# validate bucket name provided
if [[ -z "$BUCKET_NAME" ]]; then
  echo "⛈️  Error: --bucket <bucket-name> is required"
  echo ""
  echo "Usage: $0 --bucket <bucket-name> [--region <region>]"
  exit 1
fi

echo "🌊 S3 Tables Athena Integration"
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

# use provided region or detected region
if [[ -z "$REGION" ]]; then
  REGION="$BUCKET_REGION"
fi

echo "✓ Bucket exists in region: $BUCKET_REGION"
echo ""

# check if metadata configuration exists
echo "🔭 Step 2: Checking S3 Metadata configuration..."

set +e
METADATA_CONFIG=$(aws s3api get-bucket-metadata-configuration \
  --bucket "$BUCKET_NAME" \
  --region "$REGION" 2>&1)
CONFIG_EXIT_CODE=$?
set -e

# halt if no configuration found
if [[ $CONFIG_EXIT_CODE -ne 0 ]]; then
  echo "⛈️  Error: S3 Metadata is not configured for this bucket"
  echo ""
  echo "Configure S3 Metadata first:"
  echo "  ./setS3BucketUsageObservability.v2.sh --bucket $BUCKET_NAME"
  exit 1
fi

# extract table bucket details
TABLE_BUCKET_ARN=$(echo "$METADATA_CONFIG" | jq -r '.GetBucketMetadataConfigurationResult.MetadataConfigurationResult.DestinationResult.TableBucketArn')

# parse table bucket name from ARN
TABLE_BUCKET_NAME=$(echo "$TABLE_BUCKET_ARN" | sed 's/.*bucket\///')

echo "✓ S3 Metadata configuration found"
echo "  Table bucket: $TABLE_BUCKET_NAME"
echo ""

# check if integration is already enabled
echo "🔭 Step 3: Checking analytics integration status..."

set +e
INTEGRATION_STATUS=$(aws s3tables get-table-bucket \
  --table-bucket-arn "$TABLE_BUCKET_ARN" \
  --region "$REGION" 2>&1)
INTEGRATION_EXIT_CODE=$?
set -e

if [[ $INTEGRATION_EXIT_CODE -ne 0 ]]; then
  echo "⛈️  Error: Unable to check table bucket status"
  echo ""
  echo "$INTEGRATION_STATUS"
  exit 1
fi

# check if analytics services are enabled
ANALYTICS_ENABLED=$(echo "$INTEGRATION_STATUS" | jq -r '.AnalyticsConfiguration.AnalyticsServicesEnabled' 2>/dev/null || echo "false")

if [[ "$ANALYTICS_ENABLED" == "true" ]]; then
  echo "✓ Analytics integration already enabled"
  echo ""
  echo "The s3tablescatalog is available for Athena queries."
  echo ""

  # get account id
  ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

  echo "Catalog identifier: ${ACCOUNT_ID}:s3tablescatalog/${TABLE_BUCKET_NAME}"
  echo ""
  echo "✨ Integration verified!"
  exit 0
fi

# enable analytics integration
echo "🌊 Step 4: Enabling analytics integration..."

set +e
ENABLE_OUTPUT=$(aws s3tables put-table-bucket-maintenance-configuration \
  --table-bucket-arn "$TABLE_BUCKET_ARN" \
  --value '{
    "IcebergCompaction": {
      "Status": "enabled"
    },
    "IcebergSnapshotManagement": {
      "Status": "enabled"
    }
  }' \
  --region "$REGION" 2>&1)
ENABLE_EXIT_CODE=$?
set -e

# note: there's no direct API to enable analytics integration after creation
# it must be enabled during table bucket creation or via console

echo "⚠️  Analytics integration cannot be enabled via CLI after bucket creation"
echo ""
echo "To enable S3 Tables integration with Athena:"
echo ""
echo "1. Open AWS S3 Console"
echo "2. Navigate to 'Table buckets'"
echo "3. Select the bucket: $TABLE_BUCKET_NAME"
echo "4. Click 'Actions' → 'Edit integration with AWS analytics services'"
echo "5. Enable integration"
echo ""
echo "Or recreate the metadata configuration with integration enabled from the start."
echo ""
echo "Once enabled, the catalog will be available at:"
echo "  Catalog: s3tablescatalog"
echo "  Database: Use your table namespace"
echo ""

exit 1
