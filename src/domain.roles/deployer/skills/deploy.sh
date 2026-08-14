#!/usr/bin/env bash
######################################################################
# ⛵ deploy — deploy service to aws via SSO credentials
#
# .what = deploys service via serverless with SSO credential support
#
# .why  = serverless v2 + AWS SDK v2 lack native SSO profile support.
#         this skill exports SSO credentials to env vars and unsets
#         AWS_PROFILE so serverless uses the credential chain properly.
#
# usage:
#   rhx deploy --env prep
#   rhx deploy --env prod
#   rhx deploy help
#
# options:
#   --env ENV    environment: prep or prod (required)
#
# guarantee:
#   - exit 0 = deploy completed
#   - exit 1 = malfunction (aws error, deploy failure)
#   - exit 2 = constraint (absent args, bad env)
######################################################################
set -euo pipefail

# help
if [[ "${1:-}" == "help" || "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  echo "🐈 heres the deal..."
  echo ""
  echo "⛵ deploy"
  echo ""
  echo "usage:"
  echo "  rhx deploy --env <env>"
  echo ""
  echo "options:"
  echo "  --env    environment: prep or prod"
  exit 0
fi

# clear extant AWS_PROFILE to avoid interference
unset AWS_PROFILE 2>/dev/null || true

# require a value for a flag — belay fast when the next token cannot serve as the value.
# the same helper, message and value-set hint as every kin deployer skill
# (rule.require.consistent-skill-contracts): a caller who learns this belay on
# provision.declastruct has learned it here too.
#
# it rejects TWO shapes, and the second is the subtle one:
#   1. absent — the flag was the last arg. without this, set -u trips a cryptic
#      unbound-variable crash instead of a helpful message
#   2. a FLAG token — `--env --mode` would otherwise set ENV='--mode' and eat the next
#      flag whole, so the run belays about the WRONG flag
require_val() {
  # $1 = flag name, $2 = the candidate value (pass "${2:-}" from the case),
  # $3 = optional comma-joined valid set, for flags whose values are a closed enum
  if [[ -z "$2" || "$2" == --* ]]; then
    echo "🐈 belay that..."
    echo ""
    echo "⛵ deploy"
    echo "   ├─ absent value for $1"
    [[ -n "${3:-}" ]] && echo "   ├─ fix: pass one of $3"
    echo "   └─ hint: rhx deploy help"
    exit 2
  fi
}

# parse arguments
ENV=""
while [[ $# -gt 0 ]]; do
  case $1 in
    --env)
      require_val --env "${2:-}" "prep,prod"
      ENV="$2"
      shift 2
      ;;
    --skill|--repo|--role)
      shift 2  # skip rhx passthrough args
      ;;
    --)
      shift
      ;;
    help|--help|-h)
      echo "🐈 heres the deal..."
      echo ""
      echo "⛵ deploy"
      echo ""
      echo "usage:"
      echo "  rhx deploy --env <env>"
      echo ""
      echo "options:"
      echo "  --env    environment: prep or prod"
      exit 0
      ;;
    *)
      echo "🐈 belay that..."
      echo ""
      echo "⛵ deploy"
      echo "   ├─ unknown argument: $1"
      echo "   └─ use --help for usage"
      exit 2
      ;;
  esac
done

# validate env
if [[ -z "$ENV" ]]; then
  echo "🐈 belay that..."
  echo ""
  echo "⛵ deploy"
  echo "   ├─ absent required arg: --env"
  echo "   └─ must be: prep or prod"
  exit 2
fi

if [[ "$ENV" != "prep" && "$ENV" != "prod" ]]; then
  echo "🐈 belay that..."
  echo ""
  echo "⛵ deploy"
  echo "   ├─ invalid env: $ENV"
  echo "   └─ must be: prep or prod"
  exit 2
fi

# ── nest ────────────────────────────────────────────────────────────────────────────
# sourced ONCE, unconditionally, because this skill frames TWO children: the prod gate
# below and the serverless deploy at the end. it used to be sourced inside the gate
# branch alone, so a prep run reached `run_sub_bucket` undefined.
#
# reach the nest helper PACKAGE-relatively, via BASH_SOURCE — never through
# `git rev-parse --show-toplevel`, which resolves to the CONSUMER's repo root.
DEPLOYER_SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPERATOR_SKILL_DIR="$(cd "$DEPLOYER_SKILL_DIR/../../operator/skills" && pwd)"
source "$OPERATOR_SKILL_DIR/_.nest.sh"

echo "🐈 chartin course..."
echo ""
echo "⛵ deploy --env $ENV"
echo "   ├─ env: $ENV"

# prod gate: deploys to prod require an explicit deploy.uses grant. framed in this
# skill's own treestruct sub.bucket, under a labeled item, so the gate's two-header
# block reads as a child of this run rather than a wall at column 0
# (rule.require.nest-subskill-output-in-buckets).
if [[ "$ENV" == "prod" ]]; then
  echo "   ├─ check the gate..."
  # _or_belay, not `|| exit $?`: a blocked gate must close THIS tree and state the
  # verdict at column 0, never exit mid-frame and leave the ⛵ tree half-drawn.
  run_sub_bucket_or_belay "   │  " "⛵ deploy" "blocked at the gate" \
    bash "$DEPLOYER_SKILL_DIR/uses._.check.sh" --meter deploy.uses --env prod
fi

# source aws credentials from keyrack
#
# every belay from here down CLOSES the header tree first, with `halted:` for a
# malfunction and `blocked:` for a constraint. a belay that skips the close leaves the
# ⛵ tree half-drawn — items with no `└─` — the same defect
# `run_sub_bucket_or_belay` exists to prevent at the gate. each belay is then
# SELF-CONTAINED, seamed off by a blank line and carrying its own mascot, so it never
# inherits `chartin course...` and read as a run that started fine
# (rule.require.nest-subskill-output-in-buckets, `.the two costs a split imposes`).
AWS_PROFILE=$(rhx keyrack get --owner ehmpath --env "$ENV" --key AWS_PROFILE --value || echo "")
if [[ -z "$AWS_PROFILE" ]]; then
  echo "   └─ halted: absent credentials"
  echo ""
  echo "🐈 wet paws..."
  echo ""
  echo "⛵ deploy"
  echo "   ├─ absent AWS_PROFILE from keyrack for env=$ENV"
  echo "   └─ hint: rhx keyrack unlock --owner ehmpath --env $ENV"
  exit 1
fi

# export credentials from SSO profile
echo "   ├─ export credentials from: $AWS_PROFILE"
if ! eval "$(aws configure export-credentials --profile "$AWS_PROFILE" --format env)"; then
  echo "   └─ halted: absent credentials"
  echo ""
  echo "🐈 wet paws..."
  echo ""
  echo "⛵ deploy"
  echo "   ├─ absent credentials from profile $AWS_PROFILE"
  echo "   └─ hint: aws sso login --profile $AWS_PROFILE"
  exit 1
fi

# unset AWS_PROFILE to prevent serverless profile resolution
# (serverless v2 lacks SSO profile support)
unset AWS_PROFILE AWS_DEFAULT_PROFILE

# set ACCESS for config resolution
export ACCESS="$ENV"
echo "   ├─ access: $ACCESS"

# the serverless deploy, framed in this skill's own sub.bucket under a labeled item.
#
# it is NOT a forward-contract payload. that exemption is only real when a named caller
# reads THIS skill's stdout and would break under an indent — and no such caller exists:
# not one workflow or command in this repo invokes `rhx deploy` and parses its output.
# an exemption backed by a comment is backed by no contract at all
# (rule.require.nest-subskill-output-in-buckets, `.verify the contract`).
#
# `|| exit $?` is mandatory: the child runs in a pipe, so a bare call would not trip
# set -e and a failed deploy would read as a success.
echo "   └─ eyes on target..."
if [[ "$ENV" == "prod" ]]; then
  run_sub_bucket "      " npm run deploy:prod || exit $?
else
  run_sub_bucket "      " npm run deploy:dev || exit $?
fi

echo ""
echo "🐈 smooth sailin!"
echo ""
echo "⛵ deploy --env $ENV"
echo "   └─ deployed to $ENV"
