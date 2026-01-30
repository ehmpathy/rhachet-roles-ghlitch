/**
 * .what = detect queries that should be investigated for optimization using AWS Performance Insights
 * .why = identifies slow or high-load queries that may benefit from optimization
 */
import { asCommand } from '@ehmpathy/as-command';
import { ContextLogTrail, LogLevel, withLogTrail } from 'as-procedure';
import { execSync } from 'child_process';
import { DomainLiteral } from 'domain-objects';
import { BadRequestError } from 'helpful-errors';
import { basename, join } from 'path';
import { generateLogMethods } from 'simple-leveled-log-methods';

const log = generateLogMethods();

class DbInstance extends DomainLiteral<DbInstance> implements DbInstance {
  identifier!: string;
  resourceId!: string;
  performanceInsightsEnabled!: boolean;
}

class QueryMetrics extends DomainLiteral<QueryMetrics> implements QueryMetrics {
  sqlId!: string;
  statement!: string;
  tokenizedId!: string;
  dbLoad!: number;
  executionCount?: number;
  latency?: number;
}

class PerformanceInsightsReport
  extends DomainLiteral<PerformanceInsightsReport>
  implements PerformanceInsightsReport
{
  instanceIdentifier!: string;
  resourceId!: string;
  periodHours!: number;
  topQueries!: QueryMetrics[];
  summary!: string;
}

// npx tsx src/skills/monitor/queryApis/detectPerformanceInsightsOpports.ts
export const command = asCommand(
  {
    name: basename(__filename, '.ts'),
    purpose:
      'detect queries we should investigate optimization for via Performance Insights',
    stage: process.env.STAGE || 'local',
    dir: join(__dirname, '.rhachet'),
    log,
  },
  async (input, context) => {
    context.log.info(
      '🔍 detecting performance optimization opportunities...',
      {},
    );

    // step 1: identify Aurora PostgreSQL instances with Performance Insights enabled
    context.log.info(
      '🌱 step 1: identifying Aurora PostgreSQL instances...',
      {},
    );
    const instances = getAuroraPostgresInstances({}, context);

    await context.out.write({
      name: 'aurora_postgres_instances.json',
      data: JSON.stringify(instances, null, 2),
    });

    // bailfast if no instances found
    if (instances.length === 0) {
      context.log.warn(
        '🍂 no Aurora PostgreSQL instances with Performance Insights enabled found.',
        {},
      );
      return { reports: [] };
    }

    context.log.info(
      `🌿 found ${instances.length} Aurora PostgreSQL instance(s) with Performance Insights enabled`,
      {},
    );

    // step 2: query Performance Insights for top queries
    context.log.info('🌾 step 2: querying Performance Insights...', {});

    const reports: PerformanceInsightsReport[] = await Promise.all(
      instances.map(async (instance) => {
        // fetch top queries by db.load
        const topQueries = await getTopQueriesByLoad(
          {
            resourceId: instance.resourceId,
            periodHours: 24,
            maxResults: 20,
          },
          context,
        );

        // generate verbal summary
        const summary = generatePerformanceSummary(
          {
            instanceIdentifier: instance.identifier,
            topQueries,
          },
          context,
        );

        // assemble instance report
        const report: PerformanceInsightsReport = {
          instanceIdentifier: instance.identifier,
          resourceId: instance.resourceId,
          periodHours: 24,
          topQueries,
          summary,
        };

        // persist individual instance report
        await context.out.write({
          name: `instances/${instance.identifier}/performance_insights_report.json`,
          data: JSON.stringify(report, null, 2),
        });

        return report;
      }),
    );

    // step 3: generate and write output files
    context.log.info('🌸 step 3: generating output files...', {});

    // collect all output lines
    const allOutputLines: string[] = [];
    allOutputLines.push('🌸 Performance Insights Opportunities Report:\n');

    for (const report of reports) {
      // generate report section
      const reportLines: string[] = [];

      reportLines.push(`📊 ${report.instanceIdentifier}:\n`);

      // add summary
      reportLines.push(`Summary:`);
      reportLines.push(`  ${report.summary}\n`);

      // add top queries
      reportLines.push(`Top Queries to Investigate:`);
      for (const [index, query] of report.topQueries.entries()) {
        reportLines.push(
          `\n${index + 1}. SQL ID: ${query.sqlId.substring(0, 16)}...`,
        );
        reportLines.push(`   DB Load: ${query.dbLoad.toFixed(6)}`);
        if (query.executionCount !== undefined) {
          reportLines.push(`   Executions: ${query.executionCount}`);
        }
        if (query.latency !== undefined) {
          reportLines.push(`   Avg Latency: ${query.latency.toFixed(3)}ms`);
        }
        reportLines.push(`   Statement: ${truncateStatement(query.statement)}`);
      }

      reportLines.push('');

      // add to all output
      allOutputLines.push(...reportLines);

      // write individual instance files
      await context.out.write({
        name: `instances/${report.instanceIdentifier}/top_queries.txt`,
        data: reportLines.join('\n'),
      });

      await context.out.write({
        name: `instances/${report.instanceIdentifier}/summary.txt`,
        data: report.summary,
      });
    }

    // write consolidated output file
    await context.out.write({
      name: 'performance_insights_report.txt',
      data: allOutputLines.join('\n'),
    });

    // write final consolidated report
    await context.out.write({
      name: 'final_performance_insights_report.json',
      data: JSON.stringify(reports, null, 2),
    });

    return { reports };
  },
);

// execute the command when run directly
// npx tsx src/skills/monitor/queryApis/detectPerformanceInsightsOpports.ts
if (require.main === module) void command({});

// helper function to execute AWS CLI commands
const execAws = withLogTrail(
  (input: string): string => {
    return execSync(input, { encoding: 'utf-8' }).trim();
  },
  { name: 'execAws', log: { level: LogLevel.INFO } },
);

// helper function to parse JSON
const parseJson = <T>(input: string): T => {
  return JSON.parse(input);
};

/**
 * .what = enumerate Aurora PostgreSQL instances with Performance Insights enabled
 * .why = identifies which instances to query for performance optimization opportunities
 * .note = idempotent; read-only AWS CLI query
 */
const getAuroraPostgresInstances = (
  _: Record<string, never>,
  context: ContextLogTrail,
): DbInstance[] => {
  // query AWS for all Aurora PostgreSQL instances with Performance Insights metadata
  const instancesRaw = execAws(
    "aws rds describe-db-instances --query 'DBInstances[?Engine==`aurora-postgresql`].[DBInstanceIdentifier,DbiResourceId,PerformanceInsightsEnabled]' --output json",
    context,
  );

  // parse response
  const instanceData =
    parseJson<Array<[string, string, boolean]>>(instancesRaw);

  // filter to only instances with Performance Insights enabled
  const piEnabledInstances = instanceData
    .filter(([_id, _resourceId, piEnabled]) => piEnabled === true)
    .map(
      ([identifier, resourceId, performanceInsightsEnabled]) =>
        new DbInstance({
          identifier,
          resourceId,
          performanceInsightsEnabled,
        }),
    );

  return piEnabledInstances.sort((a, b) =>
    a.identifier.localeCompare(b.identifier),
  );
};

/**
 * .what = fetch top queries by database load from Performance Insights
 * .why = identifies queries consuming the most database resources
 * .note = idempotent; read-only Performance Insights query
 */
const getTopQueriesByLoad = async (
  input: {
    resourceId: string;
    periodHours: number;
    maxResults: number;
  },
  context: ContextLogTrail,
): Promise<QueryMetrics[]> => {
  // reject empty resource identifier
  if (!input.resourceId?.trim())
    return BadRequestError.throw('resourceId is required', {
      resourceId: input.resourceId,
    });

  // reject invalid period hours
  if (input.periodHours <= 0 || input.periodHours > 168)
    return BadRequestError.throw('periodHours must be between 1 and 168', {
      periodHours: input.periodHours,
    });

  // define query time window
  const endTime = new Date();
  const startTime = new Date(
    endTime.getTime() - input.periodHours * 60 * 60 * 1000,
  );

  // fetch top queries by db.load
  const queriesRaw = execAws(
    `aws pi describe-dimension-keys ` +
      `--service-type RDS ` +
      `--identifier ${input.resourceId} ` +
      `--start-time ${startTime.toISOString()} ` +
      `--end-time ${endTime.toISOString()} ` +
      `--metric db.load.avg ` +
      `--group-by '{"Group":"db.sql"}' ` +
      `--max-results ${input.maxResults} ` +
      `--output json`,
    context,
  );

  // parse Performance Insights response
  const response = parseJson<{
    Keys: Array<{
      Dimensions: {
        'db.sql.id': string;
        'db.sql.statement': string;
        'db.sql.tokenized_id': string;
      };
      Total: number;
    }>;
  }>(queriesRaw);

  // bailfast if no keys returned
  if (!response.Keys || response.Keys.length === 0) {
    context.log.warn('no query data found in Performance Insights', {
      resourceId: input.resourceId,
    });
    return [];
  }

  // transform to domain objects
  const queries = response.Keys.map(
    (key) =>
      new QueryMetrics({
        sqlId: key.Dimensions['db.sql.id'],
        statement: key.Dimensions['db.sql.statement'],
        tokenizedId: key.Dimensions['db.sql.tokenized_id'],
        dbLoad: key.Total,
      }),
  );

  // sort by db.load descending
  return [...queries].sort((a, b) => b.dbLoad - a.dbLoad);
};

/**
 * .what = generate verbal summary of performance optimization opportunities
 * .why = provides human-readable insights about which queries need attention
 * .note = idempotent; pure function with no side effects
 */
const generatePerformanceSummary = (
  input: {
    instanceIdentifier: string;
    topQueries: QueryMetrics[];
  },
  _context: ContextLogTrail,
): string => {
  const { instanceIdentifier, topQueries } = input;

  // bailfast if no queries
  if (topQueries.length === 0) {
    return `Instance "${instanceIdentifier}" has no significant query load to report.`;
  }

  // calculate total db.load across all top queries
  const totalDbLoad = topQueries.reduce((sum, q) => sum + q.dbLoad, 0);

  // identify queries above significance threshold
  const significantThreshold = 0.001;
  const significantQueries = topQueries.filter(
    (q) => q.dbLoad > significantThreshold,
  );

  // build narrative sentences
  const parts: string[] = [];

  parts.push(
    `Instance "${instanceIdentifier}" has ${topQueries.length} queries tracked over the last 24 hours.`,
  );

  if (significantQueries.length > 0) {
    parts.push(
      `${significantQueries.length} queries show significant database load (>${significantThreshold} avg active sessions).`,
    );

    parts.push(
      `Top query contributes ${topQueries[0]?.dbLoad.toFixed(
        6,
      )} to average database load.`,
    );

    parts.push(
      `Combined database load from tracked queries: ${totalDbLoad.toFixed(
        6,
      )} avg active sessions.`,
    );

    parts.push(
      `Recommend investigating queries with highest load for optimization opportunities.`,
    );
  } else {
    parts.push(
      `All queries show minimal database load - no immediate optimization needed.`,
    );
  }

  return parts.join(' ');
};

/**
 * .what = truncate SQL statement to first 200 characters for readability
 * .why = prevents excessive line lengths in output reports
 * .note = idempotent; pure function
 */
const truncateStatement = (statement: string): string => {
  // normalize whitespace
  const normalized = statement.replace(/\s+/g, ' ').trim();

  // truncate if needed
  if (normalized.length <= 200) return normalized;

  return normalized.substring(0, 197) + '...';
};
