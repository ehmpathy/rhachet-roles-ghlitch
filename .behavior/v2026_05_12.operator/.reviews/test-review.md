🦉 needs your talons
   ├─ logs: .log/bhrain/review/2026-06-16T13-40-08-017Z
   ├─ review: .behavior/v2026_05_12.operator/.reviews/test-review.md
   └─ summary
      ├─ 2 blockers 🔴
      └─ 1 nitpicks 🟠

---
# blocker.1: Absent integration test coverage for communicator operations

**rule**: .agent/repo=ehmpathy/role=mechanic/briefs/practices/code.test/scope.coverage/rule.require.test-coverage-by-grain.md

**locations**:
- .behavior/v2026_05_12.operator/5.3.verification.yield.md

The rule states that communicators require integration tests (blocker if absent) to verify i/o, auth, connections and responses. Examples include query.* and invoke.* operations. In the target, these are listed with implementation ✓ but test coverage only '✓ role loads with skills'. However, the executed tests show integration suite skipped with '0 test files (no integration tests yet)'. Unit tests for role configs (e.g. getObserverRole.test.ts) do not substitute for integration tests on these I/O shell skills. Per enforcement table, absent integration for communicators is a blocker.

**snippet**:
```markdown
| integration | `rhx git.repo.test --what integration --mode apply --thorough` | skipped | 0 test files (no integration tests yet) |
```

---

# blocker.2: Absent snapshot coverage for contract outputs

**rule**: .agent/repo=ehmpathy/role=mechanic/briefs/practices/code.test/scope.coverage/rule.require.test-coverage-by-grain.md

**locations**:
- .behavior/v2026_05_12.operator/5.3.verification.yield.md

The rule requires contracts to have acceptance tests + snapshots (blocker if absent) for visual diff and regression detection on outputs facing humans/consumers (e.g. CLIs, SDKs, APIs). The target explicitly defers snapshot coverage for 'all shell skills' (calling them 'contract outputs' and 'skill help output snapshots') with rationale requiring live AWS, and states 'no `.snap` files changed — unit tests verify role config, not output snapshots.'. No acceptance tests are mentioned for any contract. This violates the contract grain requirements per the enforcement table.

**snippet**:
```markdown
skill help output snapshots deferred to tech debt — shell skills require rhx integration tests with live AWS:

| contract | status | rationale |
|----------|--------|-----------|
| all shell skills | deferred | require live AWS for rhx execution |
```

---

# nitpick.1: Absent integration test coverage for orchestrator operations

**rule**: .agent/repo=ehmpathy/role=mechanic/briefs/practices/code.test/scope.coverage/rule.require.test-coverage-by-grain.md

**locations**:
- .behavior/v2026_05_12.operator/5.3.verification.yield.md

The rule states that orchestrators require integration tests (nitpick if absent) to verify composition, workflows and side effects. Operations such as deploy, provision.database, provision.terraform, use.rds.capacity, use.vpc.tunnel are listed as promoted to deployer/supporter. The target marks their 'test coverage' only as '✓ role loads with skills' from unit tests and reports the integration suite as skipped with 0 test files. This does not meet the per-grain requirement for orchestrators.

**snippet**:
```markdown
| deploy promoted to deployer | ✓ deploy.sh | ✓ role loads with skills | ✓ |
| aws.cloudformation.status promoted to deployer | ✓ aws.cloudformation.status.sh | ✓ role loads with skills | ✓ |
| aws.cloudformation.rollback promoted to deployer | ✓ aws.cloudformation.rollback.sh | ✓ role loads with skills | ✓ |
| provision.database promoted to deployer | ✓ provision.database.sh | ✓ role loads with skills | ✓ |
| provision.terraform promoted to deployer | ✓ provision.terraform.sh | ✓ role loads with skills | ✓ |
```
