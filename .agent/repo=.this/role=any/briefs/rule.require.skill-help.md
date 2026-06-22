# rule.require.skill-help

## severity: blocker

all shell skills must support `--help`, `-h`, and `help` as first positional arg.

---
---
---

# deets

## .what

every shell skill must handle help invocation via:
- `--help` flag
- `-h` flag
- `help` as first positional argument

## .why

- discoverability: humans need to know what a skill does
- consistency: all skills behave the same way
- rhx passthrough: rhx passes `--skill`, `--repo`, `--role` before user args, so help must be handled in the case statement, not via `$1` check before the loop

## severity: blocker

skills without help are unusable. humans cannot discover options.

## .how

handle help in the argument parse case statement:

```bash
show_help() {
  echo "🐈 heres the deal..."
  echo ""
  echo "🔮 skill.name"
  echo "   usage:"
  echo "     rhx skill.name --env <env> --flag <value>"
  echo ""
  echo "   options:"
  echo "     --env       environment (required)"
  echo "     --flag      some flag"
  echo "     --help      show this help"
  exit 0
}

while [[ $# -gt 0 ]]; do
  case $1 in
    help|--help|-h) show_help ;;
    --env) ENV="$2"; shift 2 ;;
    # ... other options
    --skill) shift 2 ;;  # ignore rhx passthrough
    --repo) shift 2 ;;   # ignore rhx passthrough
    --role) shift 2 ;;   # ignore rhx passthrough
    *) echo "🐈 belay that... unknown option: $1" >&2; exit 2 ;;
  esac
done
```

## .antipattern

check of `$1` before the argument loop does not work because rhx passes additional args:

```bash
# bad - rhx passes --skill, --repo, --role first
if [[ "${1:-}" == "--help" ]]; then
  show_help
fi
```

## .enforcement

skill without help support = blocker
