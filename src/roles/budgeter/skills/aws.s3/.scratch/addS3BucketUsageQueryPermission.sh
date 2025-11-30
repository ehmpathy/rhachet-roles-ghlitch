#!/bin/bash
# .what = grant Lake Formation permissions to query S3 Metadata tables via Athena
# .why = enable current user/role to query bucket metadata without manual console setup

set -euo pipefail

# parse arguments
BUCKET_NAME=""
PRINCIPAL_ARN=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --bucket)
      BUCKET_NAME="$2"
      shift 2
      ;;
    --principal)
      PRINCIPAL_ARN="$2"
      shift 2
      ;;
    *)
      echo "⛈️  Error: Unknown argument: $1"
      echo ""
      echo "Usage: $0 --bucket <bucket-name> [--principal <iam-arn>]"
      echo ""
      echo "If --principal is not specified, grants permissions to current caller."
      echo ""
      exit 1
      ;;
  esac
done

# validate bucket name provided
if [[ -z "$BUCKET_NAME" ]]; then
  echo "⛈️  Error: --bucket <bucket-name> is required"
  echo ""
  echo "Usage: $0 --bucket <bucket-name> [--principal <iam-arn>]"
  exit 1
fi

echo "🌊 S3 Metadata Query Permissions"
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

# check if metadata configuration exists
echo "🔭 Step 2: Checking S3 Metadata configuration..."

set +e
EXISTING_CONFIG=$(aws s3api get-bucket-metadata-configuration \
  --bucket "$BUCKET_NAME" \
  --region "$BUCKET_REGION" 2>&1)
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
TABLE_BUCKET_ARN=$(echo "$EXISTING_CONFIG" | jq -r '.GetBucketMetadataConfigurationResult.MetadataConfigurationResult.DestinationResult.TableBucketArn')
TABLE_NAMESPACE=$(echo "$EXISTING_CONFIG" | jq -r '.GetBucketMetadataConfigurationResult.MetadataConfigurationResult.DestinationResult.TableNamespace')

echo "✓ S3 Metadata configuration found"
echo ""

# determine principal to grant permissions to
if [[ -z "$PRINCIPAL_ARN" ]]; then
  echo "🔭 Step 3: Getting current caller identity..."
  PRINCIPAL_ARN=$(aws sts get-caller-identity --query 'Arn' --output text 2>&1)
  echo "✓ Using current caller: $PRINCIPAL_ARN"
else
  echo "✓ Using specified principal: $PRINCIPAL_ARN"
fi
echo ""

# verify s3tables access
echo "🔭 Step 4: Verifying S3 Tables access..."

# disable exit-on-error for access check
set +e

# attempt to list tables to verify access
LIST_OUTPUT=$(aws s3tables list-tables \
  --table-bucket-arn "$TABLE_BUCKET_ARN" \
  --namespace "$TABLE_NAMESPACE" \
  --region "$BUCKET_REGION" 2>&1)
LIST_EXIT_CODE=$?

set -e

# check if access succeeded
if [[ $LIST_EXIT_CODE -ne 0 ]]; then
  echo "⛈️  Error: Unable to access S3 Tables"
  echo ""
  echo "$LIST_OUTPUT"
  echo ""
  echo "S3 Metadata tables are AWS-managed and permissions are controlled by IAM."
  echo ""
  echo "Required IAM permissions:"
  echo "  - s3tables:GetTable"
  echo "  - s3tables:GetTableData"
  echo "  - s3tables:GetTableMetadataLocation"
  echo "  - s3tables:ListTables"
  echo ""
  echo "Example IAM policy:"
  echo '  {'
  echo '    "Version": "2012-10-17",'
  echo '    "Statement": [{'
  echo '      "Effect": "Allow",'
  echo '      "Action": ['
  echo '        "s3tables:GetTable",'
  echo '        "s3tables:GetTableData",'
  echo '        "s3tables:GetTableMetadataLocation",'
  echo '        "s3tables:ListTables"'
  echo '      ],'
  echo "      \"Resource\": \"$TABLE_BUCKET_ARN/table/*\""
  echo '    }]'
  echo '  }'
  exit 1
fi

echo "✓ S3 Tables access verified"
echo ""

# list available tables
TABLE_COUNT=$(echo "$LIST_OUTPUT" | jq '.tables | length' 2>/dev/null || echo "0")
echo "Available tables: $TABLE_COUNT"

if [[ "$TABLE_COUNT" -gt 0 ]]; then
  echo ""
  for TABLE_NAME in $(echo "$LIST_OUTPUT" | jq -r '.tables[].name' 2>/dev/null); do
    echo "  - $TABLE_NAME"
  done
fi
echo ""

# note about athena setup
echo "⚠️  Note: Athena S3 Tables catalog must be set up separately"
echo ""
echo "To query S3 Metadata tables with Athena, you need to:"
echo "1. Enable S3 Tables integration with Athena in your region"
echo "2. Use the s3tablescatalog in Athena queries"
echo ""

# provide next steps
echo "🌿 Next Steps:"
echo ""
echo "Query with Athena using the S3 Tables catalog:"
echo ""
echo "Example queries:"
echo ""
echo "# Query journal table (change events)"
echo "SELECT key, size, last_modified_date, record_type"
echo "FROM \"s3tablescatalog/aws-s3\".\"$TABLE_NAMESPACE\".\"journal\""
echo "ORDER BY record_timestamp DESC"
echo "LIMIT 10;"
echo ""
echo "# Query inventory table (current state)"
echo "SELECT key, size, storage_class"
echo "FROM \"s3tablescatalog/aws-s3\".\"$TABLE_NAMESPACE\".\"inventory\""
echo "LIMIT 10;"
echo ""
echo "✨ Access verified!"
echo ""
