#!/bin/bash
# .what = set retention policies for CloudWatch log groups
# .why = manage log retention to control costs and comply with policies

set -euo pipefail

# parse arguments
MODE="prep"
DAYS=90

while [[ $# -gt 0 ]]; do
  case $1 in
    --mode)
      MODE="$2"
      shift 2
      ;;
    --days)
      DAYS="$2"
      shift 2
      ;;
    *)
      echo "Error: Unknown argument: $1"
      echo "Usage: $0 [--mode <prep|exec>] [--days <retention-days>]"
      exit 1
      ;;
  esac
done

# validate mode
if [[ "$MODE" != "prep" && "$MODE" != "exec" ]]; then
  echo "Error: --mode must be either 'prep' or 'exec'"
  echo "Usage: $0 [--mode <prep|exec>] [--days <retention-days>]"
  exit 1
fi

# execute the TypeScript command
npx tsx "$(dirname "$0")/src/contract/commands/setRetentionPolicies.ts" --mode="$MODE" --days="$DAYS"
