#!/usr/bin/env bash
######################################################################
# ⛵ provision.terraform — run terraform with SSO credential export
#
# .what = wraps terraform with AWS SSO credential export
#
# .why  = terraform versions lack native AWS SSO sso_session support.
#         this skill exports SSO credentials to env vars so terraform
#         uses the credential chain properly.
#
# usage:
#   rhx provision.terraform init --env prep
#   rhx provision.terraform plan --env prep
#   rhx provision.terraform apply --env prep --approve
#   rhx provision.terraform plan --env prod
#   rhx provision.terraform apply --env prod --approve
#   rhx provision.terraform help
#
# options:
#   --env ENV     environment: test, prep, or prod (required)
#   --approve     auto-approve terraform apply (no prompt)
#   <tf-args>     terraform arguments (init, plan, apply, etc.)
#
# guarantee:
#   - exit 0 = terraform completed
#   - exit 1 = malfunction (aws error, terraform error)
#   - exit 2 = constraint (absent args, bad env, absent dir)
######################################################################
set -euo pipefail

# help
if [[ "${1:-}" == "help" || "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  echo "🐈 heres the deal..."
  echo ""
  echo "⛵ provision.terraform"
  echo ""
  echo "usage:"
  echo "  rhx provision.terraform <command> --env <env> [--approve]"
  echo ""
  echo "options:"
  echo "  --env      environment: test, prep, or prod"
  echo "  --approve  auto-approve terraform apply (no prompt)"
  echo ""
  echo "examples:"
  echo "  rhx provision.terraform init --env prep"
  echo "  rhx provision.terraform plan --env prep"
  echo "  rhx provision.terraform apply --env prod --approve"
  exit 0
fi

# clear extant AWS_PROFILE to avoid interference
unset AWS_PROFILE 2>/dev/null || true

# require a value for a flag — belay fast when the next token cannot serve as the value.
# the same helper, message and value-set hint as every kin deployer skill
# (rule.require.consistent-skill-contracts).
#
# it rejects TWO shapes, and the second is the subtle one:
#   1. absent — the flag was the last arg. without this, set -u trips a cryptic
#      unbound-variable crash instead of a helpful message
#   2. a FLAG token — `--env --approve` would otherwise set ENV='--approve' and eat the
#      next flag whole, so the run belays about the WRONG flag
require_val() {
  # $1 = flag name, $2 = the candidate value (pass "${2:-}" from the case),
  # $3 = optional comma-joined valid set, for flags whose values are a closed enum
  if [[ -z "$2" || "$2" == --* ]]; then
    echo "🐈 belay that..."
    echo ""
    echo "⛵ provision.terraform"
    echo "   ├─ absent value for $1"
    [[ -n "${3:-}" ]] && echo "   ├─ fix: pass one of $3"
    echo "   └─ hint: rhx provision.terraform help"
    exit 2
  fi
}

# parse arguments (filter out rhachet passthrough and --env)
ENV=""
APPROVE=false
TERRAFORM_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env)
      require_val --env "${2:-}" "test,prep,prod"
      ENV="$2"
      shift 2
      ;;
    --approve)
      APPROVE=true
      shift
      ;;
    -auto-approve)
      echo "🐈 belay that..."
      echo ""
      echo "⛵ provision.terraform"
      echo "   ├─ invalid flag: -auto-approve"
      echo "   └─ hint: use --approve instead"
      exit 2
      ;;
    --skill|--repo|--role)
      # rhachet passthrough args - skip with value
      shift 2
      ;;
    --)
      shift
      ;;
    help|--help|-h)
      echo "🐈 heres the deal..."
      echo ""
      echo "⛵ provision.terraform"
      echo ""
      echo "usage:"
      echo "  rhx provision.terraform <command> --env <env> [--approve]"
      echo ""
      echo "options:"
      echo "  --env      environment: test, prep, or prod"
      echo "  --approve  auto-approve terraform apply (no prompt)"
      echo ""
      echo "examples:"
      echo "  rhx provision.terraform init --env prep"
      echo "  rhx provision.terraform plan --env prep"
      echo "  rhx provision.terraform apply --env prod --approve"
      exit 0
      ;;
    *)
      TERRAFORM_ARGS+=("$1")
      shift
      ;;
  esac
done

# validate env
if [[ -z "$ENV" ]]; then
  echo "🐈 belay that..."
  echo ""
  echo "⛵ provision.terraform"
  echo "   ├─ absent required arg: --env"
  echo "   └─ must be: test, prep, or prod"
  exit 2
fi

if [[ "$ENV" == "dev" ]]; then
  echo "🐈 belay that..."
  echo ""
  echo "⛵ provision.terraform"
  echo "   ├─ invalid env: dev"
  echo "   └─ hint: use --env prep instead (supports dev/ directory for backcompat)"
  exit 2
fi

if [[ "$ENV" != "test" && "$ENV" != "prep" && "$ENV" != "prod" ]]; then
  echo "🐈 belay that..."
  echo ""
  echo "⛵ provision.terraform"
  echo "   ├─ invalid env: $ENV"
  echo "   └─ must be: test, prep, or prod"
  exit 2
fi

# validate terraform args
if [[ ${#TERRAFORM_ARGS[@]} -eq 0 ]]; then
  echo "🐈 belay that..."
  echo ""
  echo "⛵ provision.terraform"
  echo "   ├─ absent terraform command"
  echo "   └─ example: rhx provision.terraform plan --env prep"
  exit 2
fi

# ── nest ────────────────────────────────────────────────────────────────────────────
# sourced ONCE, unconditionally, because this skill frames TWO children: the prod gate
# below and the terraform run at the end. it used to be sourced inside the gate branch
# alone, so a non-prod run reached `run_sub_bucket` undefined.
#
# reach the nest helper PACKAGE-relatively, via BASH_SOURCE — never through
# `git rev-parse --show-toplevel`, which resolves to the CONSUMER's repo root.
DEPLOYER_SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPERATOR_SKILL_DIR="$(cd "$DEPLOYER_SKILL_DIR/../../operator/skills" && pwd)"
source "$OPERATOR_SKILL_DIR/_.nest.sh"

# output header — its `env` and `cmd` fields are known from parsed args alone, so they
# render HERE, above the gate, to give the gate's bucket a parent tree to nest under
# (rule.require.nest-subskill-output-in-buckets). only `dir` waits on the directory
# resolution below, so only `dir` renders late.
echo "🐈 chartin course..."
echo ""
echo "⛵ provision.terraform --env $ENV ${TERRAFORM_ARGS[*]}"
echo "   ├─ env: $ENV"
echo "   ├─ cmd: terraform ${TERRAFORM_ARGS[*]}"

# prod gate: only writer subcommands against prod are gated; reads stay open.
# the read-only allowlist passes through; every other subcommand counts as a
# writer (fail-closed), so a new mutation verb cannot slip past ungated.
if [[ "$ENV" == "prod" ]]; then
  TF_CMD="${TERRAFORM_ARGS[0]}"
  TF_READONLY=" plan validate show output fmt init get providers version graph "
  if [[ "$TF_READONLY" != *" $TF_CMD "* ]]; then
    echo "   ├─ check the gate..."
    # _or_belay, not `|| exit $?`: a blocked gate must close THIS tree and state the
    # verdict at column 0, never exit mid-frame and leave the ⛵ tree half-drawn.
    run_sub_bucket_or_belay "   │  " "⛵ provision.terraform" "blocked at the gate" \
      bash "$DEPLOYER_SKILL_DIR/uses._.check.sh" --meter provision.uses --env prod
  fi
fi

# find repo root and environments directory
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo ".")
ENVIRONMENTS_DIR="$REPO_ROOT/provision/aws/environments"

# map env to directory name
# for prep: accept either dev/ or prep/ directory (dev is legacy alias)
case "$ENV" in
  test) ENV_DIR="test" ;;
  prep)
    HAS_DEV_DIR=$([[ -d "$ENVIRONMENTS_DIR/dev" ]] && echo "true" || echo "false")
    HAS_PREP_DIR=$([[ -d "$ENVIRONMENTS_DIR/prep" ]] && echo "true" || echo "false")

    # failfast if both exist (ambiguous). a SELF-CONTAINED belay, seamed off the header
    # tree above — it carries its own mascot rather than inherit `chartin course...`,
    # which would read as a run that started fine.
    #
    # it CLOSES the header tree first. `dir` is this header's `└─`, so a belay that skips
    # it leaves the ⛵ tree half-drawn — items with no close — which is the same defect
    # `run_sub_bucket_or_belay` exists to prevent at the gate. the close names the
    # OUTCOME, with `blocked:` for a constraint and `halted:` for a malfunction — the
    # same words every kin deployer skill uses
    # (rule.require.consistent-skill-contracts, at the render layer).
    if [[ "$HAS_DEV_DIR" == "true" && "$HAS_PREP_DIR" == "true" ]]; then
      echo "   └─ blocked: ambiguous environment directory"
      echo ""
      echo "🐈 belay that..."
      echo ""
      echo "⛵ provision.terraform"
      echo "   ├─ ambiguous: both dev/ and prep/ directories exist"
      echo "   └─ remove one to resolve"
      exit 2
    fi

    # use whichever exists
    if [[ "$HAS_DEV_DIR" == "true" ]]; then
      ENV_DIR="dev"
    elif [[ "$HAS_PREP_DIR" == "true" ]]; then
      ENV_DIR="prep"
    else
      echo "   └─ blocked: absent environment directory"
      echo ""
      echo "🐈 belay that..."
      echo ""
      echo "⛵ provision.terraform"
      echo "   ├─ directory not found: $ENVIRONMENTS_DIR/prep (or dev)"
      echo "   └─ ensure terraform environment is configured"
      exit 2
    fi
    ;;
  prod) ENV_DIR="prod" ;;
esac

if [[ ! -d "$ENVIRONMENTS_DIR/$ENV_DIR" ]]; then
  echo "   └─ blocked: absent environment directory"
  echo ""
  echo "🐈 belay that..."
  echo ""
  echo "⛵ provision.terraform"
  echo "   ├─ directory not found: $ENVIRONMENTS_DIR/$ENV_DIR"
  echo "   └─ ensure terraform environment is configured"
  exit 2
fi

# the header's late field: `dir` could only be stated once the directory resolution
# above settled which of dev/ or prep/ this env maps to.
#
# it is a `├─`, NOT the tree's close. the credential export and the terraform run are
# both real steps that follow, and they used to render as 3-space-indented lines AFTER
# this tree had already closed — orphans that carry a tree's indent while they hang off
# no tree. the tree therefore stays OPEN through them, and every belay between here and
# the close pays for that by closing it on the way out.
echo "   ├─ dir: $ENV_DIR"

# get AWS profile from keyrack
AWS_PROFILE_NAME=$(rhx keyrack get --key AWS_PROFILE --env "$ENV" --owner ehmpath --value || echo "")
if [[ -z "$AWS_PROFILE_NAME" ]]; then
  echo "   └─ halted: absent credentials"
  echo ""
  echo "🐈 wet paws..."
  echo ""
  echo "⛵ provision.terraform"
  echo "   ├─ absent AWS_PROFILE from keyrack for env=$ENV"
  echo "   └─ hint: rhx keyrack unlock --owner ehmpath --env $ENV"
  exit 1
fi

# export credentials from AWS SSO profile
echo "   ├─ export credentials from: $AWS_PROFILE_NAME"
CREDS=$(aws configure export-credentials --profile "$AWS_PROFILE_NAME" --format env || echo "")
if [[ -z "$CREDS" ]]; then
  echo "   └─ halted: absent credentials"
  echo ""
  echo "🐈 wet paws..."
  echo ""
  echo "⛵ provision.terraform"
  echo "   ├─ absent credentials from profile $AWS_PROFILE_NAME"
  echo "   └─ hint: aws sso login --profile $AWS_PROFILE_NAME"
  exit 1
fi

eval "$CREDS"
unset AWS_PROFILE AWS_DEFAULT_PROFILE

# add -auto-approve if --approve was passed
if [[ "$APPROVE" == "true" ]]; then
  TERRAFORM_ARGS+=("-auto-approve")
fi

# run terraform in a treestruct sub.bucket, under the tree's closing item.
#
# it carried a forward-contract exemption — output a caller greps, hence left at column
# 0. that claim went unverified until it was checked, and it is false: NO caller reads
# this skill's stdout. the org-wide search found not one workflow, command, or consumer
# that pipes it, and the one schema-adjacent workflow that does grep a plan log
# (.sql-schema-control.yml) runs its tool directly instead. an exemption with no consumer
# protects nothing, and costs the delineation the frame exists to give
# (rule.require.nest-subskill-output-in-buckets, `.verify the contract`).
#
# `|| exit $?` is mandatory: the child runs in a pipe, so a bare call would not trip
# set -e and a failed apply would read as a success.
cd "$ENVIRONMENTS_DIR/$ENV_DIR"
echo "   └─ run terraform..."
run_sub_bucket "      " terraform "${TERRAFORM_ARGS[@]}" || exit $?

echo ""
echo "🐈 smooth sailin!"
echo ""
echo "⛵ provision.terraform --env $ENV ${TERRAFORM_ARGS[*]}"
echo "   └─ provisioned"
