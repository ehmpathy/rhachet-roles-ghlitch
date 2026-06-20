# rule.forbid.failhide-in-shell

## severity: blocker

never hide errors in shell skills. errors must surface so users know what went wrong.

---

## the failhide pattern

```bash
# failhide — hides stderr AND swallows exit code
result=$(some-command 2>/dev/null || echo "")
```

this does two bad things:
1. `2>/dev/null` — hides the error message
2. `|| echo ""` — swallows the exit code, returns empty string

the caller sees empty string, misinterprets as "no results found".

---

## allowed vs forbidden

### forbidden

```bash
# hides error AND swallows exit code
params=$(aws ssm describe-parameters ... 2>/dev/null || echo "")

# hides error AND provides fallback value
count=$(aws cloudwatch get-metric-statistics ... 2>/dev/null || echo "0")
```

### allowed

```bash
# suppresses stderr but checks result, surfaces error
profile=$(rhx keyrack get ... 2>/dev/null || echo "")
if [[ -z "$profile" ]]; then
  echo "🐈 wet paws..."
  echo "   └─ absent profile"
  exit 1
fi

# no suppression at all — raw errors surface
params=$(aws ssm describe-parameters ...)
```

---

## the fix

delete `2>/dev/null || echo ""`. let the command fail naturally.

```bash
# before
params=$(aws ssm describe-parameters ... 2>/dev/null || echo "")

# after
params=$(aws ssm describe-parameters ...)
```

if the command fails, it fails. stderr shows the error. skill exits non-zero.

---

## why this matters

failhides cause hours of debug time. the user sees "(none found)" when the real problem is expired credentials. they check the wrong things. 15 minutes later, they re-unlock keyrack "just in case" and it works.

that 15 minutes was stolen by silent failure.

---

## enforcement

failhide pattern in shell skill = **blocker**

