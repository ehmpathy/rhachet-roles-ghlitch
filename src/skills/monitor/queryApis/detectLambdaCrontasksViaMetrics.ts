/**
 * .what = detect AWS Lambda functions with crontask-like behavior via CloudWatch metrics
 * .why = identifies cron jobs by analyzing invocation patterns rather than trigger configurations
 * .note = complements trigger-based detection by catching crontasks regardless of trigger mechanism
 */
import { asCommand } from '@ehmpathy/as-command';
import { ContextLogTrail, LogLevel, withLogTrail } from 'as-procedure';
import Bottleneck from 'bottleneck';
import { execSync } from 'child_process';
import { DomainLiteral } from 'domain-objects';
import { BadRequestError } from 'helpful-errors';
import { basename, join } from 'path';
import { generateLogMethods } from 'simple-leveled-log-methods';
import { withSimpleCachingOnDisk } from 'with-simple-caching';
import { withRetry } from 'wrapper-fns';

const log = generateLogMethods();

class InvocationMetrics
  extends DomainLiteral<InvocationMetrics>
  implements InvocationMetrics
{
  functionName!: string;
  datapoints!: Array<{ timestamp: string; invocations: number }>;
  totalInvocations!: number;
  invocationIntervals!: number[];
  meanIntervalMinutes?: number;
  stdDevIntervalMinutes?: number;
  isRegularPattern!: boolean;
}

class LambdaWithCrontaskBehavior
  extends DomainLiteral<LambdaWithCrontaskBehavior>
  implements LambdaWithCrontaskBehavior
{
  functionName!: string;
  meanIntervalMinutes!: number;
  stdDevIntervalMinutes!: number;
  totalInvocations!: number;
  confidence!: 'high' | 'medium' | 'low';
}

// npx tsx src/skills/monitor/queryApis/detectLambdaCrontasksViaMetrics.ts
export const command = asCommand(
  {
    name: basename(__filename, '.ts'),
    purpose:
      'detect AWS Lambda functions with crontask-like behavior via CloudWatch metrics',
    stage: process.env.STAGE || 'local',
    dir: join(__dirname, '.rhachet'),
    log,
  },
  async (input, context) => {
    context.log.info(
      '🌊 detecting Lambda crontasks via invocation metrics...',
      {},
    );

    // step 1: enumerate all Lambda functions
    context.log.info('🌱 step 1: enumerating all Lambda functions...', {});
    const lambdaFunctions = getLambdaFunctions({}, context);

    await context.out.write({
      name: 'lambda_functions.json',
      data: JSON.stringify(lambdaFunctions, null, 2),
    });

    // bailfast if no functions found
    if (lambdaFunctions.length === 0) {
      context.log.warn(
        '🍂 no Lambda functions found in this AWS account/region.',
        {},
      );
      return {
        lambdasWithCrontaskBehavior: [],
        totalFunctions: 0,
        functionsWithCrontaskBehavior: 0,
      };
    }

    context.log.info(
      `🌿 found ${lambdaFunctions.length} Lambda function(s)`,
      {},
    );

    // step 2: fetch invocation metrics for all functions in parallel
    context.log.info(
      '🌾 step 2: fetching invocation metrics for past 24 hours...',
      {},
    );

    // instantiate bottleneck to limit concurrency
    const bottleneck = new Bottleneck({ maxConcurrent: 100 });

    // fetch metrics for all functions
    const metricsResults: InvocationMetrics[] = await Promise.all(
      lambdaFunctions.map(
        bottleneck.wrap(async (functionName: string) => {
          const metrics = await getLambdaInvocationMetrics(
            { functionName, periodHours: 24 },
            context,
          );

          // persist individual function metrics
          await context.out.write({
            name: `functions/${functionName}/invocation_metrics.json`,
            data: JSON.stringify(metrics, null, 2),
          });

          return metrics;
        }),
      ),
    );

    // step 3: analyze patterns to detect crontask behavior
    context.log.info(
      '🌸 step 3: analyzing invocation patterns for crontask behavior...',
      {},
    );

    // filter to functions with regular invocation patterns
    const lambdasWithCrontaskBehavior: LambdaWithCrontaskBehavior[] =
      metricsResults
        .filter((metrics) => metrics.isRegularPattern)
        .map((metrics) => {
          // determine confidence level based on standard deviation
          const cvPercent = metrics.stdDevIntervalMinutes
            ? (metrics.stdDevIntervalMinutes / metrics.meanIntervalMinutes!) *
              100
            : 0;

          const confidence: 'high' | 'medium' | 'low' =
            cvPercent < 10 ? 'high' : cvPercent < 25 ? 'medium' : 'low';

          return {
            functionName: metrics.functionName,
            meanIntervalMinutes: metrics.meanIntervalMinutes!,
            stdDevIntervalMinutes: metrics.stdDevIntervalMinutes!,
            totalInvocations: metrics.totalInvocations,
            confidence,
          };
        })
        .sort((a, b) => a.meanIntervalMinutes - b.meanIntervalMinutes);

    // write final results
    await context.out.write({
      name: 'final_results.json',
      data: JSON.stringify(lambdasWithCrontaskBehavior, null, 2),
    });

    // step 4: output results
    context.log.info(
      '🌻 step 4: Lambda functions with crontask-like behavior:',
      {},
    );

    // bailfast if no crontasks detected
    if (lambdasWithCrontaskBehavior.length === 0) {
      context.log.info(
        '🌙 no Lambda functions with crontask-like behavior detected.',
        {},
      );
    } else {
      context.log.info(
        JSON.stringify(lambdasWithCrontaskBehavior, null, 2),
        {},
      );
      context.log.info(
        `🌻 summary: found ${lambdasWithCrontaskBehavior.length} Lambda function(s) with crontask-like behavior`,
        {},
      );
    }

    return {
      lambdasWithCrontaskBehavior,
      totalFunctions: lambdaFunctions.length,
      functionsWithCrontaskBehavior: lambdasWithCrontaskBehavior.length,
    };
  },
);

// execute the command when run directly
// npx tsx src/skills/monitor/queryApis/detectLambdaCrontasksViaMetrics.ts
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
 * .what = enumerate all Lambda functions in the current AWS account and region
 * .why = provides the list of functions to analyze for crontask behavior
 * .note = idempotent; read-only AWS CLI query
 */
const getLambdaFunctions = (
  _: Record<string, never>,
  context: ContextLogTrail,
): string[] => {
  const lambdaFunctionsRaw = execAws(
    "aws lambda list-functions --query 'Functions[].FunctionName' --output json",
    context,
  );
  return parseJson<string[]>(lambdaFunctionsRaw).sort();
};

/**
 * .what = detect regular cadence within intervals by finding recurring patterns
 * .why = identifies cron behavior even when sporadic user calls are mixed in
 * .note = groups intervals into buckets and finds most frequent recurring pattern
 */
const detectRegularCadence = (
  intervals: number[],
): { interval: number; stdDev: number; occurrences: number } | null => {
  // reject insufficient data
  if (intervals.length < 3) return null;

  // group intervals into buckets (tolerance ±10% to allow for minor variations)
  const buckets = new Map<number, number[]>();

  for (const interval of intervals) {
    // skip very short intervals (< 1 minute) as noise
    if (interval < 1) continue;

    // find existing bucket within ±10% tolerance
    let matchedBucket: number | null = null;
    for (const bucketKey of buckets.keys()) {
      const tolerance = bucketKey * 0.1;
      if (Math.abs(interval - bucketKey) <= tolerance) {
        matchedBucket = bucketKey;
        break;
      }
    }

    // add to existing bucket or create new one
    if (matchedBucket !== null) {
      buckets.get(matchedBucket)!.push(interval);
    } else {
      buckets.set(interval, [interval]);
    }
  }

  // reject if no buckets found
  if (buckets.size === 0) return null;

  // find bucket with most occurrences
  let bestBucket: { key: number; values: number[] } | null = null;
  for (const [key, values] of buckets.entries()) {
    if (!bestBucket || values.length > bestBucket.values.length) {
      bestBucket = { key, values };
    }
  }

  // reject if best bucket has too few occurrences (need at least 3)
  if (!bestBucket || bestBucket.values.length < 3) return null;

  // calculate mean and standard deviation of best bucket
  const mean =
    bestBucket.values.reduce((sum, val) => sum + val, 0) /
    bestBucket.values.length;

  const squaredDiffs = bestBucket.values.map((val) => Math.pow(val - mean, 2));
  const variance =
    squaredDiffs.reduce((sum, val) => sum + val, 0) /
    bestBucket.values.length;
  const stdDev = Math.sqrt(variance);

  // reject if coefficient of variation is too high (>50%)
  const cvPercent = (stdDev / mean) * 100;
  if (cvPercent > 50) return null;

  return {
    interval: mean,
    stdDev,
    occurrences: bestBucket.values.length,
  };
};

/**
 * .what = fetch Lambda invocation metrics from CloudWatch with 1-minute granularity
 * .why = enables detection of regular invocation patterns characteristic of cron jobs
 * .note = idempotent; read-only CloudWatch query
 */
const getLambdaInvocationMetrics = withRetry(
  withSimpleCachingOnDisk(
    async (
      input: { functionName: string; periodHours: number },
      context: ContextLogTrail,
    ): Promise<InvocationMetrics> => {
      // reject empty function name
      if (!input.functionName?.trim())
        return BadRequestError.throw('functionName is required', {
          functionName: input.functionName,
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

      // use 1-minute granularity to detect precise invocation patterns
      const periodSeconds = 60;

      // query CloudWatch for invocation counts
      const metricsRaw = execAws(
        `aws cloudwatch get-metric-statistics ` +
          `--namespace AWS/Lambda ` +
          `--metric-name Invocations ` +
          `--dimensions Name=FunctionName,Value=${input.functionName} ` +
          `--start-time ${startTime.toISOString()} ` +
          `--end-time ${endTime.toISOString()} ` +
          `--period ${periodSeconds} ` +
          `--statistics Sum ` +
          `--output json`,
        context,
      );

      // parse CloudWatch response
      const metrics = parseJson<{
        Datapoints: Array<{ Timestamp: string; Sum: number }>;
      }>(metricsRaw);

      // sort datapoints by timestamp
      const sortedDatapoints = metrics.Datapoints.sort(
        (a, b) =>
          new Date(a.Timestamp).getTime() - new Date(b.Timestamp).getTime(),
      );

      // extract invocation timestamps (only minutes with invocations)
      const invocationDatapoints = sortedDatapoints
        .filter((dp) => dp.Sum > 0)
        .map((dp) => ({
          timestamp: dp.Timestamp,
          invocations: dp.Sum,
        }));

      // calculate total invocations
      const totalInvocations = invocationDatapoints.reduce(
        (sum, dp) => sum + dp.invocations,
        0,
      );

      // calculate intervals between invocations in minutes
      const invocationIntervals: number[] = [];
      for (let i = 1; i < invocationDatapoints.length; i++) {
        const prevTime = new Date(invocationDatapoints[i - 1]!.timestamp);
        const currTime = new Date(invocationDatapoints[i]!.timestamp);
        const intervalMinutes =
          (currTime.getTime() - prevTime.getTime()) / 60000;
        invocationIntervals.push(intervalMinutes);
      }

      // detect regular cadence by finding recurring intervals
      let meanIntervalMinutes: number | undefined;
      let stdDevIntervalMinutes: number | undefined;
      let isRegularPattern = false;

      if (invocationIntervals.length >= 3) {
        // find most common interval pattern (allowing for sporadic calls)
        const regularCadence = detectRegularCadence(invocationIntervals);

        if (regularCadence) {
          meanIntervalMinutes = regularCadence.interval;
          stdDevIntervalMinutes = regularCadence.stdDev;
          isRegularPattern = true;
        }
      }

      return {
        functionName: input.functionName,
        datapoints: invocationDatapoints,
        totalInvocations,
        invocationIntervals,
        meanIntervalMinutes,
        stdDevIntervalMinutes,
        isRegularPattern,
      };
    },
    {
      directory: {
        mounted: {
          path: join(
            __dirname,
            '.cache',
            new Date().toISOString().split('T')[0]!, // reuse per day only
          ),
        },
      },
      procedure: { name: 'getLambdaInvocationMetrics', version: 'v2025_11_04' },
    },
  ),
);
