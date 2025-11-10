/**
 * .what = get CloudWatch log ingestion expenses
 * .why = identify most expensive log groups by ingestion volume
 */
import { asCommand } from '@ehmpathy/as-command';
import { basename, join } from 'path';
import { BadRequestError } from 'helpful-errors';
import { generateLogMethods } from 'simple-leveled-log-methods';

import { calculateIngestionExpenses } from '../../../domain/operations/calculateIngestionExpenses';
import { getActualIngestionCost } from '../../../domain/operations/getActualIngestionCost';
import { getAwsAccountInfo } from '../../../domain/operations/getAwsAccountInfo';
import { listLogGroups } from '../../../domain/operations/listLogGroups';
import { queryIngestionMetrics } from '../../../domain/operations/queryIngestionMetrics';

const log = generateLogMethods();

// npx tsx src/roles/budgeter/skills/aws.cloudwatch/src/contract/commands/getIngestionExpenses.ts
// npx tsx src/roles/budgeter/skills/aws.cloudwatch/src/contract/commands/getIngestionExpenses.ts --days=7
export const command = asCommand(
  {
    name: basename(__filename, '.ts'),
    purpose: 'get CloudWatch log ingestion expenses',
    stage: process.env.STAGE || 'local',
    dir: join(__dirname, '.rhachet'),
    log,
  },
  async (input: { days?: number }, context) => {
    context.log.info('analyzing CloudWatch log ingestion expenses...', {});

    // step 1: get AWS account info
    context.log.info('step 1: getting AWS account info...', {});
    const account = getAwsAccountInfo({}, context);

    // calculate date range - use last complete month to avoid Cost Explorer data lag
    // Cost Explorer data for current month is often incomplete/delayed
    const now = new Date();
    const firstDayOfCurrentMonth = new Date(
      now.getFullYear(),
      now.getMonth(),
      1,
    );
    const firstDayOfLastMonth = new Date(
      now.getFullYear(),
      now.getMonth() - 1,
      1,
    );

    const periodSince = firstDayOfLastMonth.toISOString().split('T')[0]!;
    const periodUptil = firstDayOfCurrentMonth.toISOString().split('T')[0]!;

    // calculate actual days in the period
    const actualDaysInPeriod = Math.floor(
      (firstDayOfCurrentMonth.getTime() - firstDayOfLastMonth.getTime()) /
        (1000 * 60 * 60 * 24),
    );

    context.log.info(
      `analysis period: ${periodSince} to ${periodUptil} (${actualDaysInPeriod} days, last complete month)`,
      {},
    );

    // step 2: list all log groups
    context.log.info('step 2: enumerating CloudWatch log groups...', {});
    const logGroups = await listLogGroups({}, context);

    if (logGroups.length === 0) {
      context.log.warn('no CloudWatch log groups found.', {});
      return {
        message: 'No CloudWatch log groups found in this AWS account/region',
      };
    }

    // step 3: estimate ingestion metrics from storage growth
    context.log.info('step 3: estimating ingestion from storage...', {});
    const metrics = queryIngestionMetrics(
      { logGroupsNow: logGroups, daysLookback: actualDaysInPeriod },
      context,
    );

    if (metrics.length === 0) {
      context.log.warn('no ingestion metrics found.', {});
      return {
        message: 'No ingestion metrics found for log groups in this period',
      };
    }

    // step 4: get actual ingestion cost from Cost Explorer
    context.log.info('step 4: querying actual cost from Cost Explorer...', {});
    const actualCost = getActualIngestionCost(
      { accountId: account.id, periodSince, periodUptil },
      context,
    );

    // fail fast if no cost data available
    if (actualCost.totalCost === 0) {
      throw new BadRequestError(
        'Cost Explorer returned $0 for ingestion costs. Either no ingestion occurred or Cost Explorer data is unavailable.',
        { periodSince, periodUptil, accountId: account.id },
      );
    }

    // step 5: calculate ingestion expenses
    context.log.info('step 5: calculating ingestion expenses...', {});
    const expenses = calculateIngestionExpenses(
      {
        metrics,
        daysLookback: actualDaysInPeriod,
        actualTotalCost: actualCost.totalCost,
      },
      context,
    );

    // sort by cost descending
    const sortedExpenses = expenses.sort(
      (a, b) => b.monthlyCost - a.monthlyCost,
    );

    // calculate totals
    const totalIncomingGb = sortedExpenses.reduce(
      (sum, exp) => sum + exp.incomingGb,
      0,
    );
    const totalCost = sortedExpenses.reduce(
      (sum, exp) => sum + exp.monthlyCost,
      0,
    );
    const totalLogEvents = sortedExpenses.reduce(
      (sum, exp) => sum + exp.incomingLogEvents,
      0,
    );

    // step 4: display summary
    context.log.info('', {});
    context.log.info('Ingestion Summary:', {});
    context.log.info(`   - Log groups with ingestion: ${expenses.length}`, {});
    context.log.info(
      `   - Total data ingested: ${totalIncomingGb.toFixed(2)} GB`,
      {},
    );
    context.log.info(
      `   - Total log events: ${totalLogEvents.toLocaleString()}`,
      {},
    );
    context.log.info(`   - Total cost: $${totalCost.toFixed(2)}`, {});
    context.log.info('', {});

    // step 5: write reports
    await context.out.write({
      name: 'ingestion-expenses.json',
      data: JSON.stringify(
        {
          account,
          period: {
            days: actualDaysInPeriod,
            from: periodSince,
            to: periodUptil,
          },
          summary: {
            logGroupsWithIngestion: expenses.length,
            totalIncomingGb,
            totalLogEvents,
            totalCost,
          },
          expenses: sortedExpenses,
        },
        null,
        2,
      ),
    });

    const markdownReport = generateMarkdownReport({
      account,
      daysLookback: actualDaysInPeriod,
      periodSince,
      periodUptil,
      expenses: sortedExpenses,
      totalIncomingGb,
      totalCost,
      totalLogEvents,
    });

    await context.out.write({
      name: 'ingestion-expenses.md',
      data: markdownReport,
    });

    context.log.info('CloudWatch Ingestion Expense Analysis Complete', {});
    context.log.info('', {});
    context.log.info(`Top 5 most expensive log groups:`, {});

    // display top 5 log groups
    sortedExpenses.slice(0, 5).forEach((exp, index) => {
      context.log.info(
        `   ${index + 1}. ${exp.logGroupName}: ${exp.incomingGb.toFixed(
          2,
        )} GB ($${exp.monthlyCost.toFixed(2)})`,
        {},
      );
    });

    return { totalCost, logGroupsAnalyzed: expenses.length };
  },
);

/**
 * .what = generate markdown report for ingestion expenses
 * .why = provides human-readable summary of log group costs with detailed tables and notes
 */
const generateMarkdownReport = (input: {
  account: { display: string };
  daysLookback: number;
  periodSince: string;
  periodUptil: string;
  expenses: Array<{
    logGroupName: string;
    incomingBytes: number;
    incomingGb: number;
    incomingLogEvents: number;
    monthlyCost: number;
  }>;
  totalIncomingGb: number;
  totalCost: number;
  totalLogEvents: number;
}): string => {
  const lines: string[] = [];

  lines.push('# CloudWatch Log Ingestion Expenses');
  lines.push('');
  lines.push(`**Account**: ${input.account.display}`);
  lines.push(
    `**Period**: ${input.periodSince} to ${input.periodUptil} (${input.daysLookback} days)`,
  );
  lines.push(`**Generated**: ${new Date().toISOString()}`);
  lines.push('');

  lines.push('## Summary');
  lines.push('');
  lines.push(`- Log Groups with Ingestion: ${input.expenses.length}`);
  lines.push(`- Total Data Ingested: ${input.totalIncomingGb.toFixed(2)} GB`);
  lines.push(`- Total Log Events: ${input.totalLogEvents.toLocaleString()}`);
  lines.push(`- Total Ingestion Cost: $${input.totalCost.toFixed(2)}`);
  lines.push('');

  lines.push('## Ingestion Expenses by Log Group');
  lines.push('');
  lines.push('Sorted by ingestion cost (highest to lowest)');
  lines.push('');

  // prepare table data
  const tableData = input.expenses.map((exp) => ({
    logGroupName: exp.logGroupName,
    incomingGb: `${exp.incomingGb.toFixed(3)} GB`,
    incomingGbRaw: exp.incomingGb,
    logEvents: exp.incomingLogEvents.toLocaleString(),
    monthlyCost: `$${exp.monthlyCost.toFixed(4)}`,
    costPercent: `${((exp.monthlyCost / input.totalCost) * 100).toFixed(1)}%`,
  }));

  // calculate column widths
  const headers = {
    logGroupName: 'Log Group Name',
    incomingGb: 'Data Ingested',
    logEvents: 'Log Events',
    monthlyCost: 'Ingestion Cost',
    costPercent: '% of Total',
  };

  const widths = {
    logGroupName: Math.max(
      headers.logGroupName.length,
      ...tableData.map((r) => r.logGroupName.length),
    ),
    incomingGb: Math.max(
      headers.incomingGb.length,
      ...tableData.map((r) => r.incomingGb.length),
    ),
    logEvents: Math.max(
      headers.logEvents.length,
      ...tableData.map((r) => r.logEvents.length),
    ),
    monthlyCost: Math.max(
      headers.monthlyCost.length,
      ...tableData.map((r) => r.monthlyCost.length),
    ),
    costPercent: Math.max(
      headers.costPercent.length,
      ...tableData.map((r) => r.costPercent.length),
    ),
  };

  // generate header row
  lines.push(
    `| ${headers.logGroupName.padEnd(
      widths.logGroupName,
    )} | ${headers.incomingGb.padEnd(
      widths.incomingGb,
    )} | ${headers.logEvents.padEnd(
      widths.logEvents,
    )} | ${headers.monthlyCost.padEnd(
      widths.monthlyCost,
    )} | ${headers.costPercent.padEnd(widths.costPercent)} |`,
  );

  // generate separator row
  lines.push(
    `| ${'-'.repeat(widths.logGroupName)} | ${'-'.repeat(
      widths.incomingGb,
    )} | ${'-'.repeat(widths.logEvents)} | ${'-'.repeat(
      widths.monthlyCost,
    )} | ${'-'.repeat(widths.costPercent)} |`,
  );

  // generate data rows
  for (const row of tableData) {
    lines.push(
      `| ${row.logGroupName.padEnd(
        widths.logGroupName,
      )} | ${row.incomingGb.padEnd(widths.incomingGb)} | ${row.logEvents.padEnd(
        widths.logEvents,
      )} | ${row.monthlyCost.padEnd(
        widths.monthlyCost,
      )} | ${row.costPercent.padEnd(widths.costPercent)} |`,
    );
  }

  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('**Notes:**');
  lines.push('');
  lines.push('- **Costs are from actual AWS spend** (Cost Explorer)');
  lines.push(
    '  - Per-log-group costs calculated from ingestion volume proportions',
  );
  lines.push(
    '  - Ingestion volume estimated from storage size and retention policies',
  );
  lines.push(
    '  - If retention policy is set: daily ingestion ≈ storage / retention days',
  );
  lines.push('  - If no retention: daily ingestion ≈ storage / log group age');
  lines.push(`- Costs shown are for the ${input.daysLookback}-day period`);
  lines.push(
    '- This does not include storage costs or CloudWatch Insights query costs',
  );

  return lines.join('\n');
};

// execute the command when run directly
if (require.main === module) void command({});
