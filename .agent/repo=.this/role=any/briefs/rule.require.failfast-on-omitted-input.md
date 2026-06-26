# rule.require.failfast-on-omitted-input

## severity: blocker

whenever a required input is omitted, fail fast with a helpful, actionable message. never proceed with an absent input.

---
---
---

# deets

## .what

every required input — cli arg, env var, config value, stdin — must be validated at the boundary. if it is absent, halt immediately with a clear message that names the absent input and how to supply it.

## .why

absent inputs that slip past the boundary cause defects far downstream:
- the failure surfaces in an unrelated place, opaque to the caller
- the caller cannot tell whether they made the mistake or the tool did
- debug time balloons because the cause is distant from the symptom

fail-fast at the boundary turns a cryptic downstream crash into a one-line, actionable error.

## severity: blocker

an omitted input that flows through silently can cause:
- opaque downstream errors (cryptic stack traces, wrong targets)
- accidental action against the wrong resource
- hours of debug time, far from the cause

## .where

- all skills, at the point each required input is read
- cli args, env vars, config values, stdin
- any boundary where input crosses into the skill

## .how

validate each required input immediately after the read. exit 2 (constraint = caller must fix) with a message that names the absent input and the fix:

```bash
if [[ -z "$ENV" ]]; then
  echo "🐈 belay that..." >&2
  echo "   ├─ absent required arg: --env" >&2
  echo "   └─ hint: rhx use.rds.capacity help" >&2
  exit 2
fi
```

a helpful failfast message states:
- which input is absent
- where it should come from (arg, env var, config path)
- how to supply it (a command or file to edit)

## .examples

### positive

```bash
# named arg validated at boundary, helpful exit
[[ -z "$CLUSTER" ]] && { echo "absent: cluster (set config/$ENV.json)" >&2; exit 2; }
```

### negative

```bash
# proceeds with an absent input, fails opaquely later
psql -h "$DB_HOST" -p "$DB_PORT"   # $DB_HOST was never validated
```

## .enforcement

- required input used without an absent-check = blocker
- failfast without an actionable hint = nitpick

## .see also

- rule.forbid.config-defaults
- rule.forbid.fallbacks
- rule.forbid.failhide-in-shell
- rule.require.exit-code-semantics
