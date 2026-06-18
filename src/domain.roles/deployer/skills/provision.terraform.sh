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
#   rhx provision.terraform --env prep init
#   rhx provision.terraform --env prep plan
#   rhx provision.terraform --env prep apply
#   rhx provision.terraform --env prod plan
#   rhx provision.terraform --env prod apply
#   rhx provision.terraform help
#
# options:
#   --env ENV     environment: test, prep, or prod (required)
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
  echo "  rhx provision.terraform --env <env> <terraform-args>"
  echo ""
  echo "options:"
  echo "  --env    environment: test, prep, or prod"
  echo ""
  echo "examples:"
  echo "  rhx provision.terraform --env prep init"
  echo "  rhx provision.terraform --env prep plan"
  echo "  rhx provision.terraform --env prod apply"
  exit 0
fi

# clear extant AWS_PROFILE to avoid interference
unset AWS_PROFILE 2>/dev/null || true

# parse arguments (filter out rhachet passthrough and --env)
ENV=""
TERRAFORM_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env)
      ENV="$2"
      shift 2
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
      echo "  rhx provision.terraform --env <env> <terraform-args>"
      echo ""
      echo "options:"
      echo "  --env    environment: test, prep, or prod"
      echo ""
      echo "examples:"
      echo "  rhx provision.terraform --env prep init"
      echo "  rhx provision.terraform --env prep plan"
      echo "  rhx provision.terraform --env prod apply"
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
  echo "   └─ example: rhx provision.terraform --env prep plan"
  exit 2
fi

# map env to directory name (prep -> dev for backwards compat)
case "$ENV" in
  test) ENV_DIR="test" ;;
  prep) ENV_DIR="dev" ;;
  prod) ENV_DIR="prod" ;;
esac

# find repo root and environments directory
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo ".")
ENVIRONMENTS_DIR="$REPO_ROOT/provision/aws/environments"

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
AWS_PROFILE_NAME=$(rhx keyrack get --key AWS_PROFILE --env "$ENV" --owner ehmpath --value 2>/dev/null || echo "")
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
CREDS=$(aws configure export-credentials --profile "$AWS_PROFILE_NAME" --format env 2>/dev/null || echo "")
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

# run terraform in the target directory
cd "$ENVIRONMENTS_DIR/$ENV_DIR"
terraform "${TERRAFORM_ARGS[@]}"

echo ""
echo "🐈 smooth sailin!"
echo ""
echo "⛵ provision.terraform --env $ENV ${TERRAFORM_ARGS[*]}"
echo "   └─ provisioned"
