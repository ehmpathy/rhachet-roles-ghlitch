#!/bin/bash
# .what = apply intelligent tiering configuration to S3 buckets
# .why = automatically optimize storage costs by enabling intelligent tiering with archive access tiers

set -euo pipefail

# generate iso datetime for default output path
ISO_DATETIME=$(date -u +%Y_%m_%dT%H_%M_%SZ)

# parse arguments
OUTPUT_DIR=""
BUCKET_NAMES=()
DRY_RUN=false

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
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    *)
      echo "⛈️  Error: Unknown argument: $1"
      echo "Usage: $0 [--output <directory-path>] [--bucket <bucket-name> ...] [--dry-run]"
      echo ""
      echo "Options:"
      echo "  --output <dir>     Output directory for logs (default: .rhachet/setS3BucketTierOptimization/<timestamp>)"
      echo "  --bucket <name>    Specific bucket to configure (can be repeated, default: all buckets)"
      echo "  --dry-run          Show what would be done without making changes"
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
  OUTPUT_DIR=".rhachet/setS3BucketTierOptimization/${ACCOUNT_NAME}/${ISO_DATETIME}"
fi

# ensure output directory exists
mkdir -p "$OUTPUT_DIR"

# define output file paths
REPORT_FILE="${OUTPUT_DIR}/configuration_report.md"
SUCCESS_LOG="${OUTPUT_DIR}/success.log"
ERROR_LOG="${OUTPUT_DIR}/errors.log"

# create temp directory for config files
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

echo "🌊 Applying S3 Intelligent Tiering Configuration..."
echo ""

if [[ "$DRY_RUN" == "true" ]]; then
  echo "🔍 DRY RUN MODE - No changes will be made"
  echo ""
fi

# get list of buckets to configure
if [[ ${#BUCKET_NAMES[@]} -eq 0 ]]; then
  echo "🔭 Fetching all S3 buckets in account..."
  BUCKET_LIST=$(aws s3api list-buckets --query 'Buckets[].Name' --output text)
  if [[ -z "$BUCKET_LIST" ]]; then
    echo "⛈️  No buckets found in account"
    exit 0
  fi
  # convert to array
  read -ra BUCKET_NAMES <<< "$BUCKET_LIST"
  echo "✨ Found ${#BUCKET_NAMES[@]} buckets"
else
  echo "🎯 Configuring ${#BUCKET_NAMES[@]} specified bucket(s)"
fi
echo ""

# create lifecycle configuration file
LIFECYCLE_CONFIG="${TEMP_DIR}/lifecycle-policy.json"
cat > "$LIFECYCLE_CONFIG" <<'EOF'
{
  "Rules": [
    {
      "Id": "TransitionToIntelligentTiering",
      "Status": "Enabled",
      "Filter": {},
      "Transitions": [
        {
          "Days": 0,
          "StorageClass": "INTELLIGENT_TIERING"
        }
      ]
    }
  ]
}
EOF

# create intelligent tiering configuration file
IT_CONFIG="${TEMP_DIR}/it-config.json"
cat > "$IT_CONFIG" <<'EOF'
{
  "Id": "ArchiveAccessConfiguration",
  "Status": "Enabled",
  "Tierings": [
    {
      "Days": 90,
      "AccessTier": "ARCHIVE_ACCESS"
    },
    {
      "Days": 180,
      "AccessTier": "DEEP_ARCHIVE_ACCESS"
    }
  ]
}
EOF

# initialize counters
TOTAL_BUCKETS=${#BUCKET_NAMES[@]}
SUCCESS_COUNT=0
LIFECYCLE_SUCCESS=0
IT_CONFIG_SUCCESS=0
ERROR_COUNT=0

# initialize report
{
  echo "# S3 Intelligent Tiering Configuration Report"
  echo ""
  echo "**Account:** $ACCOUNT_NAME"
  echo "**Generated:** $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  if [[ "$DRY_RUN" == "true" ]]; then
    echo "**Mode:** DRY RUN (no changes made)"
  else
    echo "**Mode:** LIVE"
  fi
  echo ""
  echo "---"
  echo ""
  echo "## Configuration Details"
  echo ""
  echo "### Lifecycle Policy"
  echo ""
  echo '```json'
  cat "$LIFECYCLE_CONFIG"
  echo '```'
  echo ""
  echo "### Intelligent Tiering Configuration"
  echo ""
  echo '```json'
  cat "$IT_CONFIG"
  echo '```'
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

  BUCKET_SUCCESS=true
  BUCKET_LIFECYCLE_SUCCESS=false
  BUCKET_IT_CONFIG_SUCCESS=false
  BUCKET_ERRORS=""

  # apply lifecycle configuration
  if [[ "$DRY_RUN" == "true" ]]; then
    echo "  [DRY RUN] Would apply lifecycle policy"
    BUCKET_LIFECYCLE_SUCCESS=true
  else
    if aws s3api put-bucket-lifecycle-configuration \
      --bucket "$BUCKET_NAME" \
      --lifecycle-configuration "file://${LIFECYCLE_CONFIG}" 2>> "$ERROR_LOG"; then
      echo "  ✓ Applied lifecycle policy"
      BUCKET_LIFECYCLE_SUCCESS=true
      LIFECYCLE_SUCCESS=$((LIFECYCLE_SUCCESS + 1))
    else
      echo "  ✗ Failed to apply lifecycle policy"
      BUCKET_ERRORS="${BUCKET_ERRORS}- Failed to apply lifecycle policy\n"
      BUCKET_SUCCESS=false
      ERROR_COUNT=$((ERROR_COUNT + 1))
    fi
  fi

  # apply intelligent tiering configuration
  if [[ "$DRY_RUN" == "true" ]]; then
    echo "  [DRY RUN] Would apply intelligent tiering configuration"
    BUCKET_IT_CONFIG_SUCCESS=true
  else
    if aws s3api put-bucket-intelligent-tiering-configuration \
      --bucket "$BUCKET_NAME" \
      --id "ArchiveAccessConfiguration" \
      --intelligent-tiering-configuration "file://${IT_CONFIG}" 2>> "$ERROR_LOG"; then
      echo "  ✓ Applied intelligent tiering configuration"
      BUCKET_IT_CONFIG_SUCCESS=true
      IT_CONFIG_SUCCESS=$((IT_CONFIG_SUCCESS + 1))
    else
      echo "  ✗ Failed to apply intelligent tiering configuration"
      BUCKET_ERRORS="${BUCKET_ERRORS}- Failed to apply intelligent tiering configuration\n"
      BUCKET_SUCCESS=false
      ERROR_COUNT=$((ERROR_COUNT + 1))
    fi
  fi

  # record result
  if [[ "$BUCKET_SUCCESS" == "true" ]]; then
    echo "$BUCKET_NAME" >> "$SUCCESS_LOG"
    SUCCESS_COUNT=$((SUCCESS_COUNT + 1))

    {
      echo "### ✓ $BUCKET_NAME"
      echo ""
      echo "- Lifecycle policy: ✓ Applied"
      echo "- Intelligent tiering config: ✓ Applied"
      echo ""
    } >> "$REPORT_FILE"
  else
    {
      echo "### ✗ $BUCKET_NAME"
      echo ""
      if [[ "$BUCKET_LIFECYCLE_SUCCESS" == "true" ]]; then
        echo "- Lifecycle policy: ✓ Applied"
      else
        echo "- Lifecycle policy: ✗ Failed"
      fi
      if [[ "$BUCKET_IT_CONFIG_SUCCESS" == "true" ]]; then
        echo "- Intelligent tiering config: ✓ Applied"
      else
        echo "- Intelligent tiering config: ✗ Failed"
      fi
      echo ""
      echo "**Errors:**"
      echo ""
      echo -e "$BUCKET_ERRORS"
    } >> "$REPORT_FILE"
  fi

  echo ""
done

# append summary to report
{
  echo "---"
  echo ""
  echo "## Summary"
  echo ""
  echo "- **Total buckets:** $TOTAL_BUCKETS"
  echo "- **Fully configured:** $SUCCESS_COUNT"
  echo "- **Lifecycle policies applied:** $LIFECYCLE_SUCCESS"
  echo "- **IT configurations applied:** $IT_CONFIG_SUCCESS"
  echo "- **Errors:** $ERROR_COUNT"
  echo ""
  if [[ $ERROR_COUNT -gt 0 ]]; then
    echo "See \`errors.log\` for detailed error messages."
    echo ""
  fi
  echo "---"
  echo ""
  echo "## What This Configuration Does"
  echo ""
  echo "### 1. Lifecycle Policy"
  echo ""
  echo "Transitions all objects to INTELLIGENT_TIERING storage class immediately (Days: 0)."
  echo ""
  echo "- **Effect:** New and existing objects will use Intelligent Tiering"
  echo "- **Cost:** Objects automatically move between tiers based on access patterns"
  echo "- **Access:** No change to access methods or latency"
  echo ""
  echo "### 2. Intelligent Tiering Configuration"
  echo ""
  echo "Enables optional archive access tiers within Intelligent Tiering:"
  echo ""
  echo "- **Archive Access Tier:** Objects not accessed for 90+ days"
  echo "  - Storage cost: \$0.004/GB/month (83% cheaper than Standard)"
  echo "  - Retrieval: Instant, no retrieval fees"
  echo ""
  echo "- **Deep Archive Access Tier:** Objects not accessed for 180+ days"
  echo "  - Storage cost: \$0.00099/GB/month (96% cheaper than Standard)"
  echo "  - Retrieval: Within 12 hours, small retrieval fees apply"
  echo ""
  echo "### Automatic Tier Transitions"
  echo ""
  echo "Objects will automatically transition between tiers based on access patterns:"
  echo ""
  echo "1. **Frequent Access (FA):** Default tier, \$0.023/GB/month"
  echo "2. **Infrequent Access (IA):** After 30 days of no access, \$0.0125/GB/month"
  echo "3. **Archive Access:** After 90 days of no access, \$0.004/GB/month"
  echo "4. **Deep Archive Access:** After 180 days of no access, \$0.00099/GB/month"
  echo ""
  echo "### Monitoring Cost"
  echo ""
  echo "Intelligent Tiering charges \$0.0025 per 1,000 objects/month for monitoring."
  echo ""
  echo "### Next Steps"
  echo ""
  echo "1. Monitor bucket costs over the next 30-60 days"
  echo "2. Compare costs before and after configuration"
  echo "3. Review object tier distribution in S3 console"
  echo ""
} >> "$REPORT_FILE"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "🌊 Configuration Summary"
echo ""
echo "  Total buckets:             $TOTAL_BUCKETS"
echo "  Fully configured:          $SUCCESS_COUNT"
echo "  Lifecycle policies:        $LIFECYCLE_SUCCESS"
echo "  IT configurations:         $IT_CONFIG_SUCCESS"
echo "  Errors:                    $ERROR_COUNT"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "🌿 Output files:"
echo "   - $REPORT_FILE"
if [[ -f "$SUCCESS_LOG" ]]; then
  echo "   - $SUCCESS_LOG"
fi
if [[ -f "$ERROR_LOG" ]]; then
  echo "   - $ERROR_LOG"
fi
echo ""

if [[ "$DRY_RUN" == "true" ]]; then
  echo "✨ Dry run complete - no changes were made"
else
  echo "✨ Done!"
fi
echo ""
