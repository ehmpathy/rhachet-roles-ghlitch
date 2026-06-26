# rule.forbid.config-defaults

## severity: blocker

never default config values. config must be explicitly supplied or the skill must fail fast.

---
---
---

# deets

## .what

skills that read config (e.g. via getConfig, env vars, json files) must not invent default values when a config value is absent. if a required config value is absent, fail fast and guide the caller to fix their config.

## .why

defaulted config is a footgun:
- silent fallbacks mask absent config until something downstream breaks
- a placeholder like `"null"` or `""` flows through and fails opaquely far from the cause
- the caller wastes hours on the symptom instead of the absent config
- "it worked on my machine" because defaults differed across repos

explicit config is safe. defaulted config hides the real problem.

## severity: blocker

absent config that defaults silently can cause:
- opaque downstream failures (wrong host, wrong cluster, wrong account)
- hours of debug time on the symptom, not the cause
- accidental writes against the wrong target

## .where

- all skills that read repo config (getConfig, config/*.json)
- all skills that read env vars for required inputs
- any skill that resolves a target (cluster, bastion, account, host) from config

## .how

validate required config values right after the read. treat empty, absent, and placeholder (`null`, `"null"`) as absent:

```bash
# bad — defaults an absent config value
CLUSTER=$(echo "$CONFIG_JSON" | jq -r '.cluster.name // "default-cluster"')

# good — fail fast when config is absent
CLUSTER=$(echo "$CONFIG_JSON" | jq -r '.cluster.name')
if [[ -z "$CLUSTER" || "$CLUSTER" == "null" ]]; then
  echo "🐈 belay that..." >&2
  echo "   └─ absent config: database.tunnel.cluster.name" >&2
  echo "   └─ hint: set it in your repo config/$ENV.json" >&2
  exit 2
fi
```

## .examples

### positive

```bash
# config value required, validated, no default invented
BASTION=$(echo "$CONFIG_JSON" | jq -r '.bastion.exid')
[[ -z "$BASTION" || "$BASTION" == "null" ]] && { echo "absent config: bastion.exid" >&2; exit 2; }
```

### negative

```bash
# invents a default, hides the absent config
PORT=$(echo "$CONFIG_JSON" | jq -r '.local.port // 5432')
```

## .enforcement

defaulted required config value = blocker

## .see also

- rule.require.failfast-on-omitted-input
- rule.forbid.fallbacks
- rule.forbid.failhide-in-shell
- rule.forbid.default-env
