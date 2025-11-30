/**
 * .what = evaluate Lambda expenses by analyzing invocations, duration, and costs
 * .why = provide a comprehensive view of Lambda spending per function
 */
import { asCommand } from '@ehmpathy/as-command';
import Bottleneck from 'bottleneck';
import { basename, join } from 'path';
import { generateLogMethods } from 'simple-leveled-log-methods';

import { LambdaExpense } from '../domain/objects/LambdaExpense';
import { LambdaExpenseEvaluation } from '../domain/objects/LambdaExpenseEvaluation';
import { calculateLambdaCost } from '../domain/operations/calculateLambdaCost';
import { getAwsAccountInfo } from '../domain/operations/getAwsAccountInfo';
import { getCloudWatchMetrics } from '../domain/operations/getCloudWatchMetrics';
import { getCostExplorerData } from '../domain/operations/getCostExplorerData';
import { listLambdaFunctions } from '../domain/operations/listLambdaFunctions';
import { queryLambdaMemoryUsage } from '../domain/operations/queryLambdaMemoryUsage';

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

    // define asOfDate at the start for consistent caching across all operations
    // use DATE only (not timestamp) so cache is reused throughout the day
    const asOfDate = new Date().toISOString().split('T')[0]!;

    // step 1: get AWS account info
    context.log.info('🔑 step 1: getting AWS account info...', {});
    const account = await getAwsAccountInfo({ asOfDate }, context);

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
    const allFunctions = await listLambdaFunctions({ asOfDate }, context);

    if (allFunctions.length === 0) {
      context.log.warn('🍂 no Lambda functions found.', {});
      return {
        evaluation: null,
        message: 'No Lambda functions found in this AWS account/region',
      };
    }

    // step 3: get CloudWatch metrics for all functions
    context.log.info('🔭 step 3: querying CloudWatch metrics...', {});
    const metricsData = await getCloudWatchMetrics(
      { daysLookback, asOfDate },
      context,
    );

    // log metrics coverage
    const functionsWithInvocationMetrics = Object.keys(
      metricsData.invocations,
    ).length;
    const functionsWithDurationMetrics = Object.keys(
      metricsData.durations,
    ).length;
    const functionsWithErrorMetrics = Object.keys(metricsData.errors).length;

    context.log.info(
      `   - ${functionsWithInvocationMetrics} functions with invocation metrics`,
      {},
    );
    context.log.info(
      `   - ${functionsWithDurationMetrics} functions with duration metrics`,
      {},
    );
    context.log.info(
      `   - ${functionsWithErrorMetrics} functions with error metrics`,
      {},
    );

    // FAIL FAST: identify functions present in Lambda but missing from CloudWatch
    const lambdaFunctionNames = new Set(
      allFunctions.map((fn) => fn.functionName),
    );
    const cloudwatchFunctionNames = new Set(
      Object.keys(metricsData.invocations),
    );

    const functionsInCloudWatchNotInLambda = Array.from(
      cloudwatchFunctionNames,
    ).filter((name) => !lambdaFunctionNames.has(name));

    if (functionsInCloudWatchNotInLambda.length > 0) {
      context.log.info(
        `   - ${functionsInCloudWatchNotInLambda.length} functions in CloudWatch but not in Lambda (possibly deleted)`,
        {},
      );
    }

    // step 4: get Cost Explorer data
    context.log.info('🔭 step 4: querying Cost Explorer...', {});
    const costExplorerData = await getCostExplorerData(
      { accountId: account.id, periodSince, periodUptil, asOfDate },
      context,
    );

    // step 5: filter functions with usage (>1 minute total duration)
    context.log.info(
      '🔭 step 5: filtering functions by duration threshold (>1 minute total)...',
      {},
    );

    const allFunctionsWithMetrics = allFunctions.map((fn) => {
      const invocations = metricsData.invocations[fn.functionName] ?? 0;
      const durationAvgMs = metricsData.durations[fn.functionName] ?? 0;
      const totalDurationMinutes = (durationAvgMs * invocations) / 1000 / 60;

      return {
        fn,
        invocations,
        durationAvgMs,
        totalDurationMinutes,
      };
    });

    // identify functions with no metrics data
    const functionsWithNoMetrics = allFunctionsWithMetrics.filter(
      (item) => item.invocations === 0,
    );

    // identify functions with metrics but below threshold
    const functionsWithMetricsBelowThreshold = allFunctionsWithMetrics.filter(
      (item) => item.invocations > 0 && item.totalDurationMinutes <= 1,
    );

    // identify functions meeting threshold
    const functionsWithMetrics = allFunctionsWithMetrics.filter(
      (item) => item.invocations > 0 && item.totalDurationMinutes > 1,
    );

    // log filtering results
    context.log.info(
      `✨ filtered to ${functionsWithMetrics.length} functions with >1 minute total duration`,
      {},
    );
    context.log.info(
      `   - ${functionsWithNoMetrics.length} functions with no invocations in lookback period`,
      {},
    );
    context.log.info(
      `   - ${functionsWithMetricsBelowThreshold.length} functions with <1 minute total duration`,
      {},
    );

    // FAIL FAST: validate we're not losing functions unexpectedly
    const totalAccountedFor =
      functionsWithMetrics.length +
      functionsWithNoMetrics.length +
      functionsWithMetricsBelowThreshold.length;
    if (totalAccountedFor !== allFunctions.length) {
      context.log.error(
        `🚨 CRITICAL: Function count mismatch! Total functions: ${allFunctions.length}, Accounted for: ${totalAccountedFor}`,
        {},
      );
      throw new Error(
        `Function filtering error: expected ${allFunctions.length} functions but only accounted for ${totalAccountedFor}`,
      );
    }

    // log summary of functions with no metrics
    if (functionsWithNoMetrics.length > 0) {
      context.log.info(
        `   - ${functionsWithNoMetrics.length} functions with no invocations (excluded from analysis)`,
        {},
      );
    }

    // step 6: analyze each function (with memory usage for expensive ones)
    context.log.info('🔭 step 6: analyzing Lambda functions...', {});

    const bottleneck = new Bottleneck({ maxConcurrent: 10 });

    const expenses: LambdaExpense[] = await Promise.all(
      functionsWithMetrics.map(
        bottleneck.wrap(
          async (item: {
            fn: typeof functionsWithMetrics[0]['fn'];
            invocations: number;
            durationAvgMs: number;
          }) => {
            const { fn, invocations, durationAvgMs } = item;
            const errors = metricsData.errors[fn.functionName] ?? 0;

            // calculate cost
            const cost = calculateLambdaCost({
              fn,
              invocations,
              durationAvgMs,
            });

            // query memory usage if cost exceeds threshold
            let memoryMaxUsedMb: number | undefined | null;
            let memoryUtilPct: number | undefined;
            let memoryQueryFailed = false;

            if (cost.monthlyCost > memoryQueryThreshold) {
              try {
                memoryMaxUsedMb = await queryLambdaMemoryUsage(
                  { functionName: fn.functionName, daysLookback, asOfDate },
                  context,
                );

                if (memoryMaxUsedMb !== undefined && memoryMaxUsedMb !== null) {
                  memoryUtilPct = (memoryMaxUsedMb * 100) / fn.memorySize;
                  context.log.info(
                    `  ✅ ${
                      fn.functionName
                    }: max memory ${memoryMaxUsedMb}MB (${memoryUtilPct.toFixed(
                      2,
                    )}%)`,
                    {},
                  );
                }
              } catch (error) {
                // log error loudly but continue processing
                context.log.error(
                  `  ❌ ${fn.functionName}: FAILED to query memory usage - ${
                    error instanceof Error ? error.message : String(error)
                  }`,
                  { error, functionName: fn.functionName },
                );
                memoryQueryFailed = true;
                // set to special marker value to indicate failure
                memoryMaxUsedMb = -1;
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

    // FAIL FAST: validate all filtered functions were analyzed
    if (expenses.length !== functionsWithMetrics.length) {
      context.log.error(
        `🚨 CRITICAL: Expense calculation mismatch! Expected ${functionsWithMetrics.length} expenses but got ${expenses.length}`,
        {},
      );
      throw new Error(
        `Expense calculation error: expected ${functionsWithMetrics.length} expenses but only generated ${expenses.length}`,
      );
    }

    // FAIL FAST: validate all expense function names are unique
    const expenseFunctionNames = expenses.map((exp) => exp.functionName);
    const uniqueExpenseNames = new Set(expenseFunctionNames);
    if (uniqueExpenseNames.size !== expenseFunctionNames.length) {
      context.log.error(
        `🚨 CRITICAL: Duplicate function names in expenses! Expected ${expenseFunctionNames.length} unique names but got ${uniqueExpenseNames.size}`,
        {},
      );
      const duplicates = expenseFunctionNames.filter(
        (name, index) => expenseFunctionNames.indexOf(name) !== index,
      );
      context.log.error(`   - Duplicates: ${duplicates.join(', ')}`, {});
      throw new Error(
        `Expense calculation error: duplicate function names found: ${duplicates.join(
          ', ',
        )}`,
      );
    }

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

    const x86Count = expenses.filter(
      (exp) => exp.architecture === 'x86_64',
    ).length;
    const armCount = expenses.filter(
      (exp) => exp.architecture === 'arm64',
    ).length;

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

    // write excluded functions report
    const excludedReport = {
      evaluationDate: evaluation.evaluationDate,
      account: evaluation.account,
      period: evaluation.period,
      excluded: {
        functionsWithNoInvocations: functionsWithNoMetrics.map((item) => ({
          functionName: item.fn.functionName,
          runtime: item.fn.runtime,
          memoryMb: item.fn.memorySize,
          timeoutSeconds: item.fn.timeout,
          architecture: item.fn.architectures[0] ?? 'x86_64',
        })),
        functionsInCloudWatchNotInLambda: functionsInCloudWatchNotInLambda.map(
          (name) => ({
            functionName: name,
            reason: 'exists in CloudWatch metrics but not in current Lambda list',
          }),
        ),
        functionsWithLowDuration: functionsWithMetricsBelowThreshold.map(
          (item) => ({
            functionName: item.fn.functionName,
            runtime: item.fn.runtime,
            memoryMb: item.fn.memorySize,
            invocations: item.invocations,
            totalDurationMinutes: item.totalDurationMinutes,
            architecture: item.fn.architectures[0] ?? 'x86_64',
          }),
        ),
      },
      summary: {
        totalExcluded:
          functionsWithNoMetrics.length +
          functionsInCloudWatchNotInLambda.length +
          functionsWithMetricsBelowThreshold.length,
        noInvocations: functionsWithNoMetrics.length,
        deletedFunctions: functionsInCloudWatchNotInLambda.length,
        lowDuration: functionsWithMetricsBelowThreshold.length,
      },
    };

    await context.out.write({
      name: 'excluded-functions.json',
      data: JSON.stringify(excludedReport, null, 2),
    });

    // step 10: display summary
    context.log.info('🌊 Lambda Expense Evaluation Complete', {});
    context.log.info('', {});
    context.log.info('📊 Overview:', {});
    context.log.info(`   - Total functions: ${allFunctions.length}`, {});
    context.log.info(`   - Functions analyzed: ${expenses.length}`, {});
    context.log.info(
      `   - Functions excluded (no invocations): ${functionsWithNoMetrics.length}`,
      {},
    );
    context.log.info(
      `   - Functions excluded (<1min duration): ${functionsWithMetricsBelowThreshold.length}`,
      {},
    );
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
      `   - Service cost (Cost Explorer): $${costExplorerData.totalCost.toFixed(
        2,
      )}/month`,
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
const generateMarkdownReport = (
  evaluation: LambdaExpenseEvaluation,
): string => {
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
  lines.push(
    `- Functions with Usage: ${evaluation.summary.functionsWithUsage}`,
  );
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

    // handle special case: -1 means query failed
    let maxUsed: string;
    if (fn.memoryMaxUsedMb === -1) {
      maxUsed = '??? (query failed)';
    } else if (fn.memoryMaxUsedMb !== undefined && fn.memoryMaxUsedMb !== null) {
      maxUsed = `${fn.memoryMaxUsedMb.toFixed(0)}MB (${fn.memoryUtilPct!.toFixed(0)}%)`;
    } else {
      maxUsed = 'N/A';
    }

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
    '| ' + columnWidths.map((w) => '-'.repeat(w)).join(' | ') + ' |';
  lines.push(separatorRow);

  // generate data rows
  for (const row of rows) {
    const dataRow =
      '| ' +
      row.map((cell, i) => padRight(cell, columnWidths[i]!)).join(' | ') +
      ' |';
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
