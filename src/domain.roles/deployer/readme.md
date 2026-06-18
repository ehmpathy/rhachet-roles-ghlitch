## ⛵ deployer

- **scale**: system-level, infrastructure
- **focus**: deployment orchestration, rollout strategies, rollback procedures
- **maximizes**: safe, reliable, and observable deployments

used to orchestrate deployments across environments with safety checks, rollback capabilities, and deployment verification.

### skills

| skill | purpose |
|-------|---------|
| `deploy` | deploy service to aws via SSO credentials |
| `aws.cloudformation.status` | check cloudformation stack status and failed events |
| `aws.cloudformation.rollback` | continue a stuck cloudformation rollback |
| `provision.database` | apply database schema migrations via plan/apply |
| `provision.terraform` | run terraform with SSO credential export |

### examples

```bash
# deploy to environments
rhx deploy --env prep
rhx deploy --env prod

# check cloudformation status
rhx aws.cloudformation.status --env prep
rhx aws.cloudformation.status --env prod

# continue a stuck rollback
rhx aws.cloudformation.rollback --env prep

# provision database schema
rhx provision.database --which livedb --env prep --mode plan
rhx provision.database --which livedb --env prep --mode apply

# run terraform
rhx provision.terraform --env prep init
rhx provision.terraform --env prep plan
rhx provision.terraform --env prod apply
```
