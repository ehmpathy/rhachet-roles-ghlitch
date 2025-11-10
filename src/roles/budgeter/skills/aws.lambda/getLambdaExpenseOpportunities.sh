#!/bin/bash
# .what = analyze Lambda expenses and identify cost optimization opportunities
# .why = provide actionable recommendations for reducing Lambda costs through rightsizing and architecture changes

set -euo pipefail

# parse arguments
EXPENSES_JSON=""
OUTPUT_DIR=""
MIN_SAVINGS_THRESHOLD=1.00  # minimum monthly savings to recommend (default $1/month)

while [[ $# -gt 0 ]]; do
  case $1 in
    --expenses)
      EXPENSES_JSON="$2"
      shift 2
      ;;
    --output)
      OUTPUT_DIR="$2"
      shift 2
      ;;
    --min-savings)
      MIN_SAVINGS_THRESHOLD="$2"
      shift 2
      ;;
    *)
      echo "⛈️  Error: Unknown argument: $1"
      echo "Usage: $0 --expenses <expenses.json> [--output <directory>] [--min-savings <amount>]"
      exit 1
      ;;
  esac
done

# validate required arguments
if [[ -z "$EXPENSES_JSON" ]]; then
  echo "⛈️  Error: --expenses argument is required"
  echo "Usage: $0 --expenses <expenses.json> [--output <directory>] [--min-savings <amount>]"
  exit 1
fi

if [[ ! -f "$EXPENSES_JSON" ]]; then
  echo "⛈️  Error: Expenses file not found: $EXPENSES_JSON"
  exit 1
fi

echo "🔭 Analyzing Lambda cost optimization opportunities..."
echo "📂 Expenses file: $EXPENSES_JSON"
echo ""

# set default output directory if not specified (same directory as input file)
if [[ -z "$OUTPUT_DIR" ]]; then
  OUTPUT_DIR="$(dirname "$EXPENSES_JSON")"
fi

# ensure output directory exists
mkdir -p "$OUTPUT_DIR"

# define output file paths
OPPORTUNITIES_JSON_FILE="${OUTPUT_DIR}/opportunities.json"
OPPORTUNITIES_MD_FILE="${OUTPUT_DIR}/opportunities.md"

# load expenses data
EXPENSES_DATA=$(cat "$EXPENSES_JSON")

# extract metadata
ACCOUNT_DISPLAY=$(echo "$EXPENSES_DATA" | jq -r '.account.display')
PERIOD_FROM=$(echo "$EXPENSES_DATA" | jq -r '.period.from')
PERIOD_TO=$(echo "$EXPENSES_DATA" | jq -r '.period.to')
PERIOD_DAYS=$(echo "$EXPENSES_DATA" | jq -r '.period.days')

# extract summary
TOTAL_FUNCTIONS=$(echo "$EXPENSES_DATA" | jq -r '.summary.total_functions')
FUNCTIONS_WITH_USAGE=$(echo "$EXPENSES_DATA" | jq -r '.summary.functions_with_usage')
TOTAL_MONTHLY_COST=$(echo "$EXPENSES_DATA" | jq -r '.costs.total_monthly_cost')

echo "📊 Account: $ACCOUNT_DISPLAY"
echo "📊 Functions with usage: $FUNCTIONS_WITH_USAGE"
echo "📊 Total monthly cost: \$$(printf "%.2f" "$TOTAL_MONTHLY_COST")"
echo ""

# pricing constants (per https://aws.amazon.com/lambda/pricing/)
COMPUTE_PRICE_X86=0.0000166667       # $0.0000166667 per GB-second (x86)
COMPUTE_PRICE_ARM=0.0000133334       # $0.0000133334 per GB-second (ARM/Graviton - 20% cheaper)
ARM_DISCOUNT=0.20                     # 20% discount for ARM vs x86

# analyze each function for optimization opportunities
echo "🔭 Analyzing optimization opportunities..."
echo ""

# create temporary file for opportunities
OPPORTUNITIES_TEMP="${OUTPUT_DIR}/opportunities_temp.jsonl"
rm -f "$OPPORTUNITIES_TEMP"

# process each function
echo "$EXPENSES_DATA" | jq -c '.functions[]' | while IFS= read -r FUNCTION; do
  FUNCTION_NAME=$(echo "$FUNCTION" | jq -r '.function_name')
  RUNTIME=$(echo "$FUNCTION" | jq -r '.runtime')
  ARCHITECTURE=$(echo "$FUNCTION" | jq -r '.architecture')
  MEMORY_MB=$(echo "$FUNCTION" | jq -r '.memory_mb')
  INVOCATIONS=$(echo "$FUNCTION" | jq -r '.invocations')
  AVG_DURATION_MS=$(echo "$FUNCTION" | jq -r '.avg_duration_ms')
  MONTHLY_COST=$(echo "$FUNCTION" | jq -r '.monthly_cost')
  COMPUTE_COST=$(echo "$FUNCTION" | jq -r '.compute_cost')
  GB_SECONDS=$(echo "$FUNCTION" | jq -r '.gb_seconds')

  # skip functions with no cost
  if (( $(echo "$MONTHLY_COST == 0" | bc -l) )); then
    continue
  fi

  echo "  ⚡ $FUNCTION_NAME (\$$(printf "%.4f" "$MONTHLY_COST")/mo)"

  OPPORTUNITIES=()
  TOTAL_SAVINGS=0

  # === Opportunity 1: Memory Rightsizing ===
  # Conservative estimate: assume 70% memory utilization for well-optimized functions
  # Recommend reducing if we estimate < 60% utilization
  ESTIMATED_MEMORY_USED=$(echo "scale=0; $MEMORY_MB * 0.7" | bc)
  MEMORY_UTILIZATION=$(echo "scale=2; 0.7 * 100" | bc)  # 70%

  MEMORY_OPPORTUNITY=""
  RECOMMENDED_MEMORY=$MEMORY_MB
  MEMORY_SAVINGS=0

  # Only recommend rightsizing if current memory is > 512MB (conservative)
  # and we estimate it's over-provisioned
  if (( $(echo "$MEMORY_UTILIZATION < 60" | bc -l) )) && (( $(echo "$MEMORY_MB > 512" | bc -l) )); then
    # Recommend 50% reduction (conservative)
    RECOMMENDED_MEMORY=$(echo "scale=0; $MEMORY_MB * 0.5" | bc)
    # Round to nearest 64MB increment
    RECOMMENDED_MEMORY=$(echo "scale=0; (($RECOMMENDED_MEMORY + 31) / 64) * 64" | bc)
    # Ensure minimum 128MB
    if (( $(echo "$RECOMMENDED_MEMORY < 128" | bc -l) )); then
      RECOMMENDED_MEMORY=128
    fi

    # Calculate savings (proportional to memory reduction)
    MEMORY_RATIO=$(echo "scale=6; $RECOMMENDED_MEMORY / $MEMORY_MB" | bc)
    NEW_COMPUTE_COST=$(echo "scale=6; $COMPUTE_COST * $MEMORY_RATIO" | bc)
    MEMORY_SAVINGS=$(echo "scale=6; $COMPUTE_COST - $NEW_COMPUTE_COST" | bc)

    if (( $(echo "$MEMORY_SAVINGS > 0.001" | bc -l) )); then
      MEMORY_OPPORTUNITY="rightsize"
      TOTAL_SAVINGS=$(echo "scale=6; $TOTAL_SAVINGS + $MEMORY_SAVINGS" | bc)
      echo "     💡 Memory: ${MEMORY_MB}MB → ${RECOMMENDED_MEMORY}MB (save \$$(printf "%.4f" "$MEMORY_SAVINGS")/mo)"
    fi
  fi

  # === Opportunity 2: Architecture Migration (x86 → ARM) ===
  ARCH_OPPORTUNITY=""
  ARCH_SAVINGS=0

  if [[ "$ARCHITECTURE" == "x86_64" ]]; then
    # Check if runtime supports ARM64
    if [[ "$RUNTIME" =~ ^(nodejs|python3|java|dotnet|ruby|provided) ]]; then
      ARCH_OPPORTUNITY="migrate_to_arm"

      # Calculate savings: 20% reduction in compute cost
      # Use the potentially optimized compute cost if memory was rightsized
      BASE_COMPUTE_COST=$COMPUTE_COST
      if (( $(echo "$MEMORY_SAVINGS > 0" | bc -l) )); then
        BASE_COMPUTE_COST=$(echo "scale=6; $COMPUTE_COST - $MEMORY_SAVINGS" | bc)
      fi

      ARCH_SAVINGS=$(echo "scale=6; $BASE_COMPUTE_COST * $ARM_DISCOUNT" | bc)
      TOTAL_SAVINGS=$(echo "scale=6; $TOTAL_SAVINGS + $ARCH_SAVINGS" | bc)

      echo "     💡 Arch: x86_64 → arm64 (save \$$(printf "%.4f" "$ARCH_SAVINGS")/mo)"
    fi
  fi

  # Only output if there are savings opportunities above threshold
  if (( $(echo "$TOTAL_SAVINGS >= 0.001" | bc -l) )); then
    # Create opportunity JSON
    OPPORTUNITY_JSON=$(jq -n \
      --arg function_name "$FUNCTION_NAME" \
      --arg runtime "$RUNTIME" \
      --arg architecture "$ARCHITECTURE" \
      --argjson current_memory "$MEMORY_MB" \
      --argjson monthly_cost "$MONTHLY_COST" \
      --argjson compute_cost "$COMPUTE_COST" \
      --arg memory_opportunity "$MEMORY_OPPORTUNITY" \
      --argjson recommended_memory "$RECOMMENDED_MEMORY" \
      --argjson memory_savings "$MEMORY_SAVINGS" \
      --arg arch_opportunity "$ARCH_OPPORTUNITY" \
      --argjson arch_savings "$ARCH_SAVINGS" \
      --argjson total_savings "$TOTAL_SAVINGS" \
      '{
        function_name: $function_name,
        runtime: $runtime,
        architecture: $architecture,
        current_memory_mb: $current_memory,
        monthly_cost: $monthly_cost,
        compute_cost: $compute_cost,
        opportunities: {
          memory: {
            opportunity: $memory_opportunity,
            recommended_memory_mb: $recommended_memory,
            monthly_savings: $memory_savings
          },
          architecture: {
            opportunity: $arch_opportunity,
            monthly_savings: $arch_savings
          }
        },
        total_monthly_savings: $total_savings,
        annual_savings: ($total_savings * 12)
      }')

    echo "$OPPORTUNITY_JSON" >> "$OPPORTUNITIES_TEMP"
    echo "     ✨ Total savings: \$$(printf "%.4f" "$TOTAL_SAVINGS")/mo"
  fi
done

echo ""
echo "✨ Analysis complete"
echo ""

# combine all opportunities into final JSON
if [[ -f "$OPPORTUNITIES_TEMP" ]]; then
  OPPORTUNITIES_ARRAY=$(jq -s '.' "$OPPORTUNITIES_TEMP")
else
  OPPORTUNITIES_ARRAY="[]"
fi

# calculate aggregate statistics
TOTAL_OPPORTUNITIES=$(echo "$OPPORTUNITIES_ARRAY" | jq 'length')
TOTAL_POTENTIAL_SAVINGS=$(echo "$OPPORTUNITIES_ARRAY" | jq '[.[].total_monthly_savings] | add // 0')
MEMORY_RIGHTSIZING_COUNT=$(echo "$OPPORTUNITIES_ARRAY" | jq '[.[] | select(.opportunities.memory.opportunity == "rightsize")] | length')
MEMORY_TOTAL_SAVINGS=$(echo "$OPPORTUNITIES_ARRAY" | jq '[.[] | select(.opportunities.memory.opportunity == "rightsize") | .opportunities.memory.monthly_savings] | add // 0')
ARM_MIGRATION_COUNT=$(echo "$OPPORTUNITIES_ARRAY" | jq '[.[] | select(.opportunities.architecture.opportunity == "migrate_to_arm")] | length')
ARM_TOTAL_SAVINGS=$(echo "$OPPORTUNITIES_ARRAY" | jq '[.[] | select(.opportunities.architecture.opportunity == "migrate_to_arm") | .opportunities.architecture.monthly_savings] | add // 0')

# write opportunities JSON
jq -n \
  --arg account_display "$ACCOUNT_DISPLAY" \
  --arg period_from "$PERIOD_FROM" \
  --arg period_to "$PERIOD_TO" \
  --argjson period_days "$PERIOD_DAYS" \
  --arg analysis_date "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --argjson total_functions "$TOTAL_FUNCTIONS" \
  --argjson functions_analyzed "$FUNCTIONS_WITH_USAGE" \
  --argjson total_monthly_cost "$TOTAL_MONTHLY_COST" \
  --argjson total_opportunities "$TOTAL_OPPORTUNITIES" \
  --argjson total_savings "$TOTAL_POTENTIAL_SAVINGS" \
  --argjson memory_count "$MEMORY_RIGHTSIZING_COUNT" \
  --argjson memory_savings "$MEMORY_TOTAL_SAVINGS" \
  --argjson arm_count "$ARM_MIGRATION_COUNT" \
  --argjson arm_savings "$ARM_TOTAL_SAVINGS" \
  --argjson opportunities "$OPPORTUNITIES_ARRAY" \
  '{
    account: $account_display,
    period: {
      from: $period_from,
      to: $period_to,
      days: $period_days
    },
    analysis_date: $analysis_date,
    summary: {
      total_functions: $total_functions,
      functions_analyzed: $functions_analyzed,
      total_monthly_cost: $total_monthly_cost,
      opportunities_found: $total_opportunities,
      total_monthly_savings: $total_savings,
      total_annual_savings: ($total_savings * 12)
    },
    by_type: {
      memory_rightsizing: {
        count: $memory_count,
        monthly_savings: $memory_savings,
        annual_savings: ($memory_savings * 12)
      },
      arm_migration: {
        count: $arm_count,
        monthly_savings: $arm_savings,
        annual_savings: ($arm_savings * 12)
      }
    },
    opportunities: $opportunities
  }' > "$OPPORTUNITIES_JSON_FILE"

echo "✨ Opportunities data written to: $OPPORTUNITIES_JSON_FILE"
echo ""

# write opportunities markdown
cat > "$OPPORTUNITIES_MD_FILE" << EOF
# Lambda Cost Optimization Opportunities

**Account**: $ACCOUNT_DISPLAY
**Period**: $PERIOD_FROM to $PERIOD_TO ($PERIOD_DAYS days)
**Generated**: $(date -u +%Y-%m-%dT%H:%M:%SZ)

## Executive Summary

- **Functions Analyzed**: $FUNCTIONS_WITH_USAGE
- **Current Monthly Cost**: \$$(printf "%.2f" "$TOTAL_MONTHLY_COST")
- **Optimization Opportunities**: $TOTAL_OPPORTUNITIES functions
- **Potential Savings**: \$$(printf "%.2f" "$TOTAL_POTENTIAL_SAVINGS")/month (\$$(printf "%.2f" "$(echo "$TOTAL_POTENTIAL_SAVINGS * 12" | bc)")/year)

## Opportunities by Type

### Memory Rightsizing
- **Functions**: $MEMORY_RIGHTSIZING_COUNT
- **Monthly Savings**: \$$(printf "%.2f" "$MEMORY_TOTAL_SAVINGS")
- **Annual Savings**: \$$(printf "%.2f" "$(echo "$MEMORY_TOTAL_SAVINGS * 12" | bc)")

### ARM/Graviton Migration
- **Functions**: $ARM_MIGRATION_COUNT
- **Monthly Savings**: \$$(printf "%.2f" "$ARM_TOTAL_SAVINGS")
- **Annual Savings**: \$$(printf "%.2f" "$(echo "$ARM_TOTAL_SAVINGS * 12" | bc)")

## Top Opportunities

EOF

# add top 20 opportunities table
echo "$OPPORTUNITIES_ARRAY" | jq -r '
  sort_by(-.total_monthly_savings) | .[0:20] |
  map("| \(.function_name) | \(.current_memory_mb)MB | \(.opportunities.memory.recommended_memory_mb)MB | \(.architecture) | $\(.total_monthly_savings | tonumber | . * 100 | round / 100) |") |
  .[]
' | {
  echo "| Function Name | Current Memory | Recommended Memory | Architecture | Monthly Savings |"
  echo "|---------------|----------------|-------------------|--------------|-----------------|"
  cat
} >> "$OPPORTUNITIES_MD_FILE"

cat >> "$OPPORTUNITIES_MD_FILE" << EOF

## Recommendations

### 1. Memory Rightsizing (${MEMORY_RIGHTSIZING_COUNT} functions)

EOF

if [[ "$MEMORY_RIGHTSIZING_COUNT" -gt 0 ]]; then
  cat >> "$OPPORTUNITIES_MD_FILE" << EOF
The following functions appear to be over-provisioned and could benefit from memory reduction:

EOF

  echo "$OPPORTUNITIES_ARRAY" | jq -r '
    map(select(.opportunities.memory.opportunity == "rightsize")) |
    sort_by(-.opportunities.memory.monthly_savings) |
    map("| \(.function_name) | \(.current_memory_mb)MB | \(.opportunities.memory.recommended_memory_mb)MB | $\(.opportunities.memory.monthly_savings | tonumber | . * 100 | round / 100) |") |
    .[]
  ' | {
    echo "| Function Name | Current | Recommended | Monthly Savings |"
    echo "|---------------|---------|-------------|-----------------|"
    cat
  } >> "$OPPORTUNITIES_MD_FILE"

  cat >> "$OPPORTUNITIES_MD_FILE" << EOF

**Action**: Update function memory using AWS Console or CLI:

\`\`\`bash
aws lambda update-function-configuration \\
  --function-name <function-name> \\
  --memory-size <recommended-memory-mb>
\`\`\`

**Note**: These recommendations are conservative estimates. Consider using Lambda Insights for actual memory usage data before making changes.

EOF
else
  cat >> "$OPPORTUNITIES_MD_FILE" << EOF
No memory rightsizing opportunities identified.

EOF
fi

cat >> "$OPPORTUNITIES_MD_FILE" << EOF

### 2. ARM/Graviton Migration (${ARM_MIGRATION_COUNT} functions)

EOF

if [[ "$ARM_MIGRATION_COUNT" -gt 0 ]]; then
  cat >> "$OPPORTUNITIES_MD_FILE" << EOF
The following functions can migrate to ARM (Graviton) for ~20% compute cost savings:

EOF

  echo "$OPPORTUNITIES_ARRAY" | jq -r '
    map(select(.opportunities.architecture.opportunity == "migrate_to_arm")) |
    sort_by(-.opportunities.architecture.monthly_savings) |
    map("| \(.function_name) | \(.runtime) | \(.architecture) | arm64 | $\(.opportunities.architecture.monthly_savings | tonumber | . * 100 | round / 100) |") |
    .[]
  ' | {
    echo "| Function Name | Runtime | Current | Recommended | Monthly Savings |"
    echo "|---------------|---------|---------|-------------|-----------------|"
    cat
  } >> "$OPPORTUNITIES_MD_FILE"

  cat >> "$OPPORTUNITIES_MD_FILE" << EOF

**Action**: Update function architecture using AWS Console or CLI:

\`\`\`bash
aws lambda update-function-configuration \\
  --function-name <function-name> \\
  --architectures arm64
\`\`\`

**Important**: Test thoroughly after migration, especially if using:
- Native dependencies or compiled code
- Docker images (must rebuild for arm64)
- Layers (must have arm64-compatible versions)

EOF
else
  cat >> "$OPPORTUNITIES_MD_FILE" << EOF
No ARM migration opportunities identified (all functions already on ARM or using unsupported runtimes).

EOF
fi

cat >> "$OPPORTUNITIES_MD_FILE" << EOF

## Implementation Priority

1. **Quick Wins** (< 1 hour): Top 5 ARM migrations (no code changes needed)
2. **Medium Effort** (1-2 days): Memory rightsizing with testing
3. **Ongoing**: Monthly review of new functions

## Next Steps

1. Review recommendations above
2. Test changes in development environment first
3. Monitor performance and errors after optimization
4. Run this analysis monthly to catch new opportunities

---

*Note: Savings estimates are based on current usage patterns and may vary. Memory recommendations use conservative estimates; enable Lambda Insights for more accurate data.*

EOF

echo "✨ Opportunities report written to: $OPPORTUNITIES_MD_FILE"
echo ""

# display summary
echo "🌊 Lambda Optimization Analysis Complete"
echo ""
echo "📊 Summary:"
echo "   - Functions analyzed: $FUNCTIONS_WITH_USAGE"
echo "   - Opportunities found: $TOTAL_OPPORTUNITIES"
echo "   - Memory rightsizing: $MEMORY_RIGHTSIZING_COUNT functions"
echo "   - ARM migration: $ARM_MIGRATION_COUNT functions"
echo ""
echo "💰 Savings Potential:"
echo "   - Monthly: \$$(printf "%.2f" "$TOTAL_POTENTIAL_SAVINGS")"
echo "   - Annual: \$$(printf "%.2f" "$(echo "$TOTAL_POTENTIAL_SAVINGS * 12" | bc)")"
echo ""
echo "✨ Done!"
echo ""
echo "🌿 Output files:"
echo "   - JSON: $OPPORTUNITIES_JSON_FILE"
echo "   - Markdown: $OPPORTUNITIES_MD_FILE"
echo ""

# clean up temp file
rm -f "$OPPORTUNITIES_TEMP"
