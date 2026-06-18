## 🦺 operator

- **scale**: system-wide, cross-service
- **focus**: operational support, database tunnels, command execution
- **maximizes**: safe, reliable operational access

used for operational support — provides secure database access, runs registered commands and vitals, and maintains operational tunnels.

### skills

| skill | purpose |
|-------|---------|
| `invoke.command` | run registered commands against environments |
| `invoke.vital` | run vital signs checks against environments |
| `use.rds.capacity` | manage RDS capacity for database scale operations |
| `use.testdb` | connect to test database for local development |
| `use.vpc.tunnel` | establish VPC tunnel for secure database access |

### examples

```bash
# run a registered command
rhx invoke.command --env prod --cmd "status"

# check vital signs
rhx invoke.vital --env prod

# scale rds capacity
rhx use.rds.capacity --env prod --action scale-up

# connect to test db
rhx use.testdb

# establish vpc tunnel
rhx use.vpc.tunnel --env prod
```
