#!/bin/bash
# .what = get CloudWatch log ingestion expenses
# .why = identify most expensive log groups by ingestion volume

set -euo pipefail

# parse arguments
DAYS=30
ACTUAL_COST=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --days)
      DAYS="$2"
      shift 2
      ;;
    --actualCost)
      ACTUAL_COST="$2"
      shift 2
      ;;
    *)
      echo "Error: Unknown argument: $1"
      echo "Usage: $0 [--days <lookback-days>] [--actualCost <total-cost>]"
      exit 1
      ;;
  esac
done

# build command arguments
CMD_ARGS="--days=$DAYS"
if [[ -n "$ACTUAL_COST" ]]; then
  CMD_ARGS="$CMD_ARGS --actualCost=$ACTUAL_COST"
fi

# execute the TypeScript command
npx tsx "$(dirname "$0")/src/contract/commands/getIngestionExpenses.ts" $CMD_ARGS
