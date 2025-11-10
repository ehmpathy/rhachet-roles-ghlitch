/**
 * .what = query CloudWatch Logs for actual max memory used by a Lambda function
 * .why = determines memory utilization to identify over-provisioning
 */
import { ContextLogTrail } from 'as-procedure';
import { BadRequestError } from 'helpful-errors';
import { join } from 'path';
import { withSimpleCachingOnDisk } from 'with-simple-caching';
import { withRetry } from 'wrapper-fns';

import { execAws } from './execAws';

// helper to sleep for specified ms
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const queryLambdaMemoryUsageLogic = async (
  input: {
    functionName: string;
    daysLookback: number;
  },
  context: ContextLogTrail,
): Promise<number | undefined> => {
  // validate inputs
  if (!input.functionName?.trim()) {
    throw new BadRequestError('functionName is required', {
      functionName: input.functionName,
    });
  }
  if (input.daysLookback <= 0 || input.daysLookback > 90) {
    throw new BadRequestError('daysLookback must be between 1 and 90', {
      daysLookback: input.daysLookback,
    });
  }

  const logGroupName = `/aws/lambda/${input.functionName}`;

  // check if log group exists - bail fast if not
  const logGroupsRaw = execAws(
    `aws logs describe-log-groups --log-group-name-prefix ${logGroupName} --output json`,
    context,
  );
  const logGroups = JSON.parse(logGroupsRaw) as {
    logGroups: Array<{ logGroupName: string }>;
  };

  const logGroupExists = logGroups.logGroups.some(
    (lg) => lg.logGroupName === logGroupName,
  );

  // bail fast if log group doesn't exist
  if (!logGroupExists) return undefined;

  // start query
  const startTime = Math.floor(
    (Date.now() - input.daysLookback * 24 * 60 * 60 * 1000) / 1000,
  );
  const endTime = Math.floor(Date.now() / 1000);

  const queryString =
    'fields @timestamp, @message | filter @message like /REPORT RequestId/ | parse @message "Max Memory Used: * MB" as max_memory | stats max(max_memory) as max_memory_used';

  const queryId = execAws(
    `aws logs start-query ` +
      `--log-group-name ${logGroupName} ` +
      `--start-time ${startTime} ` +
      `--end-time ${endTime} ` +
      `--query-string '${queryString}' ` +
      `--output text`,
    context,
  );

  // wait for query to complete (with timeout)
  const maxWait = 30;
  let waitCount = 0;
  let queryStatus = 'Running';

  while (
    (queryStatus === 'Running' || queryStatus === 'Scheduled') &&
    waitCount < maxWait
  ) {
    await sleep(1000);
    waitCount++;

    const statusRaw = execAws(
      `aws logs get-query-results --query-id ${queryId} --output json`,
      context,
    );
    const statusData = JSON.parse(statusRaw) as { status: string };
    queryStatus = statusData.status;
  }

  // bail fast if query didn't complete
  if (queryStatus !== 'Complete') return undefined;

  // extract results
  const resultsRaw = execAws(
    `aws logs get-query-results --query-id ${queryId} --output json`,
    context,
  );
  const results = JSON.parse(resultsRaw) as {
    results: Array<Array<{ field: string; value: string }>>;
  };

  // bail fast if no results
  if (results.results.length === 0) return undefined;

  const maxMemoryField = results.results[0]!.find(
    (field) => field.field === 'max_memory_used',
  );

  // bail fast if no max memory field or null value
  if (
    !maxMemoryField ||
    !maxMemoryField.value ||
    maxMemoryField.value === 'null'
  ) {
    return undefined;
  }

  return parseFloat(maxMemoryField.value);
};

const queryLambdaMemoryUsageWithCache = withSimpleCachingOnDisk(
  queryLambdaMemoryUsageLogic,
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
    procedure: { name: 'queryLambdaMemoryUsage', version: 'v2025_11_09' },
  },
);

/**
 * .what = wrapped with retry to handle cache corruption errors
 * .why = cache file writes can be interrupted causing JSON parse errors
 */
export const queryLambdaMemoryUsage = withRetry(
  queryLambdaMemoryUsageWithCache,
  {
    retries: 3,
    onRetry: (error, attempt) => {
      console.error(
        `queryLambdaMemoryUsage retry attempt ${attempt}/3 due to: ${error.message}`,
      );
    },
  },
);
