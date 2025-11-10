# S3 Bucket Expense Optimizer - Delivery Plan

## Objective
Analyze S3 buckets costing >$1/month to identify potential savings from transitioning to Intelligent-Tiering storage class based on object access patterns.

## Criteria to Deliver
Given a bucket to evaluate for intelligent storage class savings:
- When asked to evaluate
- Then compute a table of:
  - Number of objects per access pattern cluster
  - Size of objects per access pattern cluster
  - Access pattern clusters: accessed-within=[90days, 30days, 1day]

## Architecture Overview

### Input Source
- Consume JSON output from `getS3BucketExpenseEvaluator.sh`
- Filter buckets with `monthly_cost > $1.00`

### Data Collection Strategy

#### Phase 1: Enable S3 Analytics & Storage Class Analysis
For each target bucket, leverage AWS native analytics:

1. **S3 Storage Class Analysis**
   - API: `s3api put-bucket-analytics-configuration`
   - Provides age-based access pattern data
   - Generates recommendations for lifecycle transitions
   - Data available after 24-48 hours of observation

2. **S3 Inventory Reports**
   - API: `s3api put-bucket-inventory-configuration`
   - Captures: object key, size, last-modified-date, storage-class
   - Stored as Parquet/CSV in designated bucket
   - Generated daily/weekly

#### Phase 2: Query CloudWatch Metrics for Current State
Leverage existing CloudWatch integration:

1. **Current Storage Distribution** (already available)
   - BucketSizeBytes by StorageType
   - NumberOfObjects by StorageType

2. **Additional Metrics to Query**
   - `AllRequests` metric (if S3 Request Metrics enabled)
   - `GetRequests` metric per bucket
   - Time-series data over 90-day window

#### Phase 3: Analyze Access Patterns via S3 Analytics Data

**Primary Method: S3 Analytics Filter**
```bash
# For each bucket, retrieve analytics data
aws s3api get-bucket-analytics-configuration \
  --bucket <bucket-name> \
  --id <config-id>

# Query the generated analytics data from S3
aws s3 cp s3://<analytics-bucket>/<prefix>/<date>/data.csv -
```

**Data Extraction:**
- Parse analytics CSV/Parquet files
- Group objects by age since last access:
  - `hot`: accessed within 1 day
  - `warm`: accessed within 30 days (but not 1 day)
  - `cool`: accessed within 90 days (but not 30 days)
  - `cold`: not accessed in 90+ days

**Fallback Method: Last-Modified Heuristic**
If analytics not available, use S3 Inventory with last-modified as proxy:
```bash
# Query inventory data
aws s3 select \
  --bucket <inventory-bucket> \
  --key <inventory-path> \
  --expression "SELECT Key, Size, LastModifiedDate, StorageClass ..." \
  --input-serialization '{"Parquet":{}}' \
  --output-serialization '{"JSON":{}}'
```

### Processing Pipeline

#### Step 1: Bucket Selection
```bash
# From evaluator output, extract buckets > $1/month
jq '.buckets[] |
    select(.monthly_cost > 1.0) |
    {bucket_name, monthly_cost, storage_class, size_gb, files}' \
  summary.json
```

#### Step 2: Access Pattern Analysis
For each selected bucket:

```bash
# Enable analytics if not already enabled
aws s3api put-bucket-analytics-configuration \
  --bucket $BUCKET \
  --id access-pattern-analysis \
  --analytics-configuration '{
    "Id": "access-pattern-analysis",
    "StorageClassAnalysis": {
      "DataExport": {
        "OutputSchemaVersion": "V_1",
        "Destination": {
          "S3BucketDestination": {
            "Format": "CSV",
            "Bucket": "arn:aws:s3:::<analytics-output-bucket>",
            "Prefix": "analytics/$BUCKET/"
          }
        }
      }
    }
  }'

# Wait for data generation (or use existing data)
# Download and parse analytics results
ANALYTICS_DATA=$(aws s3 cp s3://<analytics-bucket>/analytics/$BUCKET/latest.csv -)

# Aggregate by access pattern
echo "$ANALYTICS_DATA" | \
  awk -F',' 'NR>1 {
    age_days = $5  # DaysSinceLastAccess column
    size_bytes = $3

    if (age_days <= 1) {
      hot_count++; hot_size += size_bytes
    } else if (age_days <= 30) {
      warm_count++; warm_size += size_bytes
    } else if (age_days <= 90) {
      cool_count++; cool_size += size_bytes
    } else {
      cold_count++; cold_size += size_bytes
    }
  }
  END {
    printf "%d,%d,%d,%d,%d,%d,%d,%d\n",
      hot_count, hot_size,
      warm_count, warm_size,
      cool_count, cool_size,
      cold_count, cold_size
  }'
```

#### Step 3: Cost Calculation

**Current Cost** (from evaluator):
```
current_cost = size_gb * storage_price[current_class]
```

**Intelligent-Tiering Cost Estimation**:
```bash
# IT pricing model:
# - Frequent Access Tier: $0.023/GB
# - Infrequent Access Tier: $0.0125/GB
# - Archive Instant Access: $0.004/GB (90+ days)
# - Monitoring fee: $0.0025 per 1000 objects

# Assumptions for IT optimization:
# - Objects accessed within 30 days: Frequent Access tier
# - Objects 31-90 days: Infrequent Access tier
# - Objects 90+ days: Archive Instant Access tier

it_cost = \
  (hot_size_gb + warm_size_gb) * 0.023 + \
  cool_size_gb * 0.0125 + \
  cold_size_gb * 0.004 + \
  (total_objects / 1000) * 0.0025

savings = current_cost - it_cost
savings_percent = (savings / current_cost) * 100
```

### Output Format

#### Table Structure
```
Bucket Analysis: <bucket-name>
Current: <storage-class>, <size-gb> GB, <objects> objects, $<cost>/mo

Access Pattern Distribution:
┌─────────────────┬──────────────┬─────────────┬─────────────┐
│ Access Window   │ Object Count │ Size (GB)   │ % of Total  │
├─────────────────┼──────────────┼─────────────┼─────────────┤
│ ≤ 1 day (hot)   │        X,XXX │      XX.XXX │        XX%  │
│ ≤ 30 days       │        X,XXX │      XX.XXX │        XX%  │
│ ≤ 90 days       │        X,XXX │      XX.XXX │        XX%  │
│ > 90 days       │        X,XXX │      XX.XXX │        XX%  │
└─────────────────┴──────────────┴─────────────┴─────────────┘

Intelligent-Tiering Projection:
- Projected IT cost: $XX.XX/mo
- Current cost: $XX.XX/mo
- Potential savings: $XX.XX/mo (XX%)

Explanation:
- XX% of data is rarely accessed (>90 days), would move to Archive tier ($0.004/GB)
- XX% of data is infrequently accessed (30-90 days), would move to IA tier ($0.0125/GB)
- Monitoring overhead: $X.XX/mo for X,XXX objects
```

### Implementation Components

#### Script: `getS3BucketExpenseOptimizer.sh`

**Functions:**
1. `enable_analytics()` - Enable S3 Analytics for target buckets
2. `fetch_analytics_data()` - Download and parse analytics CSV
3. `analyze_access_patterns()` - Aggregate objects by access clusters
4. `calculate_it_savings()` - Compute cost comparison
5. `generate_report()` - Output markdown/JSON results

**Execution Flow:**
```bash
#!/bin/bash
# Input: JSON from getS3BucketExpenseEvaluator.sh
# Output: Optimization recommendations per bucket

# 1. Parse evaluator JSON, filter buckets > $1/mo
# 2. For each bucket:
#    a. Check if analytics enabled, enable if needed
#    b. Fetch analytics data (or inventory data as fallback)
#    c. Classify objects into access pattern buckets
#    d. Calculate current vs IT costs
#    e. Generate explanation
# 3. Output consolidated report
```

### Milestones

1. **M1: Analytics Setup** (Day 1)
   - Script to enable S3 Analytics on target buckets
   - Verify analytics data starts flowing

2. **M2: Data Collection** (Day 2-3)
   - Wait for initial analytics data (24-48h)
   - OR implement inventory-based fallback
   - Parse and validate data structure

3. **M3: Analysis Logic** (Day 4)
   - Implement access pattern clustering
   - Implement cost calculation formulas
   - Validate against known bucket

4. **M4: Reporting** (Day 5)
   - Markdown table generation
   - JSON output for programmatic consumption
   - Integration with evaluator workflow

5. **M5: Testing & Validation** (Day 6)
   - Test against multiple bucket types
   - Validate cost calculations
   - Document edge cases

## Key Dependencies

- **AWS S3 Analytics** must be enabled (may require 24-48h for initial data)
- **CloudWatch metrics** for current state (already available)
- **S3 Inventory** as fallback option (one-time setup per bucket)
- **Bulk query optimization** from evaluator brief (prefer batch APIs)

## Edge Cases to Handle

1. **No analytics data available yet**
   - Fall back to last-modified heuristic from inventory
   - Display warning that data is approximate

2. **Bucket already using Intelligent-Tiering**
   - Report "Already optimized"
   - Show current distribution across IT tiers

3. **Very small buckets (<1000 objects)**
   - Monitoring fees may exceed storage savings
   - Flag as "Not cost-effective for IT"

4. **Bucket with lifecycle policies**
   - Detect existing policies
   - Note potential conflicts with IT

5. **Incomplete access data**
   - Require minimum observation window (7 days)
   - Note confidence level in recommendation

## Success Criteria

- ✅ Accurately categorize objects into 90-day, 30-day, 1-day access windows
- ✅ Use CloudWatch metrics or S3 Analytics (not manual object iteration)
- ✅ Calculate realistic IT cost projections including monitoring fees
- ✅ Explain savings rationale (access pattern distribution)
- ✅ Process buckets in <1 minute per bucket (batch operations)
- ✅ Output consumable JSON + human-readable markdown
