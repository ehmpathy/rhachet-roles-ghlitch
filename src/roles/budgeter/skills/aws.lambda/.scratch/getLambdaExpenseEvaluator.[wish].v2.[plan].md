# Lambda Expense Evaluator - Implementation Plan

## Overview
Build a comprehensive Lambda cost analyzer that identifies all Lambda functions, calculates their actual costs, and provides optimization recommendations for functions costing over $1/month.

## Phase 1: Lambda Discovery & Configuration Enumeration

### 1.1 Enumerate All Lambda Functions
**Goal**: Get complete list of Lambda functions with their configurations in one API call

**Implementation**:
```bash
aws lambda list-functions --max-items 1000 --output json
```

**Data to Extract**:
- Function name
- Memory size (MB)
- Timeout configuration
- Runtime
- Architecture (x86_64 vs arm64)
- Last modified date

**Why This Approach**:
- Single API call gets all configuration data
- Memory size is available directly (no need to compute from CloudWatch first)
- Architecture type affects pricing (ARM is 20% cheaper)

**Pricing Constants** (us-east-1):
- x86_64: $0.0000166667 per GB-second
- arm64: $0.0000133334 per GB-second
- First 1M requests free, then $0.20 per 1M requests

## Phase 2: Bulk CloudWatch Metrics Query

**Key Optimization**: Instead of querying CloudWatch metrics individually for each Lambda function (N queries), use bulk SEARCH expressions to get all metrics in 2 queries total.

**Data Flow**:
1. Query CloudWatch → Get invocations for ALL functions → Table 1: `{function_name: invocations}`
2. Query CloudWatch → Get durations for ALL functions → Table 2: `{function_name: avg_duration}`
3. Join Table 1 + Table 2 + Configuration Data → Calculate costs → Enriched function data

### 2.1 Get Metrics for ALL Lambda Functions in One Query
**Goal**: Query CloudWatch once to get invocations and duration for all Lambda functions

**Key Innovation**: Use CloudWatch `get-metric-data` API with `SEARCH()` expressions to retrieve metrics for all functions in 1-2 API calls instead of N calls (one per function).

**Implementation - Get All Invocations**:
```bash
# Create metric query JSON for all Lambda invocations
aws cloudwatch get-metric-data \
  --metric-data-queries '[
    {
      "Id": "m1",
      "Expression": "SEARCH('\''{AWS/Lambda} MetricName=\"Invocations\"'\'', '\''Sum'\'', 2592000)"
    }
  ]' \
  --start-time $(date -u -d '30 days ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --output json
```

**Implementation - Get All Durations**:
```bash
# Create metric query JSON for all Lambda durations (average)
aws cloudwatch get-metric-data \
  --metric-data-queries '[
    {
      "Id": "m2",
      "Expression": "SEARCH('\''{AWS/Lambda,FunctionName} MetricName=\"Duration\"'\'', '\''Average'\'', 2592000)"
    }
  ]' \
  --start-time $(date -u -d '30 days ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --output json
```

**Output Format**: Each query returns an array of results with:
```json
{
  "MetricDataResults": [
    {
      "Id": "m1_function_name",
      "Label": "Invocations FunctionName",
      "Timestamps": [...],
      "Values": [...],
      "StatusCode": "Complete"
    }
  ]
}
```

**Data Processing**:
1. Parse the results to extract function names from labels
2. Sum the values for invocations (total for period)
3. Average the values for duration (mean duration)
4. Create lookup tables: `function_name -> invocations` and `function_name -> avg_duration`

**Benefits**:
- 2 API calls instead of N × 2 (where N = number of functions)
- Much faster for accounts with many Lambda functions
- Lower cost (fewer CloudWatch API calls)
- Avoids rate limiting issues

### 2.2 Join Configuration with Metrics and Calculate Cost
**Goal**: Combine Lambda configuration data with CloudWatch metrics to calculate actual cost

**Data Join**:
For each function from Phase 1:
1. Look up `invocations` from invocations table
2. Look up `avg_duration_ms` from duration table
3. Get `memory_mb` and `architecture` from function configuration

**Compute Cost Formula**:
```
GB-seconds = (Memory_MB / 1024) * (Avg_Duration_ms / 1000) * Invocation_Count
GB-second_rate = (architecture == "arm64") ? 0.0000133334 : 0.0000166667
Compute_Cost = GB-seconds * GB-second_rate
```

**Request Cost Formula**:
```
Request_Cost = max(0, (Invocation_Count - 1000000) * 0.0000002)
```

**Total Monthly Cost**:
```
Total_Monthly_Cost = Compute_Cost + Request_Cost
```

**Output**: Enriched function data structure:
```json
{
  "function_name": "my-function",
  "memory_mb": 512,
  "architecture": "x86_64",
  "runtime": "python3.11",
  "invocations": 5000000,
  "avg_duration_ms": 250,
  "compute_cost": 10.42,
  "request_cost": 0.80,
  "total_cost": 11.22
}
```

**Filter for Analysis**:
After calculating costs for all functions, filter to only analyze functions where `total_cost > $1.00` (or configurable threshold). This gives us the subset of functions worth optimizing in Phase 3.

### 2.3 Get Actual Cost from Cost Explorer
**Alternative/Validation**: Use AWS Cost Explorer API to get actual billed costs

```bash
aws ce get-cost-and-usage \
  --time-period Start=$(date -d '30 days ago' +%Y-%m-%d),End=$(date +%Y-%m-%d) \
  --granularity MONTHLY \
  --metrics BlendedCost \
  --filter file://lambda-filter.json \
  --group-by Type=DIMENSION,Key=RESOURCE_ID
```

**Benefits**:
- Gets exact billed amount
- Includes any additional charges
- Can validate calculated costs

## Phase 3: Optimization Analysis

### 3.1 Memory Rightsizing Opportunity
**Goal**: Identify over-provisioned memory

**Approach**:
- Get Lambda Insights metrics (if enabled) for actual memory usage
- Compare `MaxMemoryUsed` vs `MemorySize`
- Calculate memory utilization percentage

**Recommendation Logic**:
```
If memory_utilization < 60%:
  recommended_memory = next_power_of_64(max_memory_used * 1.2)  # 20% buffer
  potential_savings = current_cost * (1 - recommended_memory/current_memory)
```

**Important Note**: Reducing memory also reduces CPU, which may increase duration
- Need to consider duration increase when calculating savings
- Conservative approach: assume duration inversely proportional to memory

### 3.2 Architecture Change (x86 → ARM)
**Goal**: Switch to ARM (Graviton2) for 20% cost reduction

**Conditions**:
- Runtime supports ARM64
- Supported runtimes: Python 3.8+, Node.js 12+, Java 11+, .NET 6, Ruby 2.7+, Custom Runtime
- No x86-specific dependencies

**Recommendation Logic**:
```
If current_architecture == "x86_64" AND runtime_supports_arm:
  potential_savings = current_cost * 0.20
```

### 3.3 Duration Optimization
**Goal**: Identify functions with high average duration

**Analysis**:
- Calculate p50, p90, p99 durations from CloudWatch
- Identify outliers (p99 >> p50 indicates issues)
- Flag cold start issues (high initial duration)

**Recommendations**:
- If high cold starts: Consider provisioned concurrency for critical functions
- If consistently high duration: Flag for code optimization review
- Provide "time is money" metric: cost per millisecond saved

### 3.4 Utilization Patterns
**Goal**: Identify rarely-used expensive functions

**Analysis**:
- Calculate invocations per day
- Identify functions with:
  - High cost
  - Low invocation count
  - High per-invocation cost

**Recommendations**:
- Consider alternative architectures (ECS Fargate, Step Functions)
- Evaluate if function is still needed

## Phase 4: Output & Reporting

### 4.1 Summary Report Structure

```markdown
# Lambda Cost Analysis Report
Generated: YYYY-MM-DD

## Executive Summary
- Total Lambda Functions Analyzed: X
- Total Monthly Lambda Cost: $X.XX
- Total Potential Savings: $X.XX (X%)
- Functions Over $1/month: X

## Cost Breakdown (Top 20)
| Function Name | Monthly Cost | Invocations | Avg Duration | Memory |
|---------------|--------------|-------------|--------------|--------|
| func-1        | $XXX.XX      | XXX,XXX     | XXX ms       | XXX MB |

## Top Optimization Opportunities
1. **Function Name** - $XX.XX potential savings
   - Current: XXX MB memory, x86_64
   - Recommendation: Reduce to XXX MB, switch to ARM64
   - Estimated savings: $XX.XX/month (XX%)

## Detailed Analysis by Function
[For each function over $1/month]
```

### 4.2 Output Files

**Primary Output**: `getLambdaExpenseEvaluator/{account_id}/{timestamp}/`
- `functions.json` - Raw function data with costs
- `analysis.json` - Structured analysis data
- `recommendations.md` - Human-readable recommendations
- `summary.md` - Executive summary

## Implementation Steps

### Step 1: Core Data Collection Script
Create `getLambdaExpenseEvaluator.sh` with functions:
- `enumerate_lambdas()` - List all Lambda functions, output to JSON
- `get_all_invocations()` - Bulk query CloudWatch for all Lambda invocations
- `get_all_durations()` - Bulk query CloudWatch for all Lambda durations
- `join_and_calculate_costs()` - Join configuration + metrics tables, calculate costs
- `filter_by_threshold()` - Filter for functions > $1/month (or configurable threshold)
- `get_cost_explorer_data()` - Optional: Validate with Cost Explorer

### Step 2: Analysis Engine
Create analysis logic:
- `analyze_memory_opportunity()`
- `analyze_architecture_opportunity()`
- `analyze_duration_opportunity()`
- `analyze_utilization_pattern()`

### Step 3: Report Generation
Create report generators:
- `generate_summary()`
- `generate_detailed_report()`
- `generate_recommendations()`

### Step 4: Integration
- Add error handling
- Add progress indicators
- Add caching for CloudWatch data (it's expensive to query repeatedly)
- Add dry-run mode

## Technical Considerations

### Rate Limiting
- Lambda API: 100 TPS
- CloudWatch: 5 TPS per region
- Cost Explorer: 1 request per second
- **Solution**: Add exponential backoff, batch requests

### Cost of Analysis
- CloudWatch API calls cost money
- Cost Explorer API calls cost $0.01 each
- **Mitigation**: Cache results, provide cost estimate before running

### Accuracy
- CloudWatch metrics have 1-minute granularity
- Cost Explorer data has 24-hour delay
- **Solution**: Use both for validation, note data freshness

### Handling Large Accounts
- Accounts may have 100+ Lambda functions
- **Solution**: Parallel processing with `xargs` or GNU parallel

## Pricing Reference

### Lambda Pricing (us-east-1)
- **Requests**: $0.20 per 1M requests (after free tier)
- **Duration (x86_64)**: $0.0000166667 per GB-second
- **Duration (arm64)**: $0.0000133334 per GB-second
- **Free Tier**: 1M requests and 400,000 GB-seconds per month

### Memory/CPU Relationship
Lambda allocates CPU proportional to memory:
- 128 MB = 0.083 vCPU
- 1,769 MB = 1 vCPU
- 3,538 MB = 2 vCPU
- etc.

## Next Steps

1. Review this plan
2. Validate pricing formulas and CloudWatch SEARCH query syntax
3. Implement Phase 1: Lambda enumeration
4. Implement Phase 2: Bulk CloudWatch queries and cost calculation
   - Test the SEARCH expressions return correct data format
   - Validate the join logic works correctly
5. Add Phase 3: Optimization analysis
6. Build Phase 4: Reporting
7. Test with real AWS account data
8. Test across multiple AWS accounts
9. Document usage and examples

## Efficiency Gains

**Old Approach**:
- For 100 Lambda functions: 200+ API calls (2 per function minimum)
- High rate limiting risk
- Slow execution time

**New Approach**:
- For 100 Lambda functions: 3 API calls total
  - 1 call to list functions
  - 1 call to get all invocations
  - 1 call to get all durations
- Minimal rate limiting risk
- Fast execution time
- Lower CloudWatch API costs
