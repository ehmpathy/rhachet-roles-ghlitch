/**
 * .what = list all CloudWatch log groups in the current AWS account/region
 * .why = provides the full set of log groups to analyze
 */
import {
  CloudWatchLogsClient,
  DescribeLogGroupsCommand,
  LogGroup,
} from '@aws-sdk/client-cloudwatch-logs';
import { ContextLogTrail } from 'as-procedure';
import { join } from 'path';
import { withSimpleCachingOnDisk } from 'with-simple-caching';

import { CloudWatchLogGroup } from '../objects/CloudWatchLogGroup';

const listLogGroupsLogic = async (
  _: Record<string, never>,
  context: ContextLogTrail,
): Promise<CloudWatchLogGroup[]> => {
  context.log.info('listing CloudWatch log groups...', {});

  // initialize AWS SDK client
  const client = new CloudWatchLogsClient({});

  // recursively fetch all pages of log groups
  const fetchAllPages = async (
    token?: string,
    accumulated: CloudWatchLogGroup[] = [],
    pageNum: number = 1,
  ): Promise<CloudWatchLogGroup[]> => {
    // log AWS API call
    context.log.info(
      `fetching log groups page ${pageNum} (${accumulated.length} fetched so far)...`,
      {},
    );

    // fetch next page from AWS
    const response = await client.send(
      new DescribeLogGroupsCommand({ nextToken: token }),
    );

    // map AWS response to domain objects
    const logGroups = (response.logGroups ?? []).map(
      (lg: LogGroup) =>
        new CloudWatchLogGroup({
          logGroupName: lg.logGroupName!,
          retentionInDays: lg.retentionInDays,
          storedBytes: lg.storedBytes,
          creationTime: lg.creationTime,
        }),
    );

    // combine with accumulated results
    const updated = [...accumulated, ...logGroups];

    context.log.info(
      `page ${pageNum} fetched: ${logGroups.length} log groups (${updated.length} total)`,
      {},
    );

    // continue pagination if more pages exist
    return response.nextToken
      ? fetchAllPages(response.nextToken, updated, pageNum + 1)
      : updated;
  };

  const allLogGroups = await fetchAllPages();

  context.log.info(`found ${allLogGroups.length} CloudWatch log groups`, {});

  return allLogGroups;
};

export const listLogGroups = withSimpleCachingOnDisk(listLogGroupsLogic, {
  directory: {
    mounted: {
      path: join(
        __dirname,
        '.cache',
        new Date().toISOString().split('T')[0]!, // reuse per day only
      ),
    },
  },
  procedure: { name: 'listLogGroups', version: 'v2025_11_10' },
});
