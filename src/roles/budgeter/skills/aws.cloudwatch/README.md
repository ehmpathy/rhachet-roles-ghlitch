# AWS CloudWatch Skills

Skills for managing AWS CloudWatch log groups and retention policies.

## Skills

### getIngestionExpenses

Analyze CloudWatch Logs ingestion expenses to identify the most expensive log groups by data volume.

**Usage:**

```bash
# Analyze last 30 days (default)
./getIngestionExpenses.sh

# Analyze last 7 days
./getIngestionExpenses.sh --days=7

# Or use TypeScript directly
npx tsx src/contract/commands/getIngestionExpenses.ts --days=30
```

**Parameters:**

- `--days`: Number of days to look back for ingestion data - default: `30`

**Output:**

The command generates two reports:

1. **ingestion-expenses.json** - Full data in JSON format
2. **ingestion-expenses.md** - Formatted markdown report with:
   - Summary of total data ingested and costs
   - Table of all log groups sorted by ingestion cost (highest to lowest)
   - Columns: Log Group Name, Data Ingested (GB), Log Events, Ingestion Cost, % of Total

**Example Output:**

```
Ingestion Summary:
   - Log groups with ingestion: 45
   - Total data ingested: 66.23 GB
   - Total log events: 1,234,567
   - Total cost: $33.12

Top 5 most expensive log groups:
   1. /aws/lambda/high-volume-function: 15.32 GB ($7.66)
   2. /aws/lambda/api-gateway-logs: 12.45 GB ($6.23)
   3. /aws/ecs/my-service: 8.91 GB ($4.46)
   ...
```

**Pricing:**

- Ingestion: $0.50 per GB ingested

### setRetentionPolicies

Set retention policies for CloudWatch log groups to manage log retention and control costs.

**Usage:**

```bash
# Preview retention policy changes (prep mode)
./setRetentionPolicies.sh --mode=prep --days=90

# Apply retention policies (exec mode)
./setRetentionPolicies.sh --mode=exec --days=90

# Or use TypeScript directly
npx tsx src/contract/commands/setRetentionPolicies.ts --mode=prep --days=90
```

**Modes:**

- `prep`: Preview mode - enumerates all log groups, shows current retention policies, and displays planned changes
- `exec`: Execution mode - applies the retention policies to log groups that need changes

**Parameters:**

- `--mode`: Operation mode (`prep` or `exec`) - default: `prep`
- `--days`: Desired retention period in days - default: `90`

**Behavior:**

When in `prep` mode:
1. Enumerates all CloudWatch log groups in the account/region
2. Shows the current retention policy for each log group
3. Calculates the diff after applying the desired retention policy
4. Outputs a report showing which log groups would be changed
5. Writes a JSON report to `.rhachet/setRetentionPolicies/retention-policies.json`

When in `exec` mode:
1. Enumerates all CloudWatch log groups in the account/region
2. Identifies log groups where `retentionRealized` differs from `retentionDesired`
3. Applies the retention policy only to log groups that need changes
4. Reports success/failure for each log group

**Example Output:**

```
setting retention policies...
mode: prep
desired retention: 90 days
step 1: getting AWS account info...
step 2: enumerating CloudWatch log groups...
step 3: calculating retention policy changes...

Current State:
   - Total log groups: 25
   - Changes needed: 12

Retention Policy Report:

[CHANGE] /aws/lambda/my-function
       current: Never Expire -> 90 days
[OK] /aws/lambda/other-function
       current: 90 days

Run with --mode=exec to apply the retention policies
```

## Architecture

The implementation follows domain-driven design principles with clear separation of concerns:

### Domain Objects

Located in `domain/objects/`:

- `AwsAccount`: Represents AWS account information
- `CloudWatchLogGroup`: Represents a CloudWatch log group with its retention policy
- `RetentionPolicyChange`: Represents the diff between current and desired retention

### Domain Operations

Located in `domain/operations/`:

- `execAws`: Execute AWS CLI commands with logging
- `getAwsAccountInfo`: Get AWS account ID and alias
- `listLogGroups`: List all CloudWatch log groups (handles pagination)
- `calculateRetentionPolicyChanges`: Calculate which log groups need policy updates
- `applyRetentionPolicy`: Apply retention policy to a specific log group

### Commands

Located in `src/contract/commands/`:

- `setRetentionPolicies`: Main command that orchestrates the retention policy management

## Dependencies

- `@ehmpathy/as-command`: Command framework
- `domain-objects`: Domain object utilities
- `as-procedure`: Procedure logging
- `simple-leveled-log-methods`: Logging utilities
- AWS CLI configured with appropriate credentials
