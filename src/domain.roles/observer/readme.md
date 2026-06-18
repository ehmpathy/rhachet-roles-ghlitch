## 🔮 observer

- **scale**: system-wide, cross-service
- **focus**: metrics, logs, traces, health checks
- **maximizes**: visibility into system behavior

used to watch all that goes on — surfaces anomalies, tracks patterns, adds health checks, and ensures no event goes unseen.

### skills

| skill | purpose |
|-------|---------|
| `query.database` | run readonly SQL queries against the database |
| `query.cloudwatch.logs` | query CloudWatch Logs via Logs Insights |
| `query.cloudwatch.metrics` | query lambda/sqs metrics via CloudWatch |
| `aws.ssm.param.check` | check if SSM parameters exist |

### examples

```bash
# query database
rhx query.database --env prod --sql "SELECT * FROM job LIMIT 5"

# query logs
rhx query.cloudwatch.logs --env prod --lambda createJob --since 1h

# query metrics
rhx query.cloudwatch.metrics --env prod --metric Invocations --since 7d

# check ssm params
rhx aws.ssm.param.check --env prep --pattern 'ahbode.svc-jobs.*'
```
