#!/usr/bin/env bash
######################################################################
# 🔮 aws.ssm.param.check — check if SSM parameters exist
#
# .what = diagnoses SSM parameter resolution failures
#
# .why  = diagnose sdk-config parameter resolution failures by
#         confirm parameters exist at expected paths
#
# usage:
#   rhx aws.ssm.param.check --env prep --name ahbode.svc-jobs.prep.database.role.crud.password
#   rhx aws.ssm.param.check --env prep --pattern 'ahbode.svc-jobs.prep.*'
#   rhx aws.ssm.param.check --env prep --from config/prep.json
#   rhx aws.ssm.param.check help
#
# options:
#   --env        environment: test, prep, or prod (required)
#   --name       single parameter name to check
#   --pattern    pattern to search (contains match)
#   --from       extract $.at(aws::param/...) refs from config file
#
# guarantee:
#   - exit 0 = check completed
#   - exit 1 = malfunction (aws error, credential failure)
#   - exit 2 = constraint (absent args, bad env, file not found)
######################################################################
set -euo pipefail

# ONE help text, reached from BOTH call sites. there used to be two copies that had already
# drifted: the pre-loop one carried no `🐈` mascot at all, and named `--pattern` as a
# "contains match" where the in-loop one called it a "glob pattern with * wildcards" — two
# different contracts for one flag (rule.require.consistent-skill-contracts). the aws api
# it maps to is `Option=Contains`, so the first was the accurate one.
show_help() {
  echo "🐈 heres the deal..."
  echo ""
  echo "🔮 aws.ssm.param.check"
  echo ""
  echo "usage:"
  echo "  rhx aws.ssm.param.check --env <env> --name <param>"
  echo "  rhx aws.ssm.param.check --env <env> --pattern <search>"
  echo "  rhx aws.ssm.param.check --env <env> --from <config.json>"
  echo ""
  echo "options:"
  echo "  --env      environment: test, prep, or prod"
  echo "  --name     exact parameter name"
  echo "  --pattern  text a parameter name must contain (never a glob)"
  echo "  --from     extract aws::param refs from a config file"
  echo ""
  echo "examples:"
  echo "  rhx aws.ssm.param.check --env prep --name ahbode.svc-jobs.prep.livedb.uri"
  echo "  rhx aws.ssm.param.check --env prep --pattern ahbode.svc-jobs"
  echo "  rhx aws.ssm.param.check --env prep --from config/prep.json"
  exit 0
}

# help, ahead of the loop — for a direct call where `help` is the first token
if [[ "${1:-}" == "help" || "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  show_help
fi

# require a value for a flag — belay fast when the next token cannot serve as the value.
# the same helper, message and value-set hint as every kin skill
# (rule.require.consistent-skill-contracts).
#
# it rejects TWO shapes, and the second is the subtle one:
#   1. absent — the flag was the last arg. without this, set -u trips a cryptic
#      unbound-variable crash instead of a helpful message
#   2. a FLAG token — `--env --name x` would otherwise set ENV='--name' and eat the next
#      flag whole, so the run belays about the WRONG flag
require_val() {
  # $1 = flag name, $2 = the candidate value (pass "${2:-}" from the case),
  # $3 = optional comma-joined valid set, for flags whose values are a closed enum
  if [[ -z "$2" || "$2" == --* ]]; then
    echo "🐈 belay that..."
    echo ""
    echo "🔮 aws.ssm.param.check"
    echo "   ├─ absent value for $1"
    [[ -n "${3:-}" ]] && echo "   ├─ fix: pass one of $3"
    echo "   └─ hint: rhx aws.ssm.param.check help"
    exit 2
  fi
}

# parse arguments
ENV=""
NAME=""
PATTERN=""
FROM=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --env)
      require_val --env "${2:-}" "test,prep,prod"
      ENV="$2"
      shift 2
      ;;
    --name)
      # no value set named: a parameter name is free-form, and a fabricated set would mislead
      require_val --name "${2:-}"
      NAME="$2"
      shift 2
      ;;
    --pattern)
      require_val --pattern "${2:-}"
      PATTERN="$2"
      shift 2
      ;;
    --from)
      require_val --from "${2:-}"
      FROM="$2"
      shift 2
      ;;
    --skill|--repo|--role)
      shift 2
      ;;
    --)
      shift
      ;;
    help|--help|-h)
      show_help
      ;;
    *)
      echo "🐈 belay that..."
      echo ""
      echo "🔮 aws.ssm.param.check"
      echo "   ├─ unknown argument: $1"
      echo "   └─ hint: rhx aws.ssm.param.check help"
      exit 2
      ;;
  esac
done

# validate env
if [[ -z "$ENV" ]]; then
  echo "🐈 belay that..."
  echo ""
  echo "🔮 aws.ssm.param.check"
  echo "   ├─ absent required arg: --env"
  echo "   └─ must be: test, prep, or prod"
  exit 2
fi

if [[ "$ENV" != "test" && "$ENV" != "prep" && "$ENV" != "prod" ]]; then
  echo "🐈 belay that..."
  echo ""
  echo "🔮 aws.ssm.param.check"
  echo "   ├─ invalid env: $ENV"
  echo "   └─ must be: test, prep, or prod"
  exit 2
fi

# source aws credentials from keyrack (skip if already set)
if [[ -z "${AWS_ACCESS_KEY_ID:-}" ]]; then
  AWS_PROFILE=$(rhx keyrack get --owner ehmpath --env "$ENV" --key AWS_PROFILE --value || echo "")
  if [[ -z "$AWS_PROFILE" ]]; then
    echo "🐈 wet paws..."
    echo ""
    echo "🔮 aws.ssm.param.check"
    echo "   ├─ absent AWS_PROFILE from keyrack for env=$ENV"
    echo "   └─ hint: rhx keyrack unlock --owner ehmpath --env $ENV"
    exit 1
  fi

  # export static credentials only
  if ! eval "$(aws configure export-credentials --profile "$AWS_PROFILE" --format env)"; then
    echo "🐈 wet paws..."
    echo ""
    echo "🔮 aws.ssm.param.check"
    echo "   ├─ absent credentials from profile $AWS_PROFILE"
    echo "   └─ hint: aws sso login --profile $AWS_PROFILE"
    exit 1
  fi
  unset AWS_PROFILE AWS_DEFAULT_PROFILE
fi

# ── the tree ────────────────────────────────────────────────────────────────────────
# ONE mascot, ONE header, ONE tree. every block below used to be printed with no branch
# glyph at all — `   check parameter:`, `   ✅ name`, `   (none found)` and five more were
# neither blank, nor a mascot, nor a header, nor a tree item
# (rule.require.nest-subskill-output-in-buckets).
echo "🐈 chartin course..."
echo ""
echo "🔮 aws.ssm.param.check --env $ENV"
echo "   ├─ env: $ENV"

# how many of the params checked were present, and how many were absent. the run used to
# close on a bare `observed`, which said a check HAPPENED but never what it found — so a
# human had to re-read the list to learn the answer they asked for.
FOUND=0
ABSENT=0

# render one param as a child of the item that introduced it, at 6 spaces.
#
# $1 is the branch glyph, decided by the CALLER: the last child of a list takes `└─`, and
# that cannot be known from inside the loop, so the caller counts.
check_param() {
  local glyph="$1"
  local param_name="$2"
  # BOTH streams silenced. `>/dev/null` alone left aws's not-found message on stderr, where
  # it landed at column 0 in the middle of this tree. the absence is not an error here — it
  # is the ANSWER — so the skill speaks it as a tree item rather than let the tool shout it.
  if aws ssm get-parameter --name "$param_name" --query 'Parameter.Name' --output text >/dev/null 2>&1; then
    echo "      $glyph ✅ $param_name"
    FOUND=$((FOUND + 1))
  else
    echo "      $glyph ❌ $param_name (absent)"
    ABSENT=$((ABSENT + 1))
  fi
}

# render a whole list of params, each as a child at 6 spaces. collected FIRST and counted,
# because the last child takes `└─` and that is unknowable until the list is complete.
check_params() {
  local total=$#
  local idx=0
  for name in "$@"; do
    idx=$((idx + 1))
    if [[ $idx -eq $total ]]; then
      check_param "└─" "$name"
    else
      check_param "├─" "$name"
    fi
  done
}

# the terminal block, shared by all three modes. it closes with the COUNTS, so the tally is
# stated rather than left for the human to make.
close_observed() {
  echo ""
  echo "🐈 caught it!"
  echo ""
  echo "🔮 aws.ssm.param.check --env $ENV"
  echo "   └─ $FOUND found, $ABSENT absent"
  exit 0
}

# mode: single name
if [[ -n "$NAME" ]]; then
  echo "   └─ check parameter"
  check_params "$NAME"
  close_observed
fi

# mode: pattern search
if [[ -n "$PATTERN" ]]; then
  echo "   ├─ pattern: $PATTERN"
  echo "   └─ params that contain it"
  params=$(aws ssm describe-parameters \
    --parameter-filters "Key=Name,Option=Contains,Values=$PATTERN" \
    --query 'Parameters[].Name' \
    --output text)

  if [[ -z "$params" ]]; then
    echo "      └─ (none)"
  else
    # word-split is deliberate: `--output text` answers one tab-separated line
    # shellcheck disable=SC2086
    check_params $params
  fi
  close_observed
fi

# mode: extract from config file
if [[ -n "$FROM" ]]; then
  # the header is already on screen by the time this runs, so the belay must close the open
  # tree before it speaks. `blocked:` because the exit is 2 — a constraint the caller fixes
  # (rule.require.consistent-skill-contracts).
  if [[ ! -f "$FROM" ]]; then
    echo "   └─ blocked: absent file"
    echo ""
    echo "🐈 belay that..."
    echo ""
    echo "🔮 aws.ssm.param.check"
    echo "   ├─ no file at: $FROM"
    echo "   └─ hint: pass a path relative to the cwd you invoked from"
    exit 2
  fi

  echo "   ├─ from: $FROM"
  echo "   └─ params referenced"

  # extract $.at(aws::param/...) references
  #
  # grep answers 1 when it matched no line, and 2+ on a real malfunction. this file has
  # `set -o pipefail`, so the plain pipeline this used to be let that 1 propagate and kill
  # the run — a config with no refs made the skill die on exit 1 with NOT ONE line printed
  # past the header, three lines before the branch that exists to report exactly that case.
  # it had no test, so it was never seen.
  #
  # the two exits are told apart rather than swallowed together: 1 is an ANSWER (no refs),
  # 2+ is a malfunction that still belays (rule.forbid.failhide).
  set +e
  raw_refs=$(grep -oE '\$\.at\(aws::param/[^)]+\)' "$FROM")
  grep_code=$?
  set -e
  if [[ $grep_code -gt 1 ]]; then
    echo "   └─ halted: could not read the file"
    echo ""
    echo "🐈 wet paws..."
    echo ""
    echo "🔮 aws.ssm.param.check"
    echo "   ├─ grep could not read: $FROM"
    echo "   └─ hint: check the file is readable text, not a binary or a directory"
    exit 1
  fi
  refs=$(printf '%s' "$raw_refs" | sed 's/\$\.at(aws::param\///' | sed 's/)//' | sort -u)

  if [[ -z "$refs" ]]; then
    echo "      └─ (none)"
    close_observed
  fi

  # word-split is deliberate: refs is a newline-separated list
  # shellcheck disable=SC2086
  check_params $refs
  close_observed
fi

# no mode named. the header is already printed, so close the tree before the belay.
echo "   └─ blocked: no mode named"
echo ""
echo "🐈 belay that..."
echo ""
echo "🔮 aws.ssm.param.check"
echo "   ├─ one of --name, --pattern or --from is required"
echo "   └─ hint: rhx aws.ssm.param.check help"
exit 2
