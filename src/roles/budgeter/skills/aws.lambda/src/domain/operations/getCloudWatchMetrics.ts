/**
 * .what = fetch CloudWatch metrics for all Lambda functions using bulk queries
 * .why = efficiently retrieves invocation, duration, and error metrics
 */
import { ContextLogTrail } from 'as-procedure';
import { execAws } from './execAws';

export interface CloudWatchMetricData {
  invocations: Record<string, number>;
  durations: Record<string, number>;
  errors: Record<string, number>;
}

/**
 * .what = query CloudWatch with pagination support
 * .why = handles NextToken to fetch all results beyond 500 limit
 */
const queryCloudWatchWithPagination = (
  input: {
    metricQuery: Array<{ Id: string; Expression: string }>;
    startTime: string;
    endTime: string;
  },
  context: ContextLogTrail,
): Array<{ Label: string; Values: number[] }> => {
  const allResults: Array<{ Label: string; Values: number[] }> = [];
  let nextToken: string | undefined;
  let pageCount = 0;

  // paginate through all results
  do {
    pageCount++;
    const nextTokenParam = nextToken ? `--next-token ${nextToken}` : '';

    const rawOutput = execAws(
      `aws cloudwatch get-metric-data ` +
        `--metric-data-queries ${JSON.stringify(JSON.stringify(input.metricQuery))} ` +
        `--start-time ${input.startTime} ` +
        `--end-time ${input.endTime} ` +
        `${nextTokenParam} ` +
        `--output json`,
      context,
    );

    const data = JSON.parse(rawOutput) as {
      MetricDataResults: Array<{ Label: string; Values: number[] }>;
      NextToken?: string;
    };

    allResults.push(...data.MetricDataResults);
    nextToken = data.NextToken;

    context.log.info(
      `fetched page ${pageCount}, got ${data.MetricDataResults.length} results, nextToken=${!!nextToken}`,
      {},
    );
  } while (nextToken);

  return allResults;
};

export const getCloudWatchMetrics = (
  input: {
    daysLookback: number;
  },
  context: ContextLogTrail,
): CloudWatchMetricData => {
  context.log.info('querying CloudWatch metrics in bulk...', {});

  const metricsStart = new Date(
    Date.now() - input.daysLookback * 24 * 60 * 60 * 1000,
  ).toISOString();
  const metricsEnd = new Date().toISOString();
  const period = 60 * 60 * 24 * input.daysLookback;

  // query invocations with pagination
  context.log.info('querying invocations...', {});
  const invocationsQuery = [
    {
      Id: 'm1',
      Expression: `SEARCH('{AWS/Lambda,FunctionName} MetricName=\"Invocations\"', 'Sum', ${period})`,
    },
  ];

  const invocationsData = queryCloudWatchWithPagination(
    {
      metricQuery: invocationsQuery,
      startTime: metricsStart,
      endTime: metricsEnd,
    },
    context,
  );

  // query durations with pagination
  context.log.info('querying durations...', {});
  const durationsQuery = [
    {
      Id: 'm2',
      Expression: `SEARCH('{AWS/Lambda,FunctionName} MetricName=\"Duration\"', 'Average', ${period})`,
    },
  ];

  const durationsData = queryCloudWatchWithPagination(
    {
      metricQuery: durationsQuery,
      startTime: metricsStart,
      endTime: metricsEnd,
    },
    context,
  );

  // query errors with pagination
  context.log.info('querying errors...', {});
  const errorsQuery = [
    {
      Id: 'm3',
      Expression: `SEARCH('{AWS/Lambda,FunctionName} MetricName=\"Errors\"', 'Sum', ${period})`,
    },
  ];

  const errorsData = queryCloudWatchWithPagination(
    {
      metricQuery: errorsQuery,
      startTime: metricsStart,
      endTime: metricsEnd,
    },
    context,
  );

  // build lookup maps
  const invocations: Record<string, number> = {};
  invocationsData.forEach((result) => {
    if (result.Values.length > 0) {
      invocations[result.Label] = result.Values.reduce(
        (sum, val) => sum + val,
        0,
      );
    }
  });

  const durations: Record<string, number> = {};
  durationsData.forEach((result) => {
    if (result.Values.length > 0) {
      const avg =
        result.Values.reduce((sum, val) => sum + val, 0) /
        result.Values.length;
      durations[result.Label] = avg;
    }
  });

  const errors: Record<string, number> = {};
  errorsData.forEach((result) => {
    if (result.Values.length > 0) {
      errors[result.Label] = result.Values.reduce((sum, val) => sum + val, 0);
    }
  });

  context.log.info(
    `processed metrics for ${Object.keys(invocations).length} functions with invocations`,
    {},
  );

  return { invocations, durations, errors };
};
