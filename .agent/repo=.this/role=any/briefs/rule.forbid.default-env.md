# rule.forbid.default-env

## severity: blocker

never default `--env` to any value. always require explicit environment selection.

---
---
---

# deets

## .what

skills that interact with aws or other environment-scoped resources must require `--env` as a mandatory input. no defaults.

## .why

defaulted environments are footguns:
- accidental prod queries when you meant prep
- accidental prod mutations when you meant test
- silent failures when keyrack has wrong env unlocked
- "it worked on my machine" because defaults differed

explicit is safe. implicit is dangerous.

## severity: blocker

accidental environment mismatch can cause:
- data leaks (queried wrong env)
- data corruption (mutated wrong env)
- outages (modified prod instead of prep)
- hours of debug time (wrong env, right symptoms)

## .where

- all ghlitch skills that use `--env`
- all skills that interact with aws, databases, or external services
- any skill that uses keyrack credentials

## .how

```bash
# bad — defaults to prod
--env ENV       # aws credentials env: test, prep, prod (default: prod)

# good — required, no default
--env ENV       # aws credentials env: test, prep, prod (required)
```

validate early and fail loud:

```bash
if [[ -z "$ENV" ]]; then
  echo "🐈 belay that... --env required" >&2
  exit 2
fi
```

## .examples

### positive

```bash
rhx aws.s3.list --env prod --uri s3://bucket/prefix
rhx aws.cloudwatch.logs.query --env prep --lambda myFunction
```

### negative

```bash
# absent --env, skill should exit 2
rhx aws.s3.list --uri s3://bucket/prefix
```

## .enforcement

skill with default --env = blocker
