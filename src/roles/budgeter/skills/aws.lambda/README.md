# Lambda Expense Evaluator

evaluate Lambda expenses by analyzing invocations, duration, and costs

## Usage

```bash
# run with default settings (30 days lookback)
npx tsx src/roles/budgeter/skills/aws.lambda/getLambdaExpenseEvaluator.ts

# run with custom lookback period
npx tsx src/roles/budgeter/skills/aws.lambda/getLambdaExpenseEvaluator.ts --days 7
```

Output files are automatically written to `.rhachet/getLambdaExpenseEvaluator/` with timestamped directories.

## Architecture

Follows domain-driven design patterns using `domain-objects` package.

### Domain Objects (`domain/objects/`)

All domain objects use `DomainLiteral` pattern with proper interface/class separation:

- `AwsAccount.ts` - AWS account information
- `LambdaFunction.ts` - Lambda function configuration
- `LambdaMetrics.ts` - CloudWatch metrics for a Lambda function
- `LambdaCost.ts` - Cost breakdown for a Lambda function
- `LambdaExpense.ts` - Complete expense analysis for a Lambda function
- `LambdaExpenseEvaluation.ts` - Full evaluation report with nested domain objects

### Domain Operations (`domain/operations/`)

- `execAws.ts` - Execute AWS CLI commands with logging
- `getAwsAccountInfo.ts` - Get AWS account ID and alias
- `listLambdaFunctions.ts` - List all Lambda functions
- `getCloudWatchMetrics.ts` - Fetch CloudWatch metrics in bulk
- `getCostExplorerData.ts` - Get Lambda costs from Cost Explorer
- `calculateLambdaCost.ts` - Calculate Lambda costs using pricing formulas
- `queryLambdaMemoryUsage.ts` - Query CloudWatch Logs for memory usage

## Features

- Analyzes Lambda function expenses across your AWS account
- Fetches invocation, duration, and error metrics from CloudWatch
- Calculates costs using AWS Lambda pricing (with arm64 support)
- Queries actual memory usage from CloudWatch Logs for functions costing >$1/month (with daily caching)
- Compares calculated costs with actual costs from AWS Cost Explorer
- Generates JSON and Markdown reports
- Filters to functions with >1 minute total duration to reduce noise
- Uses bulk CloudWatch queries for efficiency
- Parallel processing with configurable concurrency
- Automatic output directory management via `@ehmpathy/as-command`
- Fail-fast error handling with proper input validation

## Output

The command generates:
- `expenses.json` - Complete evaluation data in JSON format
- `expenses.md` - Human-readable Markdown report with tables

## AWS Permissions Required

- `lambda:ListFunctions`
- `cloudwatch:GetMetricData`
- `ce:GetCostAndUsage`
- `logs:DescribeLogGroups`
- `logs:StartQuery`
- `logs:GetQueryResults`
- `sts:GetCallerIdentity`
- `iam:ListAccountAliases`
