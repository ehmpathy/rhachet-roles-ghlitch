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

# parse arguments
ENV=""
while [[ $# -gt 0 ]]; do
  case $1 in
    --env)
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

echo "🐈 chartin course..."
echo ""
echo "⛵ deploy --env $ENV"
echo "   └─ env: $ENV"
echo ""

# source aws credentials from keyrack
AWS_PROFILE=$(rhx keyrack get --owner ehmpath --env "$ENV" --key AWS_PROFILE --value || echo "")
if [[ -z "$AWS_PROFILE" ]]; then
  echo "🐈 wet paws..."
  echo ""
  echo "⛵ deploy"
  echo "   ├─ absent AWS_PROFILE from keyrack for env=$ENV"
  echo "   └─ hint: rhx keyrack unlock --owner ehmpath --env $ENV"
  exit 1
fi

# export credentials from SSO profile
echo "   export credentials from: $AWS_PROFILE"
if ! eval "$(aws configure export-credentials --profile "$AWS_PROFILE" --format env)"; then
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

echo ""
echo "   deploy with ACCESS=$ACCESS"
echo ""

if [[ "$ENV" == "prod" ]]; then
  npm run deploy:prod
else
  npm run deploy:dev
fi

echo ""
echo "🐈 smooth sailin!"
echo ""
echo "⛵ deploy --env $ENV"
echo "   └─ deployed to $ENV"
