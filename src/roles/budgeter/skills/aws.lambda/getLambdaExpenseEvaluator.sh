#!/bin/bash
# .what = evaluate Lambda expenses by analyzing invocations, duration, and costs
# .why = provide a comprehensive view of Lambda spending per function
# .note = wrapper script that executes the TypeScript command

set -euo pipefail

# get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# execute the TypeScript command
exec npx tsx "${SCRIPT_DIR}/src/commands/getLambdaExpenseEvaluator.ts" "$@"
