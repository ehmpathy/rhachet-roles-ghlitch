# S3 Bucket Usage Observability - Metadata Export and Cost Optimization

## What Metadata Can We Add/Export from S3 Buckets?

AWS provides three main approaches for gaining visibility into S3 bucket object metadata and access patterns:

### 1. S3 Metadata (New 2025 Feature - RECOMMENDED)

The newest and most powerful option, announced at re:Invent 2024 and significantly updated in July 2025.

**What it provides:**
- Fully managed Apache Iceberg tables with complete object metadata
- Two table types:
  - **Journal Table**: Near real-time view of object-level changes (uploads, deletions, metadata updates)
  - **Live Inventory Table**: Complete snapshot of all objects and their metadata in the bucket

**Available metadata includes:**
- Object key, size, last modified timestamp
- Storage class
- ETag, version ID
- Encryption status
- Object tags
- Access tier (for Intelligent-Tiering objects)
- All metadata for existing objects (via backfill support)

**Configuration options:**
- Server-side encryption settings
- Journal record expiration period
- Automatic hourly refresh for live inventory

### 2. S3 Inventory (Traditional Method)

Legacy approach for scheduled metadata exports.

**What it provides:**
- Scheduled exports (daily or weekly) of object lists
- CSV, ORC, or Parquet format files
- Configurable metadata fields including:
  - Object keys, sizes, last modified dates
  - Storage classes
  - Encryption status
  - Replication status
  - ETag, version ID
  - Object tags
  - Intelligent-Tiering access tier

**Configuration options:**
- Source bucket to analyze
- Destination bucket for reports
- Daily or weekly frequency
- All versions or current versions only
- Optional encryption with SSE-KMS or SSE-S3

### 3. Storage Class Analysis

Analyzes access patterns to recommend storage class transitions.

**What it provides:**
- Access pattern analysis over time
- Recommendations for Standard → Standard-IA transitions
- Age group analysis for objects
- Export capability to CSV format
- Daily updated reports

**Available insights:**
- Object age when accessed
- Access frequency patterns
- Cost optimization opportunities for Standard to Standard-IA transitions

---

## How Long Does It Take for Metadata to Be Available?

### S3 Metadata (Fastest)
- **Journal Table**: Near real-time updates (within minutes)
- **Live Inventory Table**: Automatically refreshed within **1 hour** of changes
- **Backfill for existing objects**: Completes within hours to days depending on bucket size
- **Immediate querying**: Can query using AWS tools (Athena, Spark, etc.) as soon as tables are created

### S3 Inventory (Slower)
- **First report**: Generated within **24-48 hours** after configuration
- **Subsequent reports**:
  - Daily: Available once per day (typically completes by end of day)
  - Weekly: Available once per week
- **Delivery**: Reports delivered to destination bucket according to schedule
- **Processing time**: Depends on bucket size; larger buckets take longer

### Storage Class Analysis (Slowest)
- **Initial analysis**: Requires **30+ days** of observation before first recommendations
- **Report updates**: Daily updates after initial observation period
- **Export frequency**: Can export daily once analysis begins
- **Recommendation accuracy**: Improves over time with more data

**Summary:**
- Need real-time data? → S3 Metadata (1 hour)
- Need scheduled reports? → S3 Inventory (24-48 hours initially, then daily/weekly)
- Need lifecycle recommendations? → Storage Class Analysis (30+ days)

---

## How to Apply Metadata to Assess Storage Tier Cost Saving Opportunities

### Step 1: Enable S3 Metadata or Inventory

For real-time analysis, use S3 Metadata:

```bash
# Enable S3 Metadata configuration via AWS Console or CLI
aws s3api put-bucket-metadata-table-configuration \
  --bucket my-bucket \
  --metadata-table-configuration '{
    "S3TablesDestination": {
      "TableBucketArn": "arn:aws:s3tables:region:account:bucket/table-bucket",
      "TableName": "my-bucket-metadata"
    }
  }'
```

### Step 2: Query Metadata to Identify Access Patterns

Use Athena or Spark to query the metadata table:

```sql
-- Find objects not accessed in 30+ days (candidates for Infrequent Access)
SELECT
  key,
  size,
  storage_class,
  last_modified_date,
  DATEDIFF(day, last_modified_date, CURRENT_DATE) as days_since_modified,
  (size / 1024 / 1024 / 1024) as size_gb,
  (size / 1024 / 1024 / 1024) * 0.023 * 0.4 as monthly_savings_if_ia
FROM s3_metadata_table
WHERE storage_class = 'STANDARD'
  AND DATEDIFF(day, last_modified_date, CURRENT_DATE) > 30
  AND size > 134217728  -- 128 KB minimum for tiering
ORDER BY size DESC;

-- Find objects not accessed in 90+ days (candidates for Archive Instant Access)
SELECT
  key,
  size,
  storage_class,
  last_modified_date,
  DATEDIFF(day, last_modified_date, CURRENT_DATE) as days_since_modified,
  (size / 1024 / 1024 / 1024) as size_gb,
  (size / 1024 / 1024 / 1024) * 0.023 * 0.68 as monthly_savings_if_archive
FROM s3_metadata_table
WHERE storage_class = 'STANDARD'
  AND DATEDIFF(day, last_modified_date, CURRENT_DATE) > 90
  AND size > 134217728
ORDER BY size DESC;
```

### Step 3: Calculate Cost Savings Opportunities

**Storage Class Pricing (US East - Ohio, approximate):**
- Standard: $0.023/GB/month
- Standard-IA: $0.0125/GB/month (40% savings)
- Intelligent-Tiering: $0.023/GB (Frequent) → $0.0125/GB (Infrequent) → $0.004/GB (Archive)
- Archive Instant Access: ~$0.004/GB/month (68% savings)

**Savings calculation formula:**
```
Monthly Savings = (Total GB) × (Current tier price - Target tier price)

For Standard → Intelligent-Tiering:
  If 50% of data moves to Infrequent Access (30+ days):
    Savings = (Total GB × 0.5) × ($0.023 - $0.0125) = Total GB × 0.00525

  If 30% moves to Archive Instant (90+ days):
    Savings = (Total GB × 0.3) × ($0.023 - $0.004) = Total GB × 0.0057

Annual Savings = Monthly Savings × 12
```

**Cost considerations:**
- Intelligent-Tiering monitoring fee: ~$0.0025 per 1,000 objects/month
- Minimum object size for auto-tiering: 128 KB
- No retrieval charges for Intelligent-Tiering (unlike Standard-IA)

### Step 4: Use Storage Class Analysis for Validation

Enable Storage Class Analysis on specific buckets/prefixes to validate assumptions:

```bash
aws s3api put-bucket-analytics-configuration \
  --bucket my-bucket \
  --id analytics-config-1 \
  --analytics-configuration '{
    "Id": "analytics-config-1",
    "StorageClassAnalysis": {
      "DataExport": {
        "OutputSchemaVersion": "V_1",
        "Destination": {
          "S3BucketDestination": {
            "Format": "CSV",
            "BucketArn": "arn:aws:s3:::destination-bucket",
            "Prefix": "analytics-reports/"
          }
        }
      }
    }
  }'
```

Wait 30+ days for initial recommendations, then review to confirm lifecycle policy decisions.

### Step 5: Decision Matrix for Storage Tier Selection

**Use Intelligent-Tiering when:**
- Access patterns are unknown or unpredictable
- You have >128 KB objects
- You want zero-touch cost optimization
- You need frequent access without retrieval charges

**Use Lifecycle Policies (Manual Transitions) when:**
- Access patterns are predictable (e.g., logs, backups)
- You have compliance requirements for retention periods
- You want fine-grained control over transitions
- Objects follow a clear aging pattern

**Use Storage Class Analysis when:**
- You need data-driven recommendations for lifecycle policies
- You're transitioning from Standard to Standard-IA only
- You want to validate your assumptions before implementing

---

## How to Update Existing Buckets to Add Metadata Export

### Option 1: Enable S3 Metadata (Recommended for New Implementations)

**Via AWS Console:**
1. Open the S3 console and select your bucket
2. Navigate to the **Metrics** tab
3. Click **Create metadata configuration**
4. Configure Journal Table:
   - Select server-side encryption (SSE-S3 or SSE-KMS)
   - Set record expiration period (e.g., 30 days)
5. Enable Live Inventory Table:
   - Toggle **Enabled**
   - Select server-side encryption
6. Click **Create configuration**

**Via AWS CLI:**
```bash
# Create S3 Tables bucket first (if not exists)
aws s3tables create-table-bucket \
  --name my-metadata-tables \
  --region us-east-2

# Enable S3 Metadata on existing bucket
aws s3api put-bucket-metadata-table-configuration \
  --bucket my-existing-bucket \
  --metadata-table-configuration '{
    "S3TablesDestination": {
      "TableBucketArn": "arn:aws:s3tables:us-east-2:123456789012:bucket/my-metadata-tables",
      "TableName": "my-existing-bucket-metadata"
    }
  }'
```

**Important:** If you created S3 Metadata configuration before July 15, 2025, AWS recommends deleting and re-creating it to access new features (journal record expiration and live inventory tables).

### Option 2: Enable S3 Inventory (Traditional Method)

**Via AWS Console:**
1. Open the S3 console and select your bucket
2. Navigate to **Management** → **Inventory configurations**
3. Click **Create inventory configuration**
4. Configure:
   - **Configuration name**: descriptive name
   - **Destination bucket**: where reports will be stored
   - **Frequency**: Daily or Weekly
   - **Output format**: CSV, ORC, or Parquet
   - **Object versions**: All or Current only
   - **Optional fields**: Select metadata to include (storage class, size, encryption status, etc.)
5. Click **Create**

**Via AWS CLI:**
```bash
aws s3api put-bucket-inventory-configuration \
  --bucket my-existing-bucket \
  --id inventory-config-1 \
  --inventory-configuration '{
    "Id": "inventory-config-1",
    "IsEnabled": true,
    "Destination": {
      "S3BucketDestination": {
        "AccountId": "123456789012",
        "Bucket": "arn:aws:s3:::my-inventory-bucket",
        "Format": "CSV",
        "Prefix": "inventory-reports/"
      }
    },
    "Schedule": {
      "Frequency": "Daily"
    },
    "OptionalFields": [
      "Size",
      "LastModifiedDate",
      "StorageClass",
      "ETag",
      "IntelligentTieringAccessTier",
      "BucketKeyStatus"
    ],
    "IncludedObjectVersions": "Current"
  }'
```

### Option 3: Enable Storage Class Analysis

**Via AWS Console:**
1. Open the S3 console and select your bucket
2. Navigate to **Metrics** → **Storage Class Analysis**
3. Click **Create analytics configuration**
4. Configure:
   - **Configuration name**: descriptive name
   - **Choose scope**: Whole bucket or prefix/tag filters
   - **Export**: Enable to export to another bucket
5. Click **Create**

**Via AWS CLI:**
```bash
aws s3api put-bucket-analytics-configuration \
  --bucket my-existing-bucket \
  --id analytics-all-objects \
  --analytics-configuration '{
    "Id": "analytics-all-objects",
    "StorageClassAnalysis": {
      "DataExport": {
        "OutputSchemaVersion": "V_1",
        "Destination": {
          "S3BucketDestination": {
            "Format": "CSV",
            "BucketArn": "arn:aws:s3:::my-analytics-bucket",
            "Prefix": "storage-class-analysis/"
          }
        }
      }
    }
  }'
```

### Bulk Update Script for Multiple Buckets

```bash
#!/bin/bash
# Enable S3 Metadata for all buckets in an account

REGION="us-east-2"
TABLE_BUCKET_ARN="arn:aws:s3tables:${REGION}:123456789012:bucket/metadata-tables"

# Get all buckets
BUCKETS=$(aws s3api list-buckets --query 'Buckets[].Name' --output text)

for BUCKET in $BUCKETS; do
  echo "Enabling S3 Metadata for bucket: $BUCKET"

  aws s3api put-bucket-metadata-table-configuration \
    --bucket "$BUCKET" \
    --metadata-table-configuration "{
      \"S3TablesDestination\": {
        \"TableBucketArn\": \"${TABLE_BUCKET_ARN}\",
        \"TableName\": \"${BUCKET}-metadata\"
      }
    }" \
    --region "$REGION" 2>&1

  if [ $? -eq 0 ]; then
    echo "✓ Successfully enabled for $BUCKET"
  else
    echo "✗ Failed to enable for $BUCKET"
  fi
done
```

### Verification

After enabling metadata export, verify configuration:

```bash
# Verify S3 Metadata configuration
aws s3api get-bucket-metadata-table-configuration --bucket my-bucket

# Verify S3 Inventory configuration
aws s3api list-bucket-inventory-configurations --bucket my-bucket

# Verify Storage Class Analysis configuration
aws s3api list-bucket-analytics-configurations --bucket my-bucket
```

---

## Recommended Approach for Cost Optimization

1. **Day 0**: Enable S3 Metadata on all buckets for real-time visibility
2. **Day 1**: Query metadata tables to identify immediate opportunities (objects >90 days old)
3. **Day 1-30**: Enable Storage Class Analysis on high-cost buckets for validation
4. **Day 30**: Review Storage Class Analysis recommendations
5. **Day 31+**: Implement Intelligent-Tiering or Lifecycle Policies based on findings
6. **Ongoing**: Monitor monthly cost savings and adjust as needed

This approach balances immediate insights (S3 Metadata) with validated recommendations (Storage Class Analysis) to maximize cost savings while minimizing risk.
