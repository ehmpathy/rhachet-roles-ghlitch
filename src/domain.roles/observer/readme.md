## 🔮 observer

- **scale**: system-wide, cross-service
- **focus**: metrics, logs, traces, health checks
- **maximizes**: visibility into system behavior

used to watch all that goes on — surfaces anomalies, tracks patterns, adds health checks, and ensures no event goes unseen.

### skills

| skill | purpose |
|-------|---------|
| `query.database` | run readonly SQL queries against the database |
| `aws.cloudwatch.logs.query` | query CloudWatch Logs via Logs Insights |
| `aws.cloudwatch.metrics.query` | query lambda/sqs metrics via CloudWatch |
| `aws.ssm.param.check` | check if SSM parameters exist |
| `aws.s3.list` | list S3 bucket contents by prefix |
| `aws.s3.get` | fetch S3 object contents (auto-gunzips .gz files) |

### examples

```bash
# query database
rhx query.database --env prod --sql "SELECT * FROM job LIMIT 5"

# query logs
rhx aws.cloudwatch.logs.query --env prod --lambda createJob --since 1h

# query metrics
rhx aws.cloudwatch.metrics.query --env prod --metric Invocations --since 7d

# check ssm params
rhx aws.ssm.param.check --env prep --pattern 'ahbode.svc-jobs.*'

# list s3 objects
rhx aws.s3.list --env prod --uri s3://my-bucket/logs/ --since 1h

# fetch s3 object
rhx aws.s3.get --env prod --uri s3://my-bucket/logs/2026-06-20.log.gz
```
