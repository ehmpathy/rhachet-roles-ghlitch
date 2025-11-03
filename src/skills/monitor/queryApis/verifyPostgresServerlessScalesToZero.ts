/**
 * .what = verify Aurora Serverless PostgreSQL clusters can and do scale to zero
 * .why = ensures cost optimization by confirming zero-ACU scaling capability and actual usage
 */
import { asCommand } from '@ehmpathy/as-command';
import { ContextLogTrail, LogLevel, withLogTrail } from 'as-procedure';
import { execSync } from 'child_process';
import { DomainLiteral } from 'domain-objects';
import { BadRequestError, UnexpectedCodePathError } from 'helpful-errors';
import { basename, join } from 'path';
import { generateLogMethods } from 'simple-leveled-log-methods';

const log = generateLogMethods();

class ServerlessV2ScalingConfig
  extends DomainLiteral<ServerlessV2ScalingConfig>
  implements ServerlessV2ScalingConfig
{
  MinCapacity!: number;
  MaxCapacity!: number;
  SecondsUntilAutoPause?: number;
}

class ScalingVerification
  extends DomainLiteral<ScalingVerification>
  implements ScalingVerification
{
  clusterIdentifier!: string;
  minCapacityIsZero!: boolean;
  timeoutIs5Minutes!: boolean;
  scaledToZeroInPastWeek!: boolean;
  scaledToZeroInPast24Hours!: boolean;
  blockerIssues!: string[];
  nitpickIssues!: string[];
  scalingConfig!: ServerlessV2ScalingConfig;
}

// npx tsx src/skills/monitor/queryApis/verifyPostgresServerlessScalesToZero.ts
export const command = asCommand(
  {
    name: basename(__filename, '.ts'),
    purpose:
      'verify Aurora Serverless PostgreSQL clusters can and do scale to zero',
    stage: process.env.STAGE || 'local',
    dir: join(__dirname, '.rhachet'),
    log,
  },
  async (input, context) => {
    context.log.info(
      '🌊 verifying Aurora Serverless PostgreSQL scale-to-zero capability...',
      {},
    );

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
      return { verifications: [] };
    }

    context.log.info(
      `🌿 found ${clusters.length} Aurora Serverless cluster(s)`,
      {},
    );

    // step 2: verify scaling configuration for each cluster
    context.log.info('🌾 step 2: verifying scaling configurations...', {});

    const verifications: ScalingVerification[] = await Promise.all(
      clusters.map(async (clusterIdentifier) => {
        // fetch cluster scaling configuration
        const scalingConfig = getServerlessV2ScalingConfig(
          { clusterIdentifier },
          context,
        );

        // verify min capacity is zero (blocker)
        const minCapacityIsZero = scalingConfig.MinCapacity === 0;
        const blockerIssues: string[] = [];
        if (!minCapacityIsZero) {
          blockerIssues.push(
            `MinCapacity is ${scalingConfig.MinCapacity}, expected 0`,
          );
        }

        // verify timeout is 5 minutes (nitpick)
        // note: AWS defaults to 300 but doesn't return it in API when using default
        const effectiveTimeout =
          scalingConfig.SecondsUntilAutoPause ??
          (scalingConfig.MinCapacity === 0 ? 300 : undefined);
        const timeoutIs5Minutes = effectiveTimeout === 300;
        const nitpickIssues: string[] = [];
        if (!timeoutIs5Minutes) {
          nitpickIssues.push(
            `SecondsUntilAutoPause is ${
              scalingConfig.SecondsUntilAutoPause ?? 'default (300)'
            }, recommended 300`,
          );
        }

        // verify cluster has scaled to zero in past week (blocker)
        const scaledToZeroInPastWeek = await hasScaledToZero(
          { clusterIdentifier, periodHours: 168 },
          context,
        );
        if (!scaledToZeroInPastWeek) {
          blockerIssues.push('Cluster has not scaled to zero in the past week');
        }

        // verify cluster has scaled to zero in past 24 hours (nitpick)
        const scaledToZeroInPast24Hours = await hasScaledToZero(
          { clusterIdentifier, periodHours: 24 },
          context,
        );
        if (!scaledToZeroInPast24Hours) {
          nitpickIssues.push(
            'Cluster has not scaled to zero in the past 24 hours',
          );
        }

        // assemble verification result
        const verification: ScalingVerification = {
          clusterIdentifier,
          minCapacityIsZero,
          timeoutIs5Minutes,
          scaledToZeroInPastWeek,
          scaledToZeroInPast24Hours,
          blockerIssues,
          nitpickIssues,
          scalingConfig,
        };

        // persist individual cluster verification
        await context.out.write({
          name: `clusters/${clusterIdentifier}/verification.json`,
          data: JSON.stringify(verification, null, 2),
        });

        return verification;
      }),
    );

    // step 3: generate output report
    context.log.info('🌸 step 3: generating verification report...', {});

    const reportLines: string[] = [];
    reportLines.push(
      '🌸 Aurora Serverless Scale-to-Zero Verification Report\n',
    );

    for (const verification of verifications) {
      reportLines.push(`📊 ${verification.clusterIdentifier}:\n`);

      // report scaling configuration
      reportLines.push(`Configuration:`);
      reportLines.push(
        `  MinCapacity: ${verification.scalingConfig.MinCapacity} ${
          verification.minCapacityIsZero ? '✅' : '❌ BLOCKER'
        }`,
      );
      reportLines.push(
        `  MaxCapacity: ${verification.scalingConfig.MaxCapacity}`,
      );
      reportLines.push(
        `  SecondsUntilAutoPause: ${
          verification.scalingConfig.SecondsUntilAutoPause ?? 'default (300s)'
        } ${verification.timeoutIs5Minutes ? '✅' : '⚠️  NITPICK'}`,
      );

      // add explanation for undefined SecondsUntilAutoPause
      if (
        verification.scalingConfig.SecondsUntilAutoPause === undefined &&
        verification.scalingConfig.MinCapacity === 0
      ) {
        reportLines.push(
          `    Note: AWS omits SecondsUntilAutoPause from API when using default 300s`,
        );
      }

      reportLines.push('');

      // report scaling behavior
      reportLines.push(`Scaling Behavior:`);
      reportLines.push(
        `  Scaled to zero in past week: ${
          verification.scaledToZeroInPastWeek ? '✅' : '❌ BLOCKER'
        }`,
      );
      reportLines.push(
        `  Scaled to zero in past 24hrs: ${
          verification.scaledToZeroInPast24Hours ? '✅' : '⚠️  NITPICK'
        }`,
      );

      reportLines.push('');

      // report issues
      if (verification.blockerIssues.length > 0) {
        reportLines.push(`❌ Blocker Issues:`);
        for (const issue of verification.blockerIssues) {
          reportLines.push(`  - ${issue}`);
        }
        reportLines.push('');
      }

      if (verification.nitpickIssues.length > 0) {
        reportLines.push(`⚠️  Nitpick Issues:`);
        for (const issue of verification.nitpickIssues) {
          reportLines.push(`  - ${issue}`);
        }
        reportLines.push('');
      }

      // write individual cluster report
      await context.out.write({
        name: `clusters/${verification.clusterIdentifier}/report.txt`,
        data: reportLines.join('\n'),
      });
    }

    // write consolidated report
    await context.out.write({
      name: 'verification_report.txt',
      data: reportLines.join('\n'),
    });

    // write final verification results
    await context.out.write({
      name: 'final_verification_results.json',
      data: JSON.stringify(verifications, null, 2),
    });

    // log summary
    const totalBlockers = verifications.reduce(
      (sum, v) => sum + v.blockerIssues.length,
      0,
    );
    const totalNitpicks = verifications.reduce(
      (sum, v) => sum + v.nitpickIssues.length,
      0,
    );

    context.log.info(
      `🌻 summary: verified ${verifications.length} cluster(s) with ${totalBlockers} blocker(s) and ${totalNitpicks} nitpick(s)`,
      {},
    );

    // throw if blockers found
    if (totalBlockers > 0) {
      const blockerMessages = verifications
        .filter((v) => v.blockerIssues.length > 0)
        .map((v) => `${v.clusterIdentifier}: ${v.blockerIssues.join(', ')}`);
      return UnexpectedCodePathError.throw(
        'scale-to-zero verification failed with blocker issues',
        { blockerMessages },
      );
    }

    return { verifications };
  },
);

// execute the command when run directly
// npx tsx src/skills/monitor/queryApis/verifyPostgresServerlessScalesToZero.ts
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
 * .what = enumerate Aurora Serverless PostgreSQL clusters (v2 only)
 * .why = identifies which clusters to verify for scale-to-zero capability
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

  // filter to only serverless v2 clusters (v1 does not support MinCapacity=0)
  const serverlessV2Clusters = clusterData
    .filter(([_id, _engineMode, v2Config]) => {
      const isV2 = v2Config !== null && v2Config !== undefined;
      return isV2;
    })
    .map(([id]) => id);

  return serverlessV2Clusters.sort();
};

/**
 * .what = fetch ServerlessV2ScalingConfiguration for a cluster
 * .why = retrieves min/max capacity and auto-pause timeout settings
 * .note = idempotent; read-only AWS CLI query
 */
const getServerlessV2ScalingConfig = (
  input: { clusterIdentifier: string },
  context: ContextLogTrail,
): ServerlessV2ScalingConfig => {
  // reject empty cluster identifier
  if (!input.clusterIdentifier?.trim())
    return BadRequestError.throw('clusterIdentifier is required', {
      clusterIdentifier: input.clusterIdentifier,
    });

  // query cluster details
  const clusterRaw = execAws(
    `aws rds describe-db-clusters --db-cluster-identifier ${input.clusterIdentifier} --query 'DBClusters[0].ServerlessV2ScalingConfiguration' --output json`,
    context,
  );

  // parse scaling configuration
  const scalingConfig = parseJson<{
    MinCapacity: number;
    MaxCapacity: number;
    SecondsUntilAutoPause?: number;
  }>(clusterRaw);

  // reject if not serverless v2
  if (!scalingConfig || typeof scalingConfig.MinCapacity !== 'number')
    return UnexpectedCodePathError.throw(
      'cluster is not Aurora Serverless v2',
      { clusterIdentifier: input.clusterIdentifier, scalingConfig },
    );

  return scalingConfig;
};

/**
 * .what = check if cluster has scaled to zero ACU within the specified period
 * .why = verifies that scale-to-zero is actually occurring in production
 * .note = idempotent; read-only CloudWatch query
 */
const hasScaledToZero = async (
  input: { clusterIdentifier: string; periodHours: number },
  context: ContextLogTrail,
): Promise<boolean> => {
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

  // calculate appropriate period to stay under CloudWatch 1440 datapoint limit
  const periodSeconds = Math.max(
    300,
    Math.ceil((input.periodHours * 3600) / 1440),
  );

  // query CloudWatch for minimum ACU capacity
  const metricsRaw = execAws(
    `aws cloudwatch get-metric-statistics ` +
      `--namespace AWS/RDS ` +
      `--metric-name ServerlessDatabaseCapacity ` +
      `--dimensions Name=DBClusterIdentifier,Value=${input.clusterIdentifier} ` +
      `--start-time ${startTime.toISOString()} ` +
      `--end-time ${endTime.toISOString()} ` +
      `--period ${periodSeconds} ` +
      `--statistics Minimum ` +
      `--output json`,
    context,
  );

  // parse CloudWatch response
  const metrics = parseJson<{
    Datapoints: Array<{ Timestamp: string; Minimum: number }>;
  }>(metricsRaw);

  // bailfast if no data points
  if (metrics.Datapoints.length === 0) {
    context.log.warn(
      `no CloudWatch data points found for cluster ${input.clusterIdentifier} in the past ${input.periodHours} hours`,
      {},
    );
    return false;
  }

  // check if any data point shows zero capacity
  const hasZeroCapacity = metrics.Datapoints.some((dp) => dp.Minimum === 0);

  return hasZeroCapacity;
};
