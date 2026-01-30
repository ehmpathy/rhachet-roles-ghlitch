/**
 * .what = report Aurora Serverless PostgreSQL capacity usage from CloudWatch
 * .why = provides visibility into min, max, and average ACU consumption patterns
 */
import { asCommand } from '@ehmpathy/as-command';
import { ContextLogTrail, LogLevel, withLogTrail } from 'as-procedure';
import { execSync } from 'child_process';
import { DomainLiteral } from 'domain-objects';
import { BadRequestError } from 'helpful-errors';
import { basename, join } from 'path';
import { generateLogMethods } from 'simple-leveled-log-methods';

const log = generateLogMethods();

const ACU_HISTOGRAM_SCALE_FACTOR = 2;

class MetricStats extends DomainLiteral<MetricStats> implements MetricStats {
  min!: number;
  max!: number;
  avg!: number;
}

class HourlyStats extends DomainLiteral<HourlyStats> implements HourlyStats {
  hour!: string;
  metrics!: Record<string, MetricStats>;
  dataPoints!: number;
}

class UtilizationReport
  extends DomainLiteral<UtilizationReport>
  implements UtilizationReport
{
  clusterIdentifier!: string;
  periodHours!: number;
  hourlyStats!: HourlyStats[];
  overallMetrics!: Record<string, MetricStats>;
  summary!: string;
}

const MONITORED_METRICS = [
  'ServerlessDatabaseCapacity',
  'ACUUtilization',
  'CPUUtilization',
  'DatabaseConnections',
  'ReadIOPS',
  'WriteIOPS',
  'ReadLatency',
  'WriteLatency',
] as const;

// npx tsx src/skills/monitor/queryApis/reportPostgresServerlessUsage.ts
export const command = asCommand(
  {
    name: basename(__filename, '.ts'),
    purpose: 'report Aurora Serverless PostgreSQL ACU usage statistics',
    stage: process.env.STAGE || 'local',
    dir: join(__dirname, '.rhachet'),
    log,
  },
  async (input, context) => {
    context.log.info('🌊 reporting Aurora Serverless PostgreSQL usage...', {});

    // step 1: identify Aurora Serverless clusters
    context.log.info(
      '🌱 step 1: identifying Aurora Serverless clusters...',
      {},
    );
    const clusters = getAuroraServerlessClusters({}, context);

    await context.out.write({
      name: 'aurora_serverless_clusters.json',
      data: JSON.stringify(clusters, null, 2),
    });

    // bailfast if no clusters found
    if (clusters.length === 0) {
      context.log.warn(
        '🍂 no Aurora Serverless clusters found in this AWS account/region.',
        {},
      );
      return { reports: [] };
    }

    context.log.info(
      `🌿 found ${clusters.length} Aurora Serverless cluster(s)`,
      {},
    );

    // step 2: fetch all metrics for each cluster
    context.log.info('🌾 step 2: fetching CloudWatch metrics...', {});

    const reports: UtilizationReport[] = await Promise.all(
      clusters.map(async (clusterIdentifier) => {
        // fetch last 24 hours of all monitored metrics
        const metricsData = await getAllMetrics(
          {
            clusterIdentifier,
            periodHours: 24,
            metrics: [...MONITORED_METRICS],
          },
          context,
        );

        // calculate hourly statistics across all metrics
        const hourlyStats = calculateHourlyStatsMultiMetric(
          { metricsData },
          context,
        );

        // calculate overall statistics across all metrics
        const overallMetrics = calculateOverallMetrics(
          { metricsData },
          context,
        );

        // generate verbal summary
        const summary = generateUtilizationSummary(
          {
            clusterIdentifier,
            hourlyStats,
            overallMetrics,
          },
          context,
        );

        // assemble cluster report
        const report: UtilizationReport = {
          clusterIdentifier,
          periodHours: 24,
          summary,
          overallMetrics,
          hourlyStats,
        };

        // persist individual cluster report
        await context.out.write({
          name: `clusters/${clusterIdentifier}/utilization_report.json`,
          data: JSON.stringify(report, null, 2),
        });

        return report;
      }),
    );

    // step 3: generate and write output files
    context.log.info('🌸 step 3: generating output files...', {});

    // collect all output lines
    const allOutputLines: string[] = [];
    allOutputLines.push('🌸 step 3: ACU usage report:\n');

    for (const report of reports) {
      // generate report section
      const reportLines: string[] = [];

      reportLines.push(`📊 ${report.clusterIdentifier}:\n`);

      // add summary
      reportLines.push(`Summary:`);
      reportLines.push(`  ${report.summary}\n`);

      // add overall metrics
      reportLines.push(`Overall Metrics:`);
      for (const [metricName, stats] of Object.entries(report.overallMetrics)) {
        const displayName = metricName.replace(
          'ServerlessDatabaseCapacity',
          'ACU',
        );
        reportLines.push(
          `  ${displayName.padEnd(25)}: min=${stats.min
            .toFixed(2)
            .padStart(8)} max=${stats.max
            .toFixed(2)
            .padStart(8)} avg=${stats.avg.toFixed(2).padStart(8)}`,
        );
      }

      reportLines.push('');

      // add hourly histogram for ACU
      reportLines.push(`Hourly ACU Histogram:`);
      for (const stats of report.hourlyStats) {
        const acuStats =
          stats.metrics.ServerlessDatabaseCapacity || stats.metrics.ACU;
        if (!acuStats) continue;

        const bar = '█'.repeat(
          Math.ceil(acuStats.avg / ACU_HISTOGRAM_SCALE_FACTOR),
        );
        reportLines.push(
          `  ${stats.hour}  min=${acuStats.min
            .toFixed(2)
            .padStart(6)} max=${acuStats.max
            .toFixed(2)
            .padStart(6)} avg=${acuStats.avg.toFixed(2).padStart(6)} ${bar}`,
        );
      }

      reportLines.push('');

      // add to all output
      allOutputLines.push(...reportLines);

      // write individual cluster files
      await context.out.write({
        name: `clusters/${report.clusterIdentifier}/histogram.txt`,
        data: reportLines.join('\n'),
      });

      await context.out.write({
        name: `clusters/${report.clusterIdentifier}/summary.txt`,
        data: report.summary,
      });
    }

    // write consolidated output file
    await context.out.write({
      name: 'acu_usage_report.txt',
      data: allOutputLines.join('\n'),
    });

    // write final consolidated report
    await context.out.write({
      name: 'final_utilization_report.json',
      data: JSON.stringify(reports, null, 2),
    });

    return { reports };
  },
);

// execute the command when run directly
// npx tsx src/skills/monitor/queryApis/reportPostgresServerlessUsage.ts
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
 * .what = enumerate Aurora Serverless PostgreSQL clusters (v1 and v2)
 * .why = identifies which clusters to monitor for ACU capacity usage
 * .note = idempotent; read-only AWS CLI query
 */
const getAuroraServerlessClusters = (
  _: Record<string, never>,
  context: ContextLogTrail,
): string[] => {
  // query AWS for all Aurora PostgreSQL clusters with metadata
  const clustersRaw = execAws(
    "aws rds describe-db-clusters --query 'DBClusters[?Engine==`aurora-postgresql`].[DBClusterIdentifier,EngineMode,ServerlessV2ScalingConfiguration]' --output json",
    context,
  );

  // parse response
  const clusterData =
    parseJson<Array<[string, string | null, Record<string, unknown> | null]>>(
      clustersRaw,
    );

  // filter to only serverless variants (v1 or v2)
  const serverlessClusters = clusterData
    .filter(([_id, engineMode, v2Config]) => {
      const isV1 = engineMode === 'serverless';
      const isV2 = v2Config !== null && v2Config !== undefined;
      return isV1 || isV2;
    })
    .map(([id]) => id);

  return serverlessClusters.sort();
};

/**
 * .what = fetch all monitored CloudWatch metrics for a cluster
 * .why = retrieves comprehensive metrics to understand ACU usage drivers
 * .note = idempotent; read-only CloudWatch query
 */
const getAllMetrics = async (
  input: {
    clusterIdentifier: string;
    periodHours: number;
    metrics: readonly string[];
  },
  context: ContextLogTrail,
): Promise<Record<string, Array<{ timestamp: string; value: number }>>> => {
  // reject empty cluster identifier
  if (!input.clusterIdentifier?.trim())
    return BadRequestError.throw('clusterIdentifier is required', {
      clusterIdentifier: input.clusterIdentifier,
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

  // fetch all metrics in parallel
  const metricsData = await Promise.all(
    input.metrics.map(async (metricName) => {
      const metricsRaw = execAws(
        `aws cloudwatch get-metric-statistics ` +
          `--namespace AWS/RDS ` +
          `--metric-name ${metricName} ` +
          `--dimensions Name=DBClusterIdentifier,Value=${input.clusterIdentifier} ` +
          `--start-time ${startTime.toISOString()} ` +
          `--end-time ${endTime.toISOString()} ` +
          `--period 60 ` +
          `--statistics Average ` +
          `--output json`,
        context,
      );

      // parse CloudWatch response
      const metrics = parseJson<{
        Datapoints: Array<{ Timestamp: string; Average: number }>;
      }>(metricsRaw);

      // transform and sort
      const dataPoints = metrics.Datapoints.map((dp) => ({
        timestamp: dp.Timestamp,
        value: Math.round(dp.Average * 100) / 100,
      })).sort((a, b) => a.timestamp.localeCompare(b.timestamp));

      return [metricName, dataPoints] as const;
    }),
  );

  return Object.fromEntries(metricsData);
};

/**
 * .what = calculate hourly stats for all metrics
 * .why = generates hourly buckets across all monitored metrics
 * .note = idempotent; pure function with no side effects
 */
const calculateHourlyStatsMultiMetric = (
  input: {
    metricsData: Record<string, Array<{ timestamp: string; value: number }>>;
  },
  _context: ContextLogTrail,
): HourlyStats[] => {
  // collect all unique hours across all metrics
  const allHours = new Set<string>();
  for (const dataPoints of Object.values(input.metricsData)) {
    for (const dp of dataPoints) {
      allHours.add(dp.timestamp.substring(0, 13));
    }
  }

  // bailfast if no data
  if (allHours.size === 0) return [];

  // calculate stats for each hour across all metrics
  const stats: HourlyStats[] = Array.from(allHours).map((hour) => {
    const metrics: Record<string, MetricStats> = {};

    // calculate stats for each metric in this hour
    for (const [metricName, dataPoints] of Object.entries(input.metricsData)) {
      const hourValues = dataPoints
        .filter((dp) => dp.timestamp.startsWith(hour))
        .map((dp) => dp.value);

      if (hourValues.length > 0) {
        metrics[metricName] = {
          min: Math.min(...hourValues),
          max: Math.max(...hourValues),
          avg:
            Math.round(
              (hourValues.reduce((sum, v) => sum + v, 0) / hourValues.length) *
                100,
            ) / 100,
        };
      }
    }

    return {
      hour,
      metrics,
      dataPoints: Object.values(metrics)[0]?.avg ? 1 : 0,
    };
  });

  // sort chronologically
  return [...stats].sort((a, b) => a.hour.localeCompare(b.hour));
};

/**
 * .what = calculate overall stats across all metrics
 * .why = provides summary statistics for the entire period
 * .note = idempotent; pure function with no side effects
 */
const calculateOverallMetrics = (
  input: {
    metricsData: Record<string, Array<{ timestamp: string; value: number }>>;
  },
  _context: ContextLogTrail,
): Record<string, MetricStats> => {
  const overall: Record<string, MetricStats> = {};

  // calculate overall stats for each metric
  for (const [metricName, dataPoints] of Object.entries(input.metricsData)) {
    const values = dataPoints.map((dp) => dp.value);

    if (values.length > 0) {
      overall[metricName] = {
        min: Math.min(...values),
        max: Math.max(...values),
        avg:
          Math.round(
            (values.reduce((sum, v) => sum + v, 0) / values.length) * 100,
          ) / 100,
      };
    }
  }

  return overall;
};

/**
 * .what = generate verbal summary of cluster utilization patterns
 * .why = provides human-readable insights about capacity usage trends
 * .note = idempotent; pure function with no side effects
 */
const generateUtilizationSummary = (
  input: {
    clusterIdentifier: string;
    hourlyStats: HourlyStats[];
    overallMetrics: Record<string, MetricStats>;
  },
  _context: ContextLogTrail,
): string => {
  const { clusterIdentifier, hourlyStats, overallMetrics } = input;

  // extract ACU stats
  const acuStats =
    overallMetrics.ServerlessDatabaseCapacity || overallMetrics.ACU;
  if (!acuStats)
    return `Cluster "${clusterIdentifier}" has no ACU data available.`;

  // compute capacity range and variance percentage
  const capacityRange = acuStats.max - acuStats.min;
  const utilizationSpread =
    acuStats.max > 0 ? (capacityRange / acuStats.max) * 100 : 0;

  // find peak and lowest ACU hours
  const acuByHour = hourlyStats
    .map((stats) => ({
      hour: stats.hour,
      acu:
        stats.metrics.ServerlessDatabaseCapacity?.avg ||
        stats.metrics.ACU?.avg ||
        0,
    }))
    .filter((h) => h.acu > 0);

  const peakHour = acuByHour.reduce((peak, current) =>
    current.acu > peak.acu ? current : peak,
  );

  const lowestHour = acuByHour.reduce((lowest, current) =>
    current.acu < lowest.acu ? current : lowest,
  );

  // build narrative sentences
  const parts: string[] = [];

  parts.push(
    `Cluster "${clusterIdentifier}" averaged ${acuStats.avg.toFixed(
      1,
    )} ACU over the last 24 hours.`,
  );

  parts.push(
    `Capacity ranged from ${acuStats.min.toFixed(2)} to ${acuStats.max.toFixed(
      2,
    )} ACU (${utilizationSpread.toFixed(0)}% spread).`,
  );

  parts.push(
    `Peak usage occurred at ${peakHour.hour.substring(
      11,
    )} UTC with ${peakHour.acu.toFixed(2)} ACU average.`,
  );

  parts.push(
    `Lowest usage occurred at ${lowestHour.hour.substring(
      11,
    )} UTC with ${lowestHour.acu.toFixed(2)} ACU average.`,
  );

  // append variance assessment
  parts.push(getUtilizationVarianceNarrative(utilizationSpread));

  return parts.join(' ');
};

/**
 * .what = map utilization spread percentage to human-readable narrative
 * .why = separates conditional logic from summary generation for cleaner flow
 * .note = idempotent; pure function
 */
const getUtilizationVarianceNarrative = (spread: number): string => {
  if (spread < 30)
    return 'Utilization was relatively stable throughout the period.';
  if (spread < 70)
    return 'Utilization showed moderate variance across the period.';
  return 'Utilization showed high variance, indicating bursty workloads.';
};
