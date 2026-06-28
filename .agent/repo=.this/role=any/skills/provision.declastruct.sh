#!/usr/bin/env bash
######################################################################
# .what = provision aws infrastructure via declastruct
#
# .why  = enables aws resource deployment without manual steps:
#         - unlocks keyrack for credentials
#         - runs declastruct plan/apply
#         - handles temp directory creation
#
# usage:
#   rhx provision.declastruct --wish provision/aws.infra/account=demo/resources.ts --mode plan
#   rhx provision.declastruct --wish provision/aws.infra/account=demo/resources.ts --mode apply
#
# guarantee:
#   - unlocks keyrack for test env
#   - creates .temp directory if absent
#   - runs declastruct plan or apply
#   - fail-fast on errors
######################################################################
set -euo pipefail

# parse args
WISH_FILE=""
MODE="plan"
while [[ $# -gt 0 ]]; do
  case $1 in
    --wish)
      WISH_FILE="$2"
      shift 2
      ;;
    --mode)
      MODE="$2"
      shift 2
      ;;
    --skill|--role|--repo)
      # ignore rhachet internal args
      shift 2
      ;;
    help|--help|-h)
      echo "provision.declastruct — provision aws resources via declastruct"
      echo ""
      echo "usage:"
      echo "  rhx provision.declastruct --wish <path> --mode plan"
      echo "  rhx provision.declastruct --wish <path> --mode apply"
      echo ""
      echo "options:"
      echo "  --wish   path to resources.ts file (required)"
      echo "  --mode   plan or apply (default: plan)"
      exit 0
      ;;
    *)
      echo "error: unknown arg: $1" >&2
      exit 2
      ;;
  esac
done

# validate
if [[ -z "$WISH_FILE" ]]; then
  echo "error: --wish required" >&2
  exit 2
fi

if [[ ! -f "$WISH_FILE" ]]; then
  echo "error: $WISH_FILE not found" >&2
  exit 2
fi

if [[ "$MODE" != "plan" && "$MODE" != "apply" ]]; then
  echo "error: --mode must be 'plan' or 'apply'" >&2
  exit 2
fi

# derive paths
WISH_DIR="$(dirname "$WISH_FILE")"
TEMP_DIR="$WISH_DIR/.temp"
PLAN_FILE="$TEMP_DIR/plan.json"

# ensure temp dir exists
mkdir -p "$TEMP_DIR"

# unlock keyrack for test env (credentials sourced by resources.ts)
echo "unlock keyrack..."
rhx keyrack unlock --owner ehmpath --env test

if [[ "$MODE" == "plan" ]]; then
  echo "plan $WISH_FILE..."
  npx declastruct plan --wish "$WISH_FILE" --into "$PLAN_FILE"
  echo ""
  echo "plan saved: $PLAN_FILE"
  echo ""
  echo "to apply:"
  echo "  rhx provision.declastruct --wish $WISH_FILE --mode apply"
else
  # apply mode
  if [[ ! -f "$PLAN_FILE" ]]; then
    echo "error: plan file not found at $PLAN_FILE" >&2
    echo "run with --mode plan first" >&2
    exit 2
  fi

  echo "apply $PLAN_FILE..."
  npx declastruct apply --plan "$PLAN_FILE"
  echo ""
  echo "done!"
fi
