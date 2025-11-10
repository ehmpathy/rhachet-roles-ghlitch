#!/bin/bash
# .what = evaluate S3 storage tier optimization opportunities and potential cost savings
# .why = identify objects that can be moved to cheaper storage tiers to reduce costs

set -euo pipefail

# generate iso datetime for default output path
ISO_DATETIME=$(date -u +%Y_%m_%dT%H_%M_%SZ)

# parse arguments
OUTPUT_DIR=""
DAYS_THRESHOLD=90  # default: objects not modified in 90 days are candidates for cheaper tiers

while [[ $# -gt 0 ]]; do
  case $1 in
    --output)
      OUTPUT_DIR="$2"
      shift 2
      ;;
    --days)
      DAYS_THRESHOLD="$2"
      shift 2
      ;;
    *)
      echo "⛈️  Error: Unknown argument: $1"
      echo "Usage: $0 [--days <threshold>] [--output <directory-path>]"
      exit 1
      ;;
  esac
done

# get current AWS account ID
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

# set default output directory if not specified
if [[ -z "$OUTPUT_DIR" ]]; then
  OUTPUT_DIR="getS3UsageTierEvaluator/${ACCOUNT_NAME}/${ISO_DATETIME}"
fi

# ensure output directory exists
if [[ ! -d "$OUTPUT_DIR" ]]; then
  echo "🌿 Creating output directory: $OUTPUT_DIR"
  mkdir -p "$OUTPUT_DIR"
fi

# define output file paths
ANALYSIS_JSON_FILE="${OUTPUT_DIR}/analysis.json"
SUMMARY_MD_FILE="${OUTPUT_DIR}/summary.md"
RECOMMENDATIONS_MD_FILE="${OUTPUT_DIR}/recommendations.md"

echo "🌊 Analyzing S3 storage tier optimization opportunities..."
echo "🌿 Output directory: $OUTPUT_DIR"
echo "🌿 Threshold: Objects not modified in last $DAYS_THRESHOLD days"
echo ""

# calculate date ranges
PERIOD_SINCE=$(date -d "$(date +%Y-%m-01) -1 month" +%Y-%m-%d)
PERIOD_UPTIL=$(date +%Y-%m-01)
CUTOFF_DATE=$(date -d "$DAYS_THRESHOLD days ago" +%Y-%m-%d)
CUTOFF_TIMESTAMP=$(date -d "$CUTOFF_DATE" +%s)

echo "🔭 Querying S3 costs for last month ($PERIOD_SINCE to $PERIOD_UPTIL)..."
S3_COST_DATA=$(aws ce get-cost-and-usage \
  --time-period Start="$PERIOD_SINCE",End="$PERIOD_UPTIL" \
  --granularity MONTHLY \
  --metrics "UnblendedCost" "UsageQuantity" \
  --group-by Type=DIMENSION,Key=USAGE_TYPE \
  --filter "{\"And\":[{\"Dimensions\":{\"Key\":\"SERVICE\",\"Values\":[\"Amazon Simple Storage Service\"]}},{\"Dimensions\":{\"Key\":\"LINKED_ACCOUNT\",\"Values\":[\"$ACCOUNT_ID\"]}}]}" \
  --output json)

TOTAL_S3_COST=$(echo "$S3_COST_DATA" | jq -r '[.ResultsByTime[0].Groups[]?.Metrics.UnblendedCost.Amount | tonumber] | add // 0')
CURRENCY=$(echo "$S3_COST_DATA" | jq -r '.ResultsByTime[0].Groups[0]?.Metrics.UnblendedCost.Unit // "USD"')

echo "✨ Current S3 monthly cost: \$$TOTAL_S3_COST $CURRENCY"
echo ""

# get storage pricing estimates (approximate monthly costs per GB)
# these are approximate US East (N. Virginia) prices
STANDARD_PRICE=0.023      # $0.023/GB/month
STANDARD_IA_PRICE=0.0125  # $0.0125/GB/month
ONEZONE_IA_PRICE=0.01     # $0.01/GB/month
GLACIER_INSTANT_PRICE=0.004  # $0.004/GB/month
GLACIER_FLEXIBLE_PRICE=0.0036  # $0.0036/GB/month
GLACIER_DEEP_PRICE=0.00099     # $0.00099/GB/month

echo "🔭 Listing all S3 buckets..."
BUCKETS=$(aws s3api list-buckets --query 'Buckets[].Name' --output json)
BUCKET_COUNT=$(echo "$BUCKETS" | jq 'length')

echo "✨ Found $BUCKET_COUNT buckets"
echo ""

# initialize counters
TOTAL_OBJECTS=0
TOTAL_SIZE_GB=0
STANDARD_OBJECTS=0
STANDARD_SIZE_GB=0
CANDIDATES_OBJECTS=0
CANDIDATES_SIZE_GB=0

# array to store per-bucket analysis
declare -a BUCKET_ANALYSIS=()

# analyze each bucket
echo "🔭 Analyzing buckets and objects..."
echo ""

while IFS= read -r BUCKET_NAME; do
  echo "  📦 Analyzing bucket: $BUCKET_NAME"

  # get bucket location to skip if needed
  BUCKET_REGION=$(aws s3api get-bucket-location --bucket "$BUCKET_NAME" --query 'LocationConstraint' --output text 2>/dev/null || echo "us-east-1")
  if [[ "$BUCKET_REGION" == "None" ]]; then
    BUCKET_REGION="us-east-1"
  fi

  # list objects with storage class and metadata
  # use pagination to handle large buckets, limit to 1000 objects per bucket for analysis
  OBJECTS_DATA=$(aws s3api list-objects-v2 \
    --bucket "$BUCKET_NAME" \
    --max-items 1000 \
    --query 'Contents[?Size>`0`].[Key,Size,StorageClass,LastModified]' \
    --output json 2>/dev/null || echo "[]")

  # handle null or empty results
  if [[ "$OBJECTS_DATA" == "null" ]] || [[ "$OBJECTS_DATA" == "[]" ]] || [[ -z "$OBJECTS_DATA" ]]; then
    echo "     ℹ️  Bucket is empty or inaccessible"
    continue
  fi

  # calculate bucket statistics
  BUCKET_OBJECT_COUNT=$(echo "$OBJECTS_DATA" | jq 'if . == null then 0 else length end')
  if [[ "$BUCKET_OBJECT_COUNT" == "0" ]]; then
    echo "     ℹ️  No objects found"
    continue
  fi
  BUCKET_TOTAL_SIZE=$(echo "$OBJECTS_DATA" | jq 'if . == null then 0 else [.[][1]] | add // 0 end')
  BUCKET_TOTAL_SIZE_GB=$(echo "scale=3; $BUCKET_TOTAL_SIZE / 1024 / 1024 / 1024" | bc)

  # count objects in STANDARD storage
  BUCKET_STANDARD_OBJECTS=$(echo "$OBJECTS_DATA" | jq '[.[] | select(.[2] == "STANDARD" or .[2] == null)] | length')
  BUCKET_STANDARD_SIZE=$(echo "$OBJECTS_DATA" | jq '[.[] | select(.[2] == "STANDARD" or .[2] == null) | .[1]] | add // 0')
  BUCKET_STANDARD_SIZE_GB=$(echo "scale=3; $BUCKET_STANDARD_SIZE / 1024 / 1024 / 1024" | bc)

  # find objects in STANDARD not modified recently (candidates for tiering)
  BUCKET_CANDIDATES_OBJECTS=$(echo "$OBJECTS_DATA" | jq --arg cutoff "$CUTOFF_DATE" '[.[] | select((.[2] == "STANDARD" or .[2] == null) and (.[3] < $cutoff))] | length')
  BUCKET_CANDIDATES_SIZE=$(echo "$OBJECTS_DATA" | jq --arg cutoff "$CUTOFF_DATE" '[.[] | select((.[2] == "STANDARD" or .[2] == null) and (.[3] < $cutoff)) | .[1]] | add // 0')
  BUCKET_CANDIDATES_SIZE_GB=$(echo "scale=3; $BUCKET_CANDIDATES_SIZE / 1024 / 1024 / 1024" | bc)

  # update totals
  TOTAL_OBJECTS=$((TOTAL_OBJECTS + BUCKET_OBJECT_COUNT))
  TOTAL_SIZE_GB=$(echo "$TOTAL_SIZE_GB + $BUCKET_TOTAL_SIZE_GB" | bc)
  STANDARD_OBJECTS=$((STANDARD_OBJECTS + BUCKET_STANDARD_OBJECTS))
  STANDARD_SIZE_GB=$(echo "$STANDARD_SIZE_GB + $BUCKET_STANDARD_SIZE_GB" | bc)
  CANDIDATES_OBJECTS=$((CANDIDATES_OBJECTS + BUCKET_CANDIDATES_OBJECTS))
  CANDIDATES_SIZE_GB=$(echo "$CANDIDATES_SIZE_GB + $BUCKET_CANDIDATES_SIZE_GB" | bc)

  # store bucket analysis
  BUCKET_ANALYSIS+=("$BUCKET_NAME|$BUCKET_REGION|$BUCKET_OBJECT_COUNT|$BUCKET_TOTAL_SIZE_GB|$BUCKET_STANDARD_OBJECTS|$BUCKET_STANDARD_SIZE_GB|$BUCKET_CANDIDATES_OBJECTS|$BUCKET_CANDIDATES_SIZE_GB")

  echo "     ✨ Objects: $BUCKET_OBJECT_COUNT, Size: ${BUCKET_TOTAL_SIZE_GB}GB, Candidates: $BUCKET_CANDIDATES_OBJECTS (${BUCKET_CANDIDATES_SIZE_GB}GB)"

done < <(echo "$BUCKETS" | jq -r '.[]')

echo ""
echo "✨ Analysis complete"
echo ""

# calculate potential savings
# assume moving to Standard-IA (conservative estimate)
CURRENT_STORAGE_COST=$(echo "$CANDIDATES_SIZE_GB * $STANDARD_PRICE" | bc)
OPTIMIZED_STORAGE_COST=$(echo "$CANDIDATES_SIZE_GB * $STANDARD_IA_PRICE" | bc)
MONTHLY_SAVINGS=$(echo "$CURRENT_STORAGE_COST - $OPTIMIZED_STORAGE_COST" | bc)
ANNUAL_SAVINGS=$(echo "$MONTHLY_SAVINGS * 12" | bc)
SAVINGS_PERCENT=$(echo "scale=1; ($MONTHLY_SAVINGS / $CURRENT_STORAGE_COST) * 100" | bc 2>/dev/null || echo "0")

# also calculate savings for more aggressive tiering (Glacier Instant Retrieval)
GLACIER_STORAGE_COST=$(echo "$CANDIDATES_SIZE_GB * $GLACIER_INSTANT_PRICE" | bc)
GLACIER_MONTHLY_SAVINGS=$(echo "$CURRENT_STORAGE_COST - $GLACIER_STORAGE_COST" | bc)
GLACIER_ANNUAL_SAVINGS=$(echo "$GLACIER_MONTHLY_SAVINGS * 12" | bc)

# write analysis JSON
cat > "$ANALYSIS_JSON_FILE" << EOF
{
  "account": {
    "id": "$ACCOUNT_ID",
    "alias": "$ACCOUNT_ALIAS",
    "display": "$ACCOUNT_DISPLAY"
  },
  "analysis_date": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "threshold_days": $DAYS_THRESHOLD,
  "cutoff_date": "$CUTOFF_DATE",
  "cost_period": {
    "since": "$PERIOD_SINCE",
    "uptil": "$PERIOD_UPTIL"
  },
  "current_costs": {
    "total_s3_monthly": $TOTAL_S3_COST,
    "currency": "$CURRENCY"
  },
  "storage_summary": {
    "total_buckets": $BUCKET_COUNT,
    "total_objects_analyzed": $TOTAL_OBJECTS,
    "total_size_gb": $TOTAL_SIZE_GB,
    "standard_tier_objects": $STANDARD_OBJECTS,
    "standard_tier_size_gb": $STANDARD_SIZE_GB,
    "optimization_candidates_objects": $CANDIDATES_OBJECTS,
    "optimization_candidates_size_gb": $CANDIDATES_SIZE_GB
  },
  "savings_potential": {
    "standard_ia": {
      "current_monthly_cost": $CURRENT_STORAGE_COST,
      "optimized_monthly_cost": $OPTIMIZED_STORAGE_COST,
      "monthly_savings": $MONTHLY_SAVINGS,
      "annual_savings": $ANNUAL_SAVINGS,
      "savings_percent": $SAVINGS_PERCENT
    },
    "glacier_instant": {
      "optimized_monthly_cost": $GLACIER_STORAGE_COST,
      "monthly_savings": $GLACIER_MONTHLY_SAVINGS,
      "annual_savings": $GLACIER_ANNUAL_SAVINGS
    }
  },
  "pricing_assumptions": {
    "standard_gb_month": $STANDARD_PRICE,
    "standard_ia_gb_month": $STANDARD_IA_PRICE,
    "glacier_instant_gb_month": $GLACIER_INSTANT_PRICE,
    "region": "us-east-1 (approximate)"
  }
}
EOF

echo "✨ Analysis data written to: $ANALYSIS_JSON_FILE"
echo ""

# write summary markdown
cat > "$SUMMARY_MD_FILE" << EOF
# s3 storage tier optimization analysis

## account
**$ACCOUNT_DISPLAY**

## analysis period
- cost period: $PERIOD_SINCE to $PERIOD_UPTIL
- analysis date: $(date -u +%Y-%m-%d)
- threshold: objects not modified in last $DAYS_THRESHOLD days

## current costs
- total s3 monthly cost: \$$TOTAL_S3_COST $CURRENCY

## storage summary

| metric | value |
|--------|-------|
| total buckets analyzed | $BUCKET_COUNT |
| total objects analyzed | $TOTAL_OBJECTS |
| total storage size | ${TOTAL_SIZE_GB}GB |
| objects in STANDARD tier | $STANDARD_OBJECTS |
| STANDARD tier size | ${STANDARD_SIZE_GB}GB |

## optimization opportunities

| metric | value |
|--------|-------|
| candidate objects (not modified in $DAYS_THRESHOLD+ days) | $CANDIDATES_OBJECTS |
| candidate storage size | ${CANDIDATES_SIZE_GB}GB |
| percentage of total | $(echo "scale=1; ($CANDIDATES_SIZE_GB / $TOTAL_SIZE_GB) * 100" | bc)% |

## savings potential

### conservative estimate (move to Standard-IA)
- current monthly storage cost: \$${CURRENT_STORAGE_COST}
- optimized monthly cost: \$${OPTIMIZED_STORAGE_COST}
- **monthly savings: \$${MONTHLY_SAVINGS}** (${SAVINGS_PERCENT}%)
- **annual savings: \$${ANNUAL_SAVINGS}**

### aggressive estimate (move to Glacier Instant Retrieval)
- optimized monthly cost: \$${GLACIER_STORAGE_COST}
- **monthly savings: \$${GLACIER_MONTHLY_SAVINGS}**
- **annual savings: \$${GLACIER_ANNUAL_SAVINGS}**

## per-bucket breakdown

| bucket | region | objects | size (GB) | candidates | candidate size (GB) |
|--------|--------|---------|-----------|------------|---------------------|
EOF

# add per-bucket rows
for BUCKET_INFO in "${BUCKET_ANALYSIS[@]}"; do
  IFS='|' read -r BUCKET REGION OBJS SIZE STD_OBJS STD_SIZE CAND_OBJS CAND_SIZE <<< "$BUCKET_INFO"
  printf "| %-40s | %-12s | %7s | %9s | %10s | %19s |\n" "$BUCKET" "$REGION" "$OBJS" "$SIZE" "$CAND_OBJS" "$CAND_SIZE" >> "$SUMMARY_MD_FILE"
done

cat >> "$SUMMARY_MD_FILE" << EOF

---

## notes
- analysis based on LastModified timestamp (not last access time, which is not available via S3 API)
- objects not modified in $DAYS_THRESHOLD+ days are candidates for cheaper storage tiers
- savings estimates use approximate US East (N. Virginia) pricing
- actual savings may vary based on region, retrieval patterns, and data transfer costs
- consider S3 Lifecycle policies or S3 Intelligent-Tiering for automatic optimization

---

generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF

echo "✨ Summary written to: $SUMMARY_MD_FILE"
echo ""

# write recommendations markdown
cat > "$RECOMMENDATIONS_MD_FILE" << EOF
# s3 storage tier optimization recommendations

## account
**$ACCOUNT_DISPLAY**

## executive summary
Based on analysis of your S3 storage, **${CANDIDATES_SIZE_GB}GB** across **$CANDIDATES_OBJECTS objects** has not been modified in over $DAYS_THRESHOLD days.

Moving these objects to more cost-effective storage tiers could save:
- **\$${MONTHLY_SAVINGS}/month** (Standard-IA)
- **\$${GLACIER_MONTHLY_SAVINGS}/month** (Glacier Instant Retrieval)

## recommended actions

### 1. enable s3 intelligent-tiering
The easiest way to optimize storage costs is to enable S3 Intelligent-Tiering on your buckets.

- automatically moves objects between access tiers based on usage patterns
- no retrieval fees
- small monthly monitoring fee (\$0.0025 per 1,000 objects)

**command to enable:**
\`\`\`bash
# for a specific bucket
aws s3api put-bucket-intelligent-tiering-configuration \\
  --bucket <bucket-name> \\
  --id default-intelligent-tiering \\
  --intelligent-tiering-configuration '{...}'
\`\`\`

### 2. create lifecycle policies
For predictable access patterns, use lifecycle policies to automatically transition objects:

**recommended policy:**
- after 30 days: transition to Standard-IA
- after 90 days: transition to Glacier Instant Retrieval
- after 180 days: transition to Glacier Flexible Retrieval

**command to create lifecycle policy:**
\`\`\`bash
aws s3api put-bucket-lifecycle-configuration \\
  --bucket <bucket-name> \\
  --lifecycle-configuration file://lifecycle-policy.json
\`\`\`

### 3. high-impact buckets to prioritize

EOF

# add top buckets by savings potential
echo "Top buckets by optimization potential:" >> "$RECOMMENDATIONS_MD_FILE"
echo "" >> "$RECOMMENDATIONS_MD_FILE"
echo "| bucket | candidate size (GB) | estimated monthly savings |" >> "$RECOMMENDATIONS_MD_FILE"
echo "|--------|---------------------|---------------------------|" >> "$RECOMMENDATIONS_MD_FILE"

for BUCKET_INFO in "${BUCKET_ANALYSIS[@]}"; do
  IFS='|' read -r BUCKET REGION OBJS SIZE STD_OBJS STD_SIZE CAND_OBJS CAND_SIZE <<< "$BUCKET_INFO"
  if (( $(echo "$CAND_SIZE > 0" | bc -l) )); then
    BUCKET_SAVINGS=$(echo "$CAND_SIZE * ($STANDARD_PRICE - $STANDARD_IA_PRICE)" | bc)
    echo "$BUCKET|$CAND_SIZE|$BUCKET_SAVINGS"
  fi
done | sort -t'|' -k2 -rn | head -10 | while IFS='|' read -r BUCKET CAND_SIZE BUCKET_SAVINGS; do
  printf "| %-40s | %19s | \$%-24s |\n" "$BUCKET" "$CAND_SIZE" "$BUCKET_SAVINGS" >> "$RECOMMENDATIONS_MD_FILE"
done

cat >> "$RECOMMENDATIONS_MD_FILE" << EOF

### 4. storage class comparison

| storage class | use case | cost/GB/month | retrieval cost | retrieval time |
|---------------|----------|---------------|----------------|----------------|
| Standard | frequently accessed | \$0.023 | none | milliseconds |
| Intelligent-Tiering | unknown or changing access | \$0.023-0.0036 | none | milliseconds |
| Standard-IA | infrequent access (30+ days) | \$0.0125 | \$0.01/GB | milliseconds |
| Glacier Instant | rare access, instant retrieval | \$0.004 | \$0.03/GB | milliseconds |
| Glacier Flexible | archive, minutes retrieval | \$0.0036 | varies | minutes-hours |
| Glacier Deep Archive | long-term archive | \$0.00099 | varies | 12 hours |

## next steps

1. review the per-bucket breakdown in the summary report
2. enable S3 Intelligent-Tiering for buckets with unpredictable access patterns
3. create lifecycle policies for buckets with predictable aging patterns
4. monitor costs after implementation to validate savings
5. run this analysis monthly to track optimization progress

---

generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF

echo "✨ Recommendations written to: $RECOMMENDATIONS_MD_FILE"
echo ""

# display summary
echo "🌊 S3 Storage Tier Optimization Summary"
echo ""
echo "📊 Storage Overview:"
echo "   - Total buckets: $BUCKET_COUNT"
echo "   - Total objects: $TOTAL_OBJECTS"
echo "   - Total size: ${TOTAL_SIZE_GB}GB"
echo "   - Objects in STANDARD: $STANDARD_OBJECTS (${STANDARD_SIZE_GB}GB)"
echo ""
echo "💰 Optimization Opportunities:"
echo "   - Candidate objects: $CANDIDATES_OBJECTS"
echo "   - Candidate size: ${CANDIDATES_SIZE_GB}GB"
echo "   - Current monthly storage cost: \$${CURRENT_STORAGE_COST}"
echo ""
echo "💵 Potential Savings:"
echo "   - Standard-IA: \$${MONTHLY_SAVINGS}/month (\$${ANNUAL_SAVINGS}/year)"
echo "   - Glacier Instant: \$${GLACIER_MONTHLY_SAVINGS}/month (\$${GLACIER_ANNUAL_SAVINGS}/year)"
echo ""
echo "✨ Done!"
echo ""
echo "🌿 Output files:"
echo "   - analysis: $ANALYSIS_JSON_FILE"
echo "   - summary: $SUMMARY_MD_FILE"
echo "   - recommendations: $RECOMMENDATIONS_MD_FILE"
echo ""
