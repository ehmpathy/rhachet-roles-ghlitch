/**
 * .what = evaluate Lambda expenses by analyzing invocations, duration, and costs
 * .why = provide a comprehensive view of Lambda spending per function
 */
import { asCommand } from '@ehmpathy/as-command';
import Bottleneck from 'bottleneck';
import { basename, join } from 'path';
import { generateLogMethods } from 'simple-leveled-log-methods';
import { getAwsAccountInfo } from '../domain/operations/getAwsAccountInfo';
import { listLambdaFunctions } from '../domain/operations/listLambdaFunctions';
import { getCloudWatchMetrics } from '../domain/operations/getCloudWatchMetrics';
import { getCostExplorerData } from '../domain/operations/getCostExplorerData';
import { calculateLambdaCost } from '../domain/operations/calculateLambdaCost';
import { queryLambdaMemoryUsage } from '../domain/operations/queryLambdaMemoryUsage';
import { LambdaExpense } from '../domain/objects/LambdaExpense';
import { LambdaExpenseEvaluation } from '../domain/objects/LambdaExpenseEvaluation';

const log = generateLogMethods();

// npx tsx src/roles/budgeter/skills/aws.lambda/getLambdaExpenseEvaluator.ts
export const command = asCommand(
  {
    name: basename(__filename, '.ts'),
    purpose:
      'evaluate Lambda expenses by analyzing invocations, duration, and costs',
    stage: process.env.STAGE || 'local',
    dir: join(__dirname, '.rhachet'),
    log,
  },
  async (input: { days?: number; threshold?: number }, context) => {
    const daysLookback = input.days ?? 30;
    const memoryQueryThreshold = input.threshold ?? 1;

    context.log.info('🌊 evaluating Lambda expenses...', {});

    // step 1: get AWS account info
    context.log.info('🔑 step 1: getting AWS account info...', {});
    const account = getAwsAccountInfo({}, context);

    // calculate date ranges
    const periodSince = new Date(
      Date.now() - daysLookback * 24 * 60 * 60 * 1000,
    )
      .toISOString()
      .split('T')[0]!;
    const periodUptil = new Date().toISOString().split('T')[0]!;

    context.log.info(`🌿 lookback period: ${daysLookback} days`, {});
    context.log.info(
      `🔭 analysis period: ${periodSince} to ${periodUptil}`,
      {},
    );

    // step 2: list Lambda functions
    context.log.info('🔭 step 2: listing Lambda functions...', {});
    const allFunctions = listLambdaFunctions({}, context);

    if (allFunctions.length === 0) {
      context.log.warn('🍂 no Lambda functions found.', {});
      return {
        evaluation: null,
        message: 'No Lambda functions found in this AWS account/region',
      };
    }

    // step 3: get CloudWatch metrics for all functions
    context.log.info('🔭 step 3: querying CloudWatch metrics...', {});
    const metricsData = getCloudWatchMetrics({ daysLookback }, context);

    // step 4: get Cost Explorer data
    context.log.info('🔭 step 4: querying Cost Explorer...', {});
    const costExplorerData = getCostExplorerData(
      { accountId: account.id, periodSince, periodUptil },
      context,
    );

    // step 5: filter functions with usage (>1 minute total duration)
    context.log.info(
      '🔭 step 5: filtering functions by duration threshold (>1 minute total)...',
      {},
    );

    const functionsWithMetrics = allFunctions
      .map((fn) => {
        const invocations = metricsData.invocations[fn.functionName] ?? 0;
        const durationAvgMs = metricsData.durations[fn.functionName] ?? 0;
        const totalDurationMinutes = (durationAvgMs * invocations) / 1000 / 60;

        return {
          fn,
          invocations,
          durationAvgMs,
          totalDurationMinutes,
        };
      })
      .filter((item) => item.invocations > 0 && item.totalDurationMinutes > 1);

    context.log.info(
      `✨ filtered to ${functionsWithMetrics.length} functions with >1 minute total duration`,
      {},
    );

    // step 6: analyze each function (with memory usage for expensive ones)
    context.log.info('🔭 step 6: analyzing Lambda functions...', {});

    const bottleneck = new Bottleneck({ maxConcurrent: 3 });

    const expenses: LambdaExpense[] = await Promise.all(
      functionsWithMetrics.map(
        bottleneck.wrap(
          async (item: {
            fn: (typeof functionsWithMetrics)[0]['fn'];
            invocations: number;
            durationAvgMs: number;
          }) => {
            const { fn, invocations, durationAvgMs } = item;
            const errors = metricsData.errors[fn.functionName] ?? 0;

            // calculate cost
            const cost = calculateLambdaCost({ fn, invocations, durationAvgMs });

            // query memory usage if cost exceeds threshold
            let memoryMaxUsedMb: number | undefined;
            let memoryUtilPct: number | undefined;

            if (cost.monthlyCost > memoryQueryThreshold) {
              memoryMaxUsedMb = await queryLambdaMemoryUsage(
                { functionName: fn.functionName, daysLookback },
                context,
              );

              if (memoryMaxUsedMb !== undefined) {
                memoryUtilPct = (memoryMaxUsedMb * 100) / fn.memorySize;
                context.log.info(
                  `  ✅ ${fn.functionName}: max memory ${memoryMaxUsedMb}MB (${memoryUtilPct.toFixed(2)}%)`,
                  {},
                );
              }
            }

            return new LambdaExpense({
              functionName: fn.functionName,
              runtime: fn.runtime,
              architecture: fn.architectures[0] ?? 'x86_64',
              memoryMb: fn.memorySize,
              memoryMaxUsedMb,
              memoryUtilPct,
              timeoutSeconds: fn.timeout,
              invocations,
              durationAvgMs,
              durationSumMs: durationAvgMs * invocations,
              errors,
              gbSeconds: cost.gbSeconds,
              requestCost: cost.requestCost,
              computeCost: cost.computeCost,
              monthlyCost: cost.monthlyCost,
            });
          },
        ),
      ),
    );

    // step 7: calculate aggregate statistics
    context.log.info('🔭 step 7: calculating summary statistics...', {});

    const totalInvocations = expenses.reduce(
      (sum, exp) => sum + exp.invocations,
      0,
    );
    const totalGbSeconds = expenses.reduce(
      (sum, exp) => sum + exp.gbSeconds,
      0,
    );
    const totalRequestCost = expenses.reduce(
      (sum, exp) => sum + exp.requestCost,
      0,
    );
    const totalComputeCost = expenses.reduce(
      (sum, exp) => sum + exp.computeCost,
      0,
    );
    const totalMonthlyCost = expenses.reduce(
      (sum, exp) => sum + exp.monthlyCost,
      0,
    );

    const x86Count = expenses.filter((exp) => exp.architecture === 'x86_64')
      .length;
    const armCount = expenses.filter((exp) => exp.architecture === 'arm64')
      .length;

    // step 8: create evaluation report
    const evaluation = new LambdaExpenseEvaluation({
      account,
      evaluationDate: new Date().toISOString(),
      period: {
        days: daysLookback,
        from: periodSince,
        to: periodUptil,
      },
      memoryQueryThreshold,
      summary: {
        totalFunctions: allFunctions.length,
        functionsWithUsage: expenses.length,
        totalInvocations,
        totalGbSeconds,
        architecture: {
          x86_64: x86Count,
          arm64: armCount,
        },
      },
      costs: {
        requestCost: totalRequestCost,
        computeCost: totalComputeCost,
        totalMonthlyCost,
        serviceCostFromExplorer: costExplorerData.totalCost,
        currency: costExplorerData.currency,
      },
      functions: expenses.sort((a, b) => b.monthlyCost - a.monthlyCost),
    });

    // step 9: write output files
    await context.out.write({
      name: 'expenses.json',
      data: JSON.stringify(evaluation, null, 2),
    });

    await context.out.write({
      name: 'expenses.md',
      data: generateMarkdownReport(evaluation),
    });

    // step 10: display summary
    context.log.info('🌊 Lambda Expense Evaluation Complete', {});
    context.log.info('', {});
    context.log.info('📊 Overview:', {});
    context.log.info(`   - Total functions: ${allFunctions.length}`, {});
    context.log.info(`   - Functions with usage: ${expenses.length}`, {});
    context.log.info(
      `   - Total invocations: ${totalInvocations.toFixed(0)}`,
      {},
    );
    context.log.info('', {});
    context.log.info('💰 Costs:', {});
    context.log.info(
      `   - Request cost: $${totalRequestCost.toFixed(4)}/month`,
      {},
    );
    context.log.info(
      `   - Compute cost: $${totalComputeCost.toFixed(4)}/month`,
      {},
    );
    context.log.info(
      `   - Total analyzed cost: $${totalMonthlyCost.toFixed(2)}/month`,
      {},
    );
    context.log.info(
      `   - Service cost (Cost Explorer): $${costExplorerData.totalCost.toFixed(2)}/month`,
      {},
    );
    context.log.info('', {});
    context.log.info('🏗️  Architecture:', {});
    context.log.info(`   - x86_64: ${x86Count} functions`, {});
    context.log.info(`   - arm64: ${armCount} functions`, {});
    context.log.info('', {});
    context.log.info('✨ Done!', {});

    return { evaluation };
  },
);

// helper function to generate markdown report
const generateMarkdownReport = (evaluation: LambdaExpenseEvaluation): string => {
  const lines: string[] = [];

  lines.push('# Lambda Expenses');
  lines.push('');
  lines.push(`**Account**: ${evaluation.account.display}`);
  lines.push(
    `**Period**: ${evaluation.period.from} to ${evaluation.period.to} (${evaluation.period.days} days)`,
  );
  lines.push(`**Generated**: ${evaluation.evaluationDate}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Total Functions: ${evaluation.summary.totalFunctions}`);
  lines.push(`- Functions with Usage: ${evaluation.summary.functionsWithUsage}`);
  lines.push(
    `- Total Invocations: ${evaluation.summary.totalInvocations.toFixed(0)}`,
  );
  lines.push(
    `- Total GB-Seconds: ${evaluation.summary.totalGbSeconds.toFixed(2)}`,
  );
  lines.push(
    `- Total Monthly Cost: $${evaluation.costs.totalMonthlyCost.toFixed(2)}`,
  );
  lines.push(
    `- Architecture: ${evaluation.summary.architecture.x86_64} x86_64, ${evaluation.summary.architecture.arm64} arm64`,
  );
  lines.push('');
  lines.push('## Expenses by Function');
  lines.push('');

  // prepare table data
  const headers = [
    'Function Name',
    'Invocations',
    'Avg Duration',
    'Total Duration',
    'Memory',
    'Max Used',
    'Arch',
    'Monthly Cost',
  ];

  const rows = evaluation.functions.map((fn) => {
    const avgDuration = msToHhMmSs(fn.durationAvgMs);
    const totalDuration = msToHhMmSs(fn.durationSumMs);
    const maxUsed = fn.memoryMaxUsedMb
      ? `${fn.memoryMaxUsedMb.toFixed(0)}MB (${fn.memoryUtilPct!.toFixed(0)}%)`
      : 'N/A';

    return [
      fn.functionName,
      fn.invocations.toFixed(0),
      avgDuration,
      totalDuration,
      `${fn.memoryMb}MB`,
      maxUsed,
      fn.architecture,
      `$${fn.monthlyCost.toFixed(2)}`,
    ];
  });

  // calculate column widths based on headers and all rows
  const columnWidths = headers.map((header, colIndex) => {
    const headerWidth = header.length;
    const maxDataWidth = Math.max(
      ...rows.map((row) => row[colIndex]!.length),
      0,
    );
    return Math.max(headerWidth, maxDataWidth);
  });

  // pad string to specified width
  const padRight = (str: string, width: number): string => {
    return str + ' '.repeat(Math.max(0, width - str.length));
  };

  // generate header row
  const headerRow =
    '| ' +
    headers.map((h, i) => padRight(h, columnWidths[i]!)).join(' | ') +
    ' |';
  lines.push(headerRow);

  // generate separator row
  const separatorRow =
    '| ' +
    columnWidths.map((w) => '-'.repeat(w)).join(' | ') +
    ' |';
  lines.push(separatorRow);

  // generate data rows
  for (const row of rows) {
    const dataRow =
      '| ' + row.map((cell, i) => padRight(cell, columnWidths[i]!)).join(' | ') + ' |';
    lines.push(dataRow);
  }

  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('*Notes:*');
  lines.push(
    '- *Costs calculated using on-demand Lambda pricing. Does not account for free tier.*',
  );
  lines.push(
    `- *Max Used memory queried from CloudWatch Logs for functions costing >$${evaluation.memoryQueryThreshold}/month.*`,
  );

  return lines.join('\n');
};

// helper function to convert milliseconds to hh:mm:ss
const msToHhMmSs = (ms: number): string => {
  const seconds = Math.floor(ms / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)}`;
};

// execute the command when run directly
// npx tsx src/roles/budgeter/skills/aws.lambda/src/commands/getLambdaExpenseEvaluator.ts
if (require.main === module) {
  // parse command line arguments
  const args = process.argv.slice(2);
  const parsedArgs: { days?: number; threshold?: number } = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--days' && args[i + 1]) {
      parsedArgs.days = parseInt(args[i + 1]!, 10);
      i++;
    } else if (args[i] === '--threshold' && args[i + 1]) {
      parsedArgs.threshold = parseFloat(args[i + 1]!);
      i++;
    }
  }

  void command(parsedArgs);
}
