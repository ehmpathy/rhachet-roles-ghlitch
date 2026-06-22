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

# parse arguments (filter out rhachet passthrough and --env)
ENV=""
APPROVE=false
TERRAFORM_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env)
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

    # failfast if both exist (ambiguous)
    if [[ "$HAS_DEV_DIR" == "true" && "$HAS_PREP_DIR" == "true" ]]; then
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
  echo "🐈 belay that..."
  echo ""
  echo "⛵ provision.terraform"
  echo "   ├─ directory not found: $ENVIRONMENTS_DIR/$ENV_DIR"
  echo "   └─ ensure terraform environment is configured"
  exit 2
fi

# output header
echo "🐈 chartin course..."
echo ""
echo "⛵ provision.terraform --env $ENV ${TERRAFORM_ARGS[*]}"
echo "   ├─ env: $ENV"
echo "   ├─ dir: $ENV_DIR"
echo "   └─ cmd: terraform ${TERRAFORM_ARGS[*]}"
echo ""

# get AWS profile from keyrack
AWS_PROFILE_NAME=$(rhx keyrack get --key AWS_PROFILE --env "$ENV" --owner ehmpath --value || echo "")
if [[ -z "$AWS_PROFILE_NAME" ]]; then
  echo "🐈 wet paws..."
  echo ""
  echo "⛵ provision.terraform"
  echo "   ├─ absent AWS_PROFILE from keyrack for env=$ENV"
  echo "   └─ hint: rhx keyrack unlock --owner ehmpath --env $ENV"
  exit 1
fi

# export credentials from AWS SSO profile
echo "   export credentials from: $AWS_PROFILE_NAME"
CREDS=$(aws configure export-credentials --profile "$AWS_PROFILE_NAME" --format env || echo "")
if [[ -z "$CREDS" ]]; then
  echo "🐈 wet paws..."
  echo ""
  echo "⛵ provision.terraform"
  echo "   ├─ absent credentials from profile $AWS_PROFILE_NAME"
  echo "   └─ hint: aws sso login --profile $AWS_PROFILE_NAME"
  exit 1
fi

eval "$CREDS"
unset AWS_PROFILE AWS_DEFAULT_PROFILE

echo ""
echo "   run terraform..."
echo ""

# add -auto-approve if --approve was passed
if [[ "$APPROVE" == "true" ]]; then
  TERRAFORM_ARGS+=("-auto-approve")
fi

# run terraform in the target directory
cd "$ENVIRONMENTS_DIR/$ENV_DIR"
terraform "${TERRAFORM_ARGS[@]}"

echo ""
echo "🐈 smooth sailin!"
echo ""
echo "⛵ provision.terraform --env $ENV ${TERRAFORM_ARGS[*]}"
echo "   └─ provisioned"
