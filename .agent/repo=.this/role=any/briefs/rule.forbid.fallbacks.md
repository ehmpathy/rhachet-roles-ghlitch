# rule.forbid.fallbacks

## severity: blocker

never silently fall back to an alternate value when the primary input is absent. fail fast instead.

---
---
---

# deets

## .what

a fallback substitutes an alternate value when the primary one is absent (`A || B`, `?? default`, `// default`, `|| echo ""`). this is forbidden for required inputs. when the primary value is absent, halt and guide the caller — do not paper over it with a substitute.

## .why

fallbacks hide the real problem:
- the substitute lets a broken state proceed, so the defect surfaces later and opaquely
- `|| echo ""` swallows the exit code, so the caller reads empty as "no results" instead of "it failed"
- a default value masks absent config, so wrong targets get used silently
- the caller never learns the primary input was absent

a fallback trades a loud, actionable failure for a quiet, dangerous success.

## severity: blocker

silent fallbacks can cause:
- defects that surface far from the cause (hours of debug time)
- action against a wrong default target (data loss, outages)
- false "empty result" reads that send the caller down the wrong path

## .where

- all skills and shell scripts
- env var reads, config reads, command substitutions
- anywhere `||`, `??`, or `// default` substitutes for an absent required value

## .how

distinguish a true optional (a real default is correct) from a required input (no default is acceptable). for required inputs, fail fast:

```bash
# bad — fallback hides absent config
CLUSTER="${VPC_TUNNEL_CLUSTER:-default-cluster}"

# bad — failhide fallback swallows the error
params=$(aws ssm describe-parameters ... 2>/dev/null || echo "")

# good — no fallback, fail fast
if [[ -z "$VPC_TUNNEL_CLUSTER" || "$VPC_TUNNEL_CLUSTER" == "null" ]]; then
  echo "🐈 belay that..." >&2
  echo "   └─ absent: cluster (set it in config/$ENV.json)" >&2
  exit 2
fi
```

## .note

backwards-compat fallbacks (e.g. read a new arg, else an old env var) are tolerated only when both paths are real, documented inputs — never as a silent default for an absent value.

## .examples

### positive

```bash
# required value, no fallback
ACCOUNT=$(echo "$CONFIG_JSON" | jq -r '.account')
[[ -z "$ACCOUNT" || "$ACCOUNT" == "null" ]] && { echo "absent: account" >&2; exit 2; }
```

### negative

```bash
# fallback masks the absent value
ACCOUNT=$(echo "$CONFIG_JSON" | jq -r '.account // "123456789012"')
```

## .enforcement

- fallback for a required input = blocker
- `|| echo ""` / `2>/dev/null || ...` failhide fallback = blocker

## .see also

- rule.forbid.config-defaults
- rule.require.failfast-on-omitted-input
- rule.forbid.failhide-in-shell
