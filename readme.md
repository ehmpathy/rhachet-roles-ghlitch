# rhachet-skills-ghlitch

rhachet skills and briefs to observe, monitor, alarm, and diagnose systems

## Skills

### Monitor

#### `monitor/queryApis/detectLambdaCrontasks.ts`
Detect AWS Lambda functions with EventBridge cron task triggers.
- Enumerates all Lambda functions in the account
- Checks EventBridge rules for schedule expressions
- Identifies which Lambdas are triggered by cron schedules
- Outputs detailed reports per function

**Usage:**
```bash
npx tsx src/skills/monitor/queryApis/detectLambdaCrontasks.ts
```

#### `monitor/queryApis/reportPostgresServerlessUsage.ts`
Report Aurora Serverless PostgreSQL ACU capacity usage from CloudWatch.
- Identifies Aurora Serverless v2 clusters
- Fetches comprehensive CloudWatch metrics (ACU, CPU, connections, IOPS, latency)
- Calculates hourly and overall statistics
- Generates visual histogram and utilization summaries

**Usage:**
```bash
npx tsx src/skills/monitor/queryApis/reportPostgresServerlessUsage.ts
```

#### `monitor/queryApis/verifyPostgresServerlessScalesToZero.ts`
Verify Aurora Serverless PostgreSQL clusters can and do scale to zero.
- Checks MinCapacity is set to 0 (blocker)
- Verifies SecondsUntilAutoPause is 300s (nitpick)
- Confirms cluster scaled to zero in past week (blocker)
- Confirms cluster scaled to zero in past 24 hours (nitpick)
- Throws error if any blocker issues found

**Usage:**
```bash
npx tsx src/skills/monitor/queryApis/verifyPostgresServerlessScalesToZero.ts
```

### Observe

#### `observe/setPostgresClusterAsObservable.sh`
Enable observability features on Aurora PostgreSQL cluster.
- Configures CloudWatch Logs export (postgresql, upgrade logs)
- Enables Performance Insights for query monitoring
- Sets retention period for Performance Insights data

**Usage:**
```bash
./src/skills/observe/setPostgresClusterAsObservable.sh <db-cluster-identifier>
```

## Development

All TypeScript skills follow the mechanic coding patterns:
- Arrow functions with `(input, context)` signatures
- Domain-driven design with `domain-objects`
- Fail-fast error handling
- Idempotent operations
- Comprehensive inline documentation

See `.briefs/mechanic/` for detailed coding standards.
