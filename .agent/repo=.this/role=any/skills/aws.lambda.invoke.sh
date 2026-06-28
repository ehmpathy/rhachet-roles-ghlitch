#!/usr/bin/env bash
######################################################################
# .what = invoke test lambdas to generate CloudWatch log groups
#
# .why  = integration tests need real log groups to query:
#         - invokes all test lambdas in account=demo
#         - generates CloudWatch log groups for each
#         - enables aws.cloudwatch.logs.query integration tests
#
# usage:
#   rhx aws.lambda.invoke                    # invoke all test lambdas
#   rhx aws.lambda.invoke --lambda echo      # invoke specific lambda
#   rhx aws.lambda.invoke help
#
# guarantee:
#   - unlocks keyrack for test env
#   - invokes each lambda with test payload
#   - fail-fast on errors
######################################################################
set -euo pipefail

# parse args
LAMBDA_FILTER=""
while [[ $# -gt 0 ]]; do
  case $1 in
    --lambda)
      LAMBDA_FILTER="$2"
      shift 2
      ;;
    --skill|--role|--repo)
      # ignore rhachet internal args
      shift 2
      ;;
    help|--help|-h)
      echo "aws.lambda.invoke — invoke test lambdas to generate CloudWatch logs"
      echo ""
      echo "usage:"
      echo "  rhx aws.lambda.invoke                    # invoke all test lambdas"
      echo "  rhx aws.lambda.invoke --lambda echo      # invoke specific lambda"
      echo ""
      echo "lambdas:"
      echo "  rhachet-roles-ghlitch-test-echo"
      echo "  rhachet-roles-ghlitch-prep-echo"
      echo "  svc-ghlitch-demo-dev-echo"
      exit 0
      ;;
    *)
      echo "error: unknown arg: $1" >&2
      exit 2
      ;;
  esac
done

# source aws credentials from keyrack
echo "unlock keyrack..."
rhx keyrack unlock --owner ehmpath --env test
export AWS_PROFILE=$(rhx keyrack get --owner ehmpath --env test --key AWS_PROFILE --value)

# define test lambdas
LAMBDAS=(
  "rhachet-roles-ghlitch-test-echo"
  "rhachet-roles-ghlitch-prep-echo"
  "svc-ghlitch-demo-dev-echo"
)

# temp file for output
TMPFILE=$(mktemp)
trap "rm -f $TMPFILE" EXIT

echo ""
echo "invoke test lambdas..."

for lambda in "${LAMBDAS[@]}"; do
  # filter if specified
  if [[ -n "$LAMBDA_FILTER" && "$lambda" != *"$LAMBDA_FILTER"* ]]; then
    continue
  fi

  echo "  - $lambda"
  aws lambda invoke \
    --function-name "$lambda" \
    --payload '{"message":"test invocation","timestamp":"'"$(date -Iseconds)"'"}' \
    --cli-binary-format raw-in-base64-out \
    "$TMPFILE" >/dev/null

  # show response
  echo "    $(cat "$TMPFILE")"
done

echo ""
echo "done! log groups created in CloudWatch."
