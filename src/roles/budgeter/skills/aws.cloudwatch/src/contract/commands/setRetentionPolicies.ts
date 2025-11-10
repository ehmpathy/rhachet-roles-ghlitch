/**
 * .what = set retention policies for CloudWatch log groups
 * .why = manage log retention to control costs and comply with policies
 */
import { asCommand } from '@ehmpathy/as-command';
import { BadRequestError } from 'helpful-errors';
import { basename, join } from 'path';
import { generateLogMethods } from 'simple-leveled-log-methods';

import { applyRetentionPolicy } from '../../../domain/operations/applyRetentionPolicy';
import { calculateRetentionPolicyChanges } from '../../../domain/operations/calculateRetentionPolicyChanges';
import { getAwsAccountInfo } from '../../../domain/operations/getAwsAccountInfo';
import { listLogGroups } from '../../../domain/operations/listLogGroups';

const log = generateLogMethods();

// npx tsx src/roles/budgeter/skills/aws.cloudwatch/src/contract/commands/setRetentionPolicies.ts --mode=prep
// npx tsx src/roles/budgeter/skills/aws.cloudwatch/src/contract/commands/setRetentionPolicies.ts --mode=exec
export const command = asCommand(
  {
    name: basename(__filename, '.ts'),
    purpose: 'set retention policies for CloudWatch log groups',
    stage: process.env.STAGE || 'local',
    dir: join(__dirname, '.rhachet'),
    log,
  },
  async (input: { mode?: 'prep' | 'exec'; days?: number }, context) => {
    const mode = input.mode ?? 'prep';
    const desiredRetentionDays = input.days ?? 90;

    // reject invalid mode
    if (!['prep', 'exec'].includes(mode)) {
      throw new BadRequestError('mode must be either "prep" or "exec"', {
        mode,
      });
    }

    context.log.info('setting retention policies...', {});
    context.log.info(`mode: ${mode}`, {});
    context.log.info(`desired retention: ${desiredRetentionDays} days`, {});

    // step 1: get AWS account info
    context.log.info('step 1: getting AWS account info...', {});
    const account = getAwsAccountInfo({}, context);

    // step 2: list all log groups
    context.log.info('step 2: enumerating CloudWatch log groups...', {});
    const logGroups = await listLogGroups({}, context);

    if (logGroups.length === 0) {
      context.log.warn('no CloudWatch log groups found.', {});
      return {
        message: 'No CloudWatch log groups found in this AWS account/region',
      };
    }

    // step 3: calculate retention policy changes
    context.log.info('step 3: calculating retention policy changes...', {});
    const changes = calculateRetentionPolicyChanges(
      { logGroups, desiredRetentionDays },
      context,
    );

    const changesNeeded = changes.filter((c) => c.requiresChange);

    // step 3.5: calculate storage costs
    context.log.info('step 3.5: calculating storage costs...', {});
    const STORAGE_COST_PER_GB = 0.03; // $0.03 per GB per month

    const logGroupsWithCosts = logGroups.map((lg) => {
      const storedGb = (lg.storedBytes || 0) / (1024 * 1024 * 1024);
      const monthlyCost = storedGb * STORAGE_COST_PER_GB;
      return {
        logGroupName: lg.logGroupName,
        storedBytes: lg.storedBytes || 0,
        storedGb,
        monthlyCost,
        retentionInDays: lg.retentionInDays,
      };
    });

    const totalStoredGb = logGroupsWithCosts.reduce(
      (sum, lg) => sum + lg.storedGb,
      0,
    );
    const totalMonthlyCost = logGroupsWithCosts.reduce(
      (sum, lg) => sum + lg.monthlyCost,
      0,
    );

    context.log.info(
      `total storage: ${totalStoredGb.toFixed(2)} GB, cost: $${totalMonthlyCost.toFixed(2)}/month`,
      {},
    );

    // step 4: display current state and planned changes
    context.log.info('', {});
    context.log.info('Current State:', {});
    context.log.info(`   - Total log groups: ${logGroups.length}`, {});
    context.log.info(`   - Changes needed: ${changesNeeded.length}`, {});
    context.log.info(
      `   - Total storage: ${totalStoredGb.toFixed(2)} GB ($${totalMonthlyCost.toFixed(2)}/month)`,
      {},
    );
    context.log.info('', {});

    if (mode === 'prep') {
      // prep mode: show current policies and planned changes
      context.log.info('Retention Policy Report:', {});
      context.log.info('', {});

      // log each change with its status
      changes.forEach((change) => {
        const retentionRealizedDisplay = change.retentionRealized
          ? `${change.retentionRealized} days`
          : 'null';
        const status = change.requiresChange ? '[CHANGE]' : '[OK]';

        context.log.info(`${status} ${change.logGroupName}`, {});
        context.log.info(
          `       retentionRealized: ${retentionRealizedDisplay}`,
          {},
        );
        context.log.info(
          `       retentionDesired: ${change.retentionDesired} days`,
          {},
        );
      });

      context.log.info('', {});
      context.log.info(
        'Run with --mode=exec to apply the retention policies',
        {},
      );

      // write report to JSON file
      // explicitly serialize changes to ensure retentionRealized is included even when undefined
      const serializedChanges = changes.map((c) => ({
        logGroupName: c.logGroupName,
        retentionRealized: c.retentionRealized ?? null,
        retentionDesired: c.retentionDesired,
        requiresChange: c.requiresChange,
      }));

      await context.out.write({
        name: 'retention-policies.json',
        data: JSON.stringify(
          {
            account,
            desiredRetentionDays,
            totalLogGroups: logGroups.length,
            changesNeeded: changesNeeded.length,
            changes: serializedChanges,
          },
          null,
          2,
        ),
      });

      // write report to markdown file
      const markdownReport = generateMarkdownReport({
        account,
        desiredRetentionDays,
        logGroups,
        changes,
        changesNeeded,
        logGroupsWithCosts,
        totalStoredGb,
        totalMonthlyCost,
      });
      await context.out.write({
        name: 'retention-policies.md',
        data: markdownReport,
      });

      return { mode: 'prep', changesNeeded: changesNeeded.length };
    }

    if (mode === 'exec') {
      // exec mode: apply the retention policies
      context.log.info('step 4: applying retention policies...', {});
      context.log.info('', {});

      // apply each policy and collect results
      const results = changesNeeded.map((change, index) => {
        // log progress
        context.log.info(
          `[${index + 1}/${changesNeeded.length}] applying retention policy to ${change.logGroupName}...`,
          {},
        );

        try {
          applyRetentionPolicy(
            {
              logGroupName: change.logGroupName,
              retentionInDays: change.retentionDesired,
            },
            context,
          );
          context.log.info(
            `[OK] ${change.logGroupName} -> ${change.retentionDesired} days`,
            {},
          );
          return {
            logGroupName: change.logGroupName,
            retentionDesired: change.retentionDesired,
            success: true as const,
          };
        } catch (error) {
          context.log.error(
            `[FAIL] failed to apply policy to ${change.logGroupName}: ${error}`,
            {},
          );
          return {
            logGroupName: change.logGroupName,
            retentionDesired: change.retentionDesired,
            success: false as const,
            error: String(error),
          };
        }
      });

      // calculate success/failure counts
      const appliedCount = results.filter((r) => r.success).length;

      context.log.info('', {});
      context.log.info('Retention Policies Applied', {});
      context.log.info(`   - Applied: ${appliedCount}`, {});
      context.log.info(
        `   - Failed: ${changesNeeded.length - appliedCount}`,
        {},
      );

      // write execution report to markdown file
      const executionReport = generateExecutionReport({
        account,
        desiredRetentionDays,
        results,
        appliedCount,
        failedCount: changesNeeded.length - appliedCount,
      });
      await context.out.write({
        name: 'retention-policies-execution.md',
        data: executionReport,
      });

      return { mode: 'exec', applied: appliedCount };
    }

    return { mode, message: 'Unknown mode' };
  },
);

/**
 * .what = generate markdown report for retention policy analysis
 * .why = provides human-readable summary of current state and required changes
 */
const generateMarkdownReport = (input: {
  account: { display: string };
  desiredRetentionDays: number;
  logGroups: Array<{ logGroupName: string }>;
  changes: Array<{
    logGroupName: string;
    retentionRealized?: number;
    retentionDesired: number;
    requiresChange: boolean;
  }>;
  changesNeeded: Array<{
    logGroupName: string;
    retentionRealized?: number;
    retentionDesired: number;
  }>;
  logGroupsWithCosts: Array<{
    logGroupName: string;
    storedBytes: number;
    storedGb: number;
    monthlyCost: number;
    retentionInDays?: number;
  }>;
  totalStoredGb: number;
  totalMonthlyCost: number;
}): string => {
  const lines: string[] = [];

  lines.push('# CloudWatch Log Group Retention Policies');
  lines.push('');
  lines.push(`**Account**: ${input.account.display}`);
  lines.push(`**Desired Retention**: ${input.desiredRetentionDays} days`);
  lines.push(`**Generated**: ${new Date().toISOString()}`);
  lines.push('');

  lines.push('## Summary');
  lines.push('');
  lines.push(`- Total Log Groups: ${input.logGroups.length}`);
  lines.push(`- Changes Needed: ${input.changesNeeded.length}`);
  lines.push(
    `- Already Compliant: ${
      input.logGroups.length - input.changesNeeded.length
    }`,
  );
  lines.push(
    `- Total Storage: ${input.totalStoredGb.toFixed(2)} GB ($${input.totalMonthlyCost.toFixed(2)}/month)`,
  );
  lines.push('');

  // table for all log groups
  lines.push('## All Log Groups');
  lines.push('');

  // prepare data for table
  const tableData = input.changes
    .map((change) => {
      const costData = input.logGroupsWithCosts.find(
        (lg) => lg.logGroupName === change.logGroupName,
      );
      return {
        status: change.requiresChange ? 'CHANGE' : 'OK',
        logGroupName: change.logGroupName,
        storedGb: costData ? `${costData.storedGb.toFixed(3)} GB` : '0 GB',
        storedGbRaw: costData ? costData.storedGb : 0,
        monthlyCost: costData ? `$${costData.monthlyCost.toFixed(4)}` : '$0.00',
        retentionRealized: change.retentionRealized
          ? `${change.retentionRealized} days`
          : 'null',
        retentionDesired: `${change.retentionDesired} days`,
        action: change.requiresChange ? 'Update Policy' : 'No Change',
      };
    })
    .sort((a, b) => b.storedGbRaw - a.storedGbRaw);

  // calculate column widths
  const headers = {
    status: 'Status',
    logGroupName: 'Log Group Name',
    storedGb: 'Storage',
    monthlyCost: 'Monthly Cost',
    retentionRealized: 'Retention Realized',
    retentionDesired: 'Retention Desired',
    action: 'Action',
  };

  const widths = {
    status: Math.max(
      headers.status.length,
      ...tableData.map((r) => r.status.length),
    ),
    logGroupName: Math.max(
      headers.logGroupName.length,
      ...tableData.map((r) => r.logGroupName.length),
    ),
    storedGb: Math.max(
      headers.storedGb.length,
      ...tableData.map((r) => r.storedGb.length),
    ),
    monthlyCost: Math.max(
      headers.monthlyCost.length,
      ...tableData.map((r) => r.monthlyCost.length),
    ),
    retentionRealized: Math.max(
      headers.retentionRealized.length,
      ...tableData.map((r) => r.retentionRealized.length),
    ),
    retentionDesired: Math.max(
      headers.retentionDesired.length,
      ...tableData.map((r) => r.retentionDesired.length),
    ),
    action: Math.max(
      headers.action.length,
      ...tableData.map((r) => r.action.length),
    ),
  };

  // generate header row
  lines.push(
    `| ${headers.status.padEnd(widths.status)} | ${headers.logGroupName.padEnd(
      widths.logGroupName,
    )} | ${headers.storedGb.padEnd(widths.storedGb)} | ${headers.monthlyCost.padEnd(
      widths.monthlyCost,
    )} | ${headers.retentionRealized.padEnd(
      widths.retentionRealized,
    )} | ${headers.retentionDesired.padEnd(
      widths.retentionDesired,
    )} | ${headers.action.padEnd(widths.action)} |`,
  );

  // generate separator row
  lines.push(
    `| ${'-'.repeat(widths.status)} | ${'-'.repeat(
      widths.logGroupName,
    )} | ${'-'.repeat(widths.storedGb)} | ${'-'.repeat(
      widths.monthlyCost,
    )} | ${'-'.repeat(widths.retentionRealized)} | ${'-'.repeat(
      widths.retentionDesired,
    )} | ${'-'.repeat(widths.action)} |`,
  );

  // generate data rows
  tableData.forEach((row) => {
    lines.push(
      `| ${row.status.padEnd(widths.status)} | ${row.logGroupName.padEnd(
        widths.logGroupName,
      )} | ${row.storedGb.padEnd(widths.storedGb)} | ${row.monthlyCost.padEnd(
        widths.monthlyCost,
      )} | ${row.retentionRealized.padEnd(
        widths.retentionRealized,
      )} | ${row.retentionDesired.padEnd(
        widths.retentionDesired,
      )} | ${row.action.padEnd(widths.action)} |`,
    );
  });

  lines.push('');

  // table for changes needed only
  if (input.changesNeeded.length > 0) {
    lines.push('## Changes Needed');
    lines.push('');

    // prepare data for changes needed table
    const changesData = input.changesNeeded.map((change) => ({
      logGroupName: change.logGroupName,
      retentionRealized: change.retentionRealized
        ? `${change.retentionRealized} days`
        : 'null',
      retentionDesired: `${change.retentionDesired} days`,
    }));

    // calculate column widths for changes table
    const changesHeaders = {
      logGroupName: 'Log Group Name',
      retentionRealized: 'Retention Realized',
      retentionDesired: 'Retention Desired',
    };

    const changesWidths = {
      logGroupName: Math.max(
        changesHeaders.logGroupName.length,
        ...changesData.map((r) => r.logGroupName.length),
      ),
      retentionRealized: Math.max(
        changesHeaders.retentionRealized.length,
        ...changesData.map((r) => r.retentionRealized.length),
      ),
      retentionDesired: Math.max(
        changesHeaders.retentionDesired.length,
        ...changesData.map((r) => r.retentionDesired.length),
      ),
    };

    // generate header row
    lines.push(
      `| ${changesHeaders.logGroupName.padEnd(
        changesWidths.logGroupName,
      )} | ${changesHeaders.retentionRealized.padEnd(
        changesWidths.retentionRealized,
      )} | ${changesHeaders.retentionDesired.padEnd(
        changesWidths.retentionDesired,
      )} |`,
    );

    // generate separator row
    lines.push(
      `| ${'-'.repeat(changesWidths.logGroupName)} | ${'-'.repeat(
        changesWidths.retentionRealized,
      )} | ${'-'.repeat(changesWidths.retentionDesired)} |`,
    );

    // generate data rows
    changesData.forEach((row) => {
      lines.push(
        `| ${row.logGroupName.padEnd(
          changesWidths.logGroupName,
        )} | ${row.retentionRealized.padEnd(
          changesWidths.retentionRealized,
        )} | ${row.retentionDesired.padEnd(changesWidths.retentionDesired)} |`,
      );
    });

    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push('**Next Steps:**');
    lines.push('');
    lines.push('Run with `--mode=exec` to apply these retention policies.');
  } else {
    lines.push('## No Changes Needed');
    lines.push('');
    lines.push('All log groups already have the desired retention policy.');
  }

  return lines.join('\n');
};

/**
 * .what = generate execution report after applying retention policies
 * .why = documents which policies were applied successfully and which failed
 */
const generateExecutionReport = (input: {
  account: { display: string };
  desiredRetentionDays: number;
  results: Array<{
    logGroupName: string;
    retentionDesired: number;
    success: boolean;
    error?: string;
  }>;
  appliedCount: number;
  failedCount: number;
}): string => {
  const lines: string[] = [];

  lines.push('# CloudWatch Log Group Retention Policies - Execution Report');
  lines.push('');
  lines.push(`**Account**: ${input.account.display}`);
  lines.push(`**Desired Retention**: ${input.desiredRetentionDays} days`);
  lines.push(`**Executed**: ${new Date().toISOString()}`);
  lines.push('');

  lines.push('## Summary');
  lines.push('');
  lines.push(`- Total Changes Applied: ${input.appliedCount}`);
  lines.push(`- Failed: ${input.failedCount}`);
  lines.push('');

  lines.push('## Execution Results');
  lines.push('');

  // prepare execution results data
  const resultsData = input.results.map((result) => ({
    status: result.success ? 'SUCCESS' : 'FAILED',
    logGroupName: result.logGroupName,
    retentionApplied: result.success
      ? `${result.retentionDesired} days`
      : 'N/A',
    error: result.error || '-',
  }));

  // calculate column widths for execution results
  const resultsHeaders = {
    status: 'Status',
    logGroupName: 'Log Group Name',
    retentionApplied: 'Retention Applied',
    error: 'Error',
  };

  const resultsWidths = {
    status: Math.max(
      resultsHeaders.status.length,
      ...resultsData.map((r) => r.status.length),
    ),
    logGroupName: Math.max(
      resultsHeaders.logGroupName.length,
      ...resultsData.map((r) => r.logGroupName.length),
    ),
    retentionApplied: Math.max(
      resultsHeaders.retentionApplied.length,
      ...resultsData.map((r) => r.retentionApplied.length),
    ),
    error: Math.max(
      resultsHeaders.error.length,
      ...resultsData.map((r) => r.error.length),
    ),
  };

  // generate header row
  lines.push(
    `| ${resultsHeaders.status.padEnd(
      resultsWidths.status,
    )} | ${resultsHeaders.logGroupName.padEnd(
      resultsWidths.logGroupName,
    )} | ${resultsHeaders.retentionApplied.padEnd(
      resultsWidths.retentionApplied,
    )} | ${resultsHeaders.error.padEnd(resultsWidths.error)} |`,
  );

  // generate separator row
  lines.push(
    `| ${'-'.repeat(resultsWidths.status)} | ${'-'.repeat(
      resultsWidths.logGroupName,
    )} | ${'-'.repeat(resultsWidths.retentionApplied)} | ${'-'.repeat(
      resultsWidths.error,
    )} |`,
  );

  // generate data rows
  resultsData.forEach((row) => {
    lines.push(
      `| ${row.status.padEnd(resultsWidths.status)} | ${row.logGroupName.padEnd(
        resultsWidths.logGroupName,
      )} | ${row.retentionApplied.padEnd(
        resultsWidths.retentionApplied,
      )} | ${row.error.padEnd(resultsWidths.error)} |`,
    );
  });

  lines.push('');

  if (input.failedCount > 0) {
    lines.push('---');
    lines.push('');
    lines.push('**Failed Changes:**');
    lines.push('');

    // prepare failed changes data
    const failedData = input.results
      .filter((r) => !r.success)
      .map((result) => ({
        logGroupName: result.logGroupName,
        error: result.error || 'Unknown error',
      }));

    // calculate column widths for failed changes
    const failedHeaders = {
      logGroupName: 'Log Group Name',
      error: 'Error',
    };

    const failedWidths = {
      logGroupName: Math.max(
        failedHeaders.logGroupName.length,
        ...failedData.map((r) => r.logGroupName.length),
      ),
      error: Math.max(
        failedHeaders.error.length,
        ...failedData.map((r) => r.error.length),
      ),
    };

    // generate header row
    lines.push(
      `| ${failedHeaders.logGroupName.padEnd(
        failedWidths.logGroupName,
      )} | ${failedHeaders.error.padEnd(failedWidths.error)} |`,
    );

    // generate separator row
    lines.push(
      `| ${'-'.repeat(failedWidths.logGroupName)} | ${'-'.repeat(
        failedWidths.error,
      )} |`,
    );

    // generate data rows
    failedData.forEach((row) => {
      lines.push(
        `| ${row.logGroupName.padEnd(
          failedWidths.logGroupName,
        )} | ${row.error.padEnd(failedWidths.error)} |`,
      );
    });

    lines.push('');
    lines.push(
      'Review the errors above and retry failed log groups if necessary.',
    );
  }

  return lines.join('\n');
};

// execute the command when run directly
if (require.main === module) {
  // parse CLI arguments
  const args = process.argv.slice(2);
  const input: { mode?: 'prep' | 'exec'; days?: number } = {};

  args.forEach((arg) => {
    if (arg.startsWith('--mode=')) {
      const value = arg.split('=')[1];
      if (value === 'prep' || value === 'exec') {
        input.mode = value;
      }
    } else if (arg.startsWith('--days=')) {
      const value = arg.split('=')[1];
      if (value) {
        input.days = parseInt(value, 10);
      }
    }
  });

  void command(input);
}
