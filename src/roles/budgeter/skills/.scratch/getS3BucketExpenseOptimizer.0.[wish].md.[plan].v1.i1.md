# S3 Bucket Expense Optimizer - Implementation Plan v1.i1

## Objective
Analyze buckets costing > $1/mo and recommend Intelligent Tiering transitions with **ACTUAL SAVINGS ESTIMATES based on OBSERVED USAGE**.

## Critical Constraint

**Requirement:** Must compute actual estimates based on actual observed usage data.

**AWS S3 Limitation:** S3 does not track "last access time" per object via bulk API.

## Available Actual Usage Data Sources

### 1. Current Storage Distribution (Available Now)
**Source:** CloudWatch metrics (already collected by evaluator)
- BucketSizeBytes by storage class
- NumberOfObjects by storage class
- **What it tells us:** Current distribution across Standard, Standard-IA, IT-FA, IT-IA, etc.

### 2. Request Metrics (Available Now - if enabled)
**Source:** CloudWatch request metrics
- `AllRequests`: Total requests per bucket (last 30 days)
- `GetRequests`: Read requests per bucket (last 30 days)
- **What it tells us:** Bucket-level access frequency (requests/day/object average)
- **Limitation:** Bucket-level aggregate, not per-object
- **Cost:** $0.01 per 1,000 requests monitored/month (if not already enabled)

### 3. S3 Storage Class Analysis (Requires 30-day setup)
**Source:** AWS built-in analytics service
- **What it tells us:** ACTUAL aggregate access patterns by object age group after 30 days observation
  - "X% of objects 0-30 days old were accessed in the last 30 days"
  - "Y% of objects 30-89 days old were accessed in the last 30 days"
  - "Z% of objects 90+ days old were accessed in the last 30 days"
- **How to use:** Set up on high-cost buckets, wait 30 days, parse CSV exports
- **Output:** Concrete recommendations based on observed patterns

### 4. S3 Access Logs / CloudTrail (Available but impractical)
**Source:** Log files of every S3 request
- **What it tells us:** Every single object access with timestamp
- **Blocker:** Must process millions of log entries over 90 days
- **Cost:** High (storage + processing time)
- **Verdict:** Not suitable for bulk analysis

## Recommended Two-Phase Approach

---

## Phase 1: Immediate Estimates from Current Distribution + Request Metrics

### Objective
Compute savings estimates using ACTUAL current storage distribution and request data.

### Data Collection (Extends existing evaluator)

1. **Current storage distribution** (already have from evaluator):
   ```
   For each bucket:
   - Current storage class
   - Size (GB)
   - Object count
   - Current cost
   ```

2. **Add request metrics** (2-3 bulk CloudWatch queries):
   ```bash
   # Get request metrics for all buckets in bulk
   aws cloudwatch list-metrics --namespace AWS/S3 --metric-name AllRequests
   aws cloudwatch get-metric-data \
     --start-time <30_days_ago> \
     --end-time <now> \
     --metric-data-queries [...]  # All buckets in one batch
   ```

3. **Compute actual access rate per bucket:**
   ```
   access_rate = total_requests_30d / 30 / object_count
   ```

### Savings Calculation Method

**For Standard Storage buckets:**

Given ACTUAL data:
- Current size: X GB @ $0.023/GB
- Object count: N objects
- Actual request rate: R requests/day/object

**Compute IT cost distribution:**

1. **Estimate tier distribution based on access rate:**
   - If R >= 0.1: 70% FA, 25% IA, 5% Archive (high activity)
   - If R >= 0.01: 50% FA, 35% IA, 15% Archive (moderate activity)
   - If R >= 0.001: 30% FA, 40% IA, 30% Archive (low activity)
   - If R < 0.001: 15% FA, 35% IA, 50% Archive (very low activity)

2. **Calculate IT costs:**
   ```
   FA_cost = (X * FA_pct) * $0.023
   IA_cost = (X * IA_pct) * $0.0125
   Archive_cost = (X * Archive_pct) * $0.004
   Monitoring_cost = N * $0.0025 / 1000

   Total_IT_cost = FA_cost + IA_cost + Archive_cost + Monitoring_cost
   Savings = Current_cost - Total_IT_cost
   ```

3. **Confidence level:**
   - High confidence if request metrics available
   - Medium confidence if no request metrics (use object count heuristics)

**For Standard-IA buckets:**
- Already optimized for infrequent access
- IT benefit only if significant portion cold >90 days
- Lower savings potential (0-20%)

**For existing IT buckets:**
- Check if Archive Access tiers enabled
- Recommend enabling if not

### Implementation Steps

1. **Extend evaluator or create companion script:**
   - Read existing CSV output from evaluator
   - Add bulk CloudWatch request metrics queries
   - Calculate access rates per bucket
   - Compute tier distribution estimates
   - Calculate actual IT costs
   - Output savings recommendations

2. **Output format:**
   ```markdown
   ## Bucket: svc-images-prod

   ### Current State (ACTUAL)
   - Storage class: Standard
   - Size: 1,765 GB
   - Objects: 3,500,000
   - Cost: $40.61/mo
   - Requests (30d): 8,500 total
   - Access rate: 0.00008 requests/day/object (VERY LOW)

   ### Intelligent Tiering Projection (BASED ON ACTUAL ACCESS RATE)
   - FA tier (15%): 265 GB @ $0.023 = $6.10
   - IA tier (35%): 618 GB @ $0.0125 = $7.72
   - Archive tier (50%): 882 GB @ $0.004 = $3.53
   - Monitoring: 3,500 objects × $0.0025/1000 = $8.75
   - **Total IT cost: $26.10/mo**

   ### Savings
   - **$14.51/mo (36% reduction)**
   - Confidence: HIGH (based on actual request metrics)

   ### Action
   ```bash
   aws s3api put-bucket-intelligent-tiering-configuration \
     --bucket svc-images-prod \
     --id default-config \
     --intelligent-tiering-configuration file://it-config.json
   ```
   ```

### Timeline
- **Implementation:** 3-4 hours
- **Results:** Immediate (based on last 30 days of actual request data)
- **API calls:** 2-3 bulk queries (list-metrics + get-metric-data)

---

## Phase 2: Validated Estimates from Storage Class Analysis

### Objective
For high-cost buckets (>$10/mo), get AWS's observed access pattern analysis to validate and refine estimates.

### Setup Process

1. **Enable Storage Class Analysis on top 5-10 buckets:**
   ```bash
   for bucket in $(cat high_cost_buckets.txt); do
     aws s3api put-bucket-analytics-configuration \
       --bucket "$bucket" \
       --id storage-analysis \
       --analytics-configuration '{
         "Id": "storage-analysis",
         "StorageClassAnalysis": {
           "DataExport": {
             "OutputSchemaVersion": "V_1",
             "Destination": {
               "S3BucketDestination": {
                 "Format": "CSV",
                 "Bucket": "arn:aws:s3:::analysis-results-bucket",
                 "Prefix": "storage-analysis/"
               }
             }
           }
         }
       }'
   done
   ```

2. **Wait 30 days** for AWS to observe and analyze access patterns

3. **Parse analysis results:**
   - AWS generates CSV files with ACTUAL observed data:
     - Object count by age group (0-30d, 30-89d, 90-179d, 180+ days)
     - Access frequency by age group
     - Storage size by age group
   - Use this to compute PRECISE tier distributions

### Analysis Result Usage

**Example CSV data from AWS:**
```
age_group,object_count,total_size_gb,pct_accessed_30d
0-29_days,500000,400,85%
30-89_days,800000,600,35%
90-179_days,1200000,500,12%
180+_days,1000000,265,3%
```

**Compute actual IT distribution:**
```
Objects accessed recently (85%, 35%) → FA tier
Objects rarely accessed (12%, 3%) → IA/Archive tiers

Actual distribution:
- FA tier: ~520 GB (objects with >30% access rate)
- IA tier: ~680 GB (objects with 5-30% access rate)
- Archive tier: ~565 GB (objects with <5% access rate)

Actual IT cost: $520*0.023 + $680*0.0125 + $565*0.004 + monitoring
             = $11.96 + $8.50 + $2.26 + $8.75
             = $31.47/mo

Actual savings: $40.61 - $31.47 = $9.14/mo (22%)
```

### Timeline
- **Setup:** 1 hour (for top 10 buckets)
- **Wait:** 30 days
- **Analysis:** 2 hours (parse CSVs, compute refined estimates)

---

## Implementation Priority

### Week 1: Phase 1 Implementation
**Deliverable:** Optimizer with actual request-based estimates

Script: `getS3BucketExpenseOptimizer.sh`
- Input: CSV from evaluator
- Add: CloudWatch request metrics (bulk query)
- Compute: Access rates per bucket
- Output: Savings estimates with confidence levels

**Success criteria:**
- Uses ACTUAL request data (not heuristics)
- Provides per-bucket access rates
- Computes tier distributions based on observed activity
- Shows confidence levels

### Month 2: Phase 2 Setup
**Deliverable:** Storage Class Analysis enabled on high-cost buckets

- Identify buckets >$10/mo
- Enable analytics configuration
- Document analysis retrieval process
- Wait 30 days

### Month 3: Phase 2 Analysis
**Deliverable:** Refined estimates from AWS observed data

- Parse AWS analysis CSVs
- Compare Phase 1 estimates vs Phase 2 actual
- Refine Phase 1 algorithm based on findings
- Update recommendations

---

## Data Flow

```
┌─────────────────────────────────────┐
│ getS3BucketExpenseEvaluator.sh      │
│ (existing)                           │
│                                      │
│ Output:                              │
│ - Bucket storage by class            │
│ - Object counts                      │
│ - Current costs                      │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│ getS3BucketExpenseOptimizer.sh      │
│ (new - Phase 1)                      │
│                                      │
│ Additional data:                     │
│ - CloudWatch request metrics (bulk)  │
│                                      │
│ Compute:                             │
│ - Access rate per bucket             │
│ - Tier distribution estimates        │
│ - IT cost projections                │
│ - Savings with confidence            │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│ Markdown report with:                │
│ - Actual access rates                │
│ - Estimated tier distributions       │
│ - Projected savings                  │
│ - Confidence levels                  │
│ - Implementation commands            │
└─────────────────────────────────────┘
```

---

## Success Metrics

### Phase 1
- ✅ Uses actual CloudWatch request data
- ✅ Computes real access rates (requests/day/object)
- ✅ Tier distribution based on observed activity
- ✅ 2-3 bulk API calls total
- ✅ Results in < 10 seconds
- ✅ Confidence levels shown

### Phase 2
- ✅ AWS observed access patterns (not estimates)
- ✅ Validates Phase 1 methodology
- ✅ Refines tier distribution algorithm
- ✅ Provides most accurate savings projections

---

## Example Output (Phase 1)

```markdown
# S3 Intelligent Tiering Savings Analysis
Generated: 2025-11-09
Account: use.ehmpathy.dev

## Summary
Total buckets analyzed: 47
Buckets >$1/mo: 12
Total current cost: $235.18/mo
Projected IT cost: $178.32/mo
**Potential savings: $56.86/mo (24%)**

---

## High-Priority Recommendations

### 1. svc-images-prod ⭐
**Current (ACTUAL):**
- Storage: 1,765 GB Standard
- Objects: 3,500,000
- Cost: $40.61/mo
- **Requests (30d): 8,500 total**
- **Access rate: 0.00008 req/day/obj** (VERY LOW)

**Intelligent Tiering Projection (BASED ON ACTUAL ACCESS):**
- Frequent Access (15%): 265 GB @ $0.023 = $6.10
- Infrequent Access (35%): 618 GB @ $0.0125 = $7.72
- Archive Access (50%): 882 GB @ $0.004 = $3.53
- Monitoring: 3,500k × $0.0025/1k = $8.75
- **Projected IT cost: $26.10/mo**

**Savings: $14.51/mo (36%)**
**Confidence: HIGH** (based on 30 days actual request metrics)

**Action:**
```bash
aws s3api put-bucket-intelligent-tiering-configuration \
  --bucket svc-images-prod \
  --id default-config \
  --intelligent-tiering-configuration file://configs/it-config.json
```

---

### 2. data-lake-archive
**Current (ACTUAL):**
- Storage: 4,200 GB Standard
- Objects: 1,200,000
- Cost: $96.60/mo
- **Requests (30d): 2,340 total**
- **Access rate: 0.000065 req/day/obj** (VERY LOW)

**Intelligent Tiering Projection:**
- FA (10%): 420 GB = $9.66
- IA (30%): 1,260 GB = $15.75
- Archive (60%): 2,520 GB = $10.08
- Monitoring: $3.00
- **Projected IT cost: $38.49/mo**

**Savings: $58.11/mo (60%)**
**Confidence: HIGH**

... (more buckets)
```

---

## Next Steps

1. **Implement Phase 1 script** (3-4 hours)
   - Extend evaluator with request metrics
   - Build tier distribution calculator
   - Generate reports with actual access data

2. **Review first report**
   - Validate access rates make sense
   - Check tier distributions
   - Prioritize by net savings

3. **Enable IT on top 3-5 buckets**
   - Start with highest confidence + highest savings
   - Monitor for 30-60 days
   - Compare actual vs projected costs

4. **Setup Phase 2 for validation** (optional)
   - Enable Storage Class Analysis on top buckets
   - Wait 30 days
   - Use to validate and refine Phase 1 algorithm
