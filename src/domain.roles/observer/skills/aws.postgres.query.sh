#!/usr/bin/env bash
######################################################################
# 🔮 aws.postgres.query — run readonly SQL queries against the database
#
# .what = executes SQL queries with readonly safety
#
# .why  = enables quick database queries for debug:
#         - diagnose data state
#         - verify records
#         - investigate issues
#
# usage:
#   rhx aws.postgres.query --env prod --sql "SELECT * FROM job LIMIT 5"
#   rhx aws.postgres.query --env prod --sql "SELECT uuid, status FROM job WHERE id = 123"
#   echo "SELECT * FROM job LIMIT 5" | rhx aws.postgres.query --env prod --sql @stdin
#   rhx aws.postgres.query help
#
# options:
#   --env ENV       environment: test, prep, or prod (required)
#   --sql QUERY     SQL query to execute (required)
#                   use @stdin to read query from stdin
#   --format FMT    output format: table (default), csv, json
#
# safety:
#   - connection-level: SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY
#   - PostgreSQL rejects any INSERT/UPDATE/DELETE/DROP at the driver level
#
# guarantee:
#   - exit 0 = query completed
#   - exit 1 = malfunction (db error, query failure)
#   - exit 2 = constraint (absent args, bad env)
######################################################################
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# save original args to pass to TypeScript
ORIGINAL_ARGS=("$@")

# ONE help text, reached from BOTH call sites. the pre-loop check serves a direct call where
# `help` is the first token; the in-loop arm serves an `rhx` call, which passes
# `--skill/--repo/--role` ahead of the caller's own args (rule.require.skill-help).
show_help() {
  echo "🐈 heres the deal..."
  echo ""
  echo "🔮 aws.postgres.query"
  echo ""
  echo "usage:"
  echo "  rhx aws.postgres.query --env <env> --sql <query>"
  echo "  echo 'SELECT ...' | rhx aws.postgres.query --env <env> --sql @stdin"
  echo ""
  echo "options:"
  echo "  --env      environment: test, prep, or prod"
  echo "  --sql      SQL query to execute (use @stdin to read from stdin)"
  echo "  --format   output format: table (default), csv, json"
  echo ""
  echo "safety:"
  echo "  - readonly enforced at connection level"
  echo "  - PostgreSQL rejects INSERT/UPDATE/DELETE/DROP"
  echo ""
  echo "examples:"
  echo "  rhx aws.postgres.query --env prep --sql 'SELECT uuid FROM job LIMIT 5'"
  echo "  rhx aws.postgres.query --env prep --sql 'SELECT 1' --format json"
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
#   1. absent — the flag was the last arg. this loop used to `shift 2` on it unguarded,
#      which bash refuses when only one arg remains; under `set -e` the run then died
#      SILENTLY, exit 1, with not one line printed
#   2. a FLAG token — `--sql --format json` would otherwise swallow `--format` whole, so
#      the run belays about the WRONG flag
require_val() {
  # $1 = flag name, $2 = the candidate value (pass "${2:-}" from the case),
  # $3 = optional comma-joined valid set, for flags whose values are a closed enum
  if [[ -z "$2" || "$2" == --* ]]; then
    echo "🐈 belay that..."
    echo ""
    echo "🔮 aws.postgres.query"
    echo "   ├─ absent value for $1"
    [[ -n "${3:-}" ]] && echo "   ├─ fix: pass one of $3"
    echo "   └─ hint: rhx aws.postgres.query help"
    exit 2
  fi
}

# parse arguments
ENV=""
FORMAT="table"
while [[ $# -gt 0 ]]; do
  case $1 in
    --env)
      require_val --env "${2:-}" "test,prep,prod"
      ENV="$2"
      shift 2
      ;;
    --sql)
      # no value set named: a query is free-form, and a fabricated set would mislead.
      # the value itself is read by the typescript half, from ORIGINAL_ARGS.
      require_val --sql "${2:-}"
      shift 2
      ;;
    --format)
      require_val --format "${2:-}" "table,csv,json"
      FORMAT="$2"
      shift 2
      ;;
    --skill|--repo|--role)
      # rhachet passes these, skip them
      shift 2
      ;;
    --)
      shift
      ;;
    help|--help|-h)
      show_help
      ;;
    *)
      # a mistyped flag used to be swallowed here and handed on to the typescript half,
      # which skips any `--` token it does not know — so `--sq 'SELECT 1'` reached the db
      # layer as an ABSENT --sql and belayed about a flag the caller had in fact supplied.
      echo "🐈 belay that..."
      echo ""
      echo "🔮 aws.postgres.query"
      echo "   ├─ unknown argument: $1"
      echo "   └─ hint: rhx aws.postgres.query help"
      exit 2
      ;;
  esac
done

# the typescript half defaults ANY unrecognized format to `table`, so a typo used to
# silently answer in a shape the caller did not ask for. the closed set is checked here,
# once, where a belay can still name the valid values (rule.prefer.prevent-over-correct).
if [[ "$FORMAT" != "table" && "$FORMAT" != "csv" && "$FORMAT" != "json" ]]; then
  echo "🐈 belay that..."
  echo ""
  echo "🔮 aws.postgres.query"
  echo "   ├─ invalid format: $FORMAT"
  echo "   └─ must be: table, csv, or json"
  exit 2
fi

# validate env
if [[ -z "$ENV" ]]; then
  echo "🐈 belay that..."
  echo ""
  echo "🔮 aws.postgres.query"
  echo "   ├─ absent required arg: --env"
  echo "   └─ must be: test, prep, or prod"
  exit 2
fi

if [[ "$ENV" != "test" && "$ENV" != "prep" && "$ENV" != "prod" ]]; then
  echo "🐈 belay that..."
  echo ""
  echo "🔮 aws.postgres.query"
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
    echo "🔮 aws.postgres.query"
    echo "   ├─ absent AWS_PROFILE from keyrack for env=$ENV"
    echo "   └─ hint: rhx keyrack unlock --owner ehmpath --env $ENV"
    exit 1
  fi

  # export static credentials only — do NOT export AWS_PROFILE
  # AWS SDK prefers AWS_PROFILE over static creds, which causes SSO failures
  #
  # the `if !` guard is the point: an unguarded eval let a failed credential read die under
  # set -e with aws's own message at column 0 and no belay at all — no mascot, no header, no
  # hint (rule.require.errors-name-the-fix).
  if ! eval "$(aws configure export-credentials --profile "$AWS_PROFILE" --format env)"; then
    echo "🐈 wet paws..."
    echo ""
    echo "🔮 aws.postgres.query"
    echo "   ├─ absent credentials from profile $AWS_PROFILE"
    echo "   └─ hint: aws sso login --profile $AWS_PROFILE"
    exit 1
  fi
  unset AWS_PROFILE AWS_DEFAULT_PROFILE
fi

# set ACCESS for TypeScript error hints
export ACCESS="$ENV"
export NODE_ENV="production"

# run the TypeScript implementation
exec npx tsx "$SCRIPT_DIR/aws.postgres.query.ts" "${ORIGINAL_ARGS[@]}"
