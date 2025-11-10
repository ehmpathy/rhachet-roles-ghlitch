/**
 * .what = estimate CloudWatch log ingestion metrics from storage growth
 * .why = calculate ingestion costs when direct metrics are not available
 */
import { ContextLogTrail } from 'as-procedure';
import { CloudWatchLogGroup } from '../objects/CloudWatchLogGroup';
import { LogGroupIngestionMetrics } from '../objects/LogGroupIngestionMetrics';

export const queryIngestionMetrics = (
  input: {
    logGroupsNow: CloudWatchLogGroup[];
    daysLookback: number;
  },
  context: ContextLogTrail,
): LogGroupIngestionMetrics[] => {
  context.log.info(
    `estimating ingestion from storage growth over ${input.daysLookback} days...`,
    {},
  );

  // estimate ingestion based on current storage and retention policy
  // assumption: if retention is set, storage represents ~retention days of logs
  // if no retention, estimate based on average daily growth
  const metrics: LogGroupIngestionMetrics[] = [];

  for (const logGroup of input.logGroupsNow) {
    if (!logGroup.storedBytes || logGroup.storedBytes === 0) {
      // no storage, assume no ingestion
      continue;
    }

    let estimatedDailyBytes = 0;

    if (logGroup.retentionInDays) {
      // if retention policy exists, storage represents ~retention days of logs
      // daily ingestion ≈ total storage / retention days
      estimatedDailyBytes = logGroup.storedBytes / logGroup.retentionInDays;
    } else {
      // no retention policy means logs never expire
      // estimate based on creation time if available, otherwise assume 30 days
      const ageInDays = logGroup.creationTime
        ? Math.max(
            1,
            (Date.now() - logGroup.creationTime) / (1000 * 60 * 60 * 24),
          )
        : 30;

      // daily ingestion ≈ total storage / age in days
      estimatedDailyBytes = logGroup.storedBytes / ageInDays;
    }

    // calculate total ingestion over the lookback period
    const totalBytesInPeriod = estimatedDailyBytes * input.daysLookback;

    // estimate log events (rough approximation: 1 event ≈ 512 bytes on average)
    const estimatedLogEvents = Math.floor(totalBytesInPeriod / 512);

    metrics.push(
      new LogGroupIngestionMetrics({
        logGroupName: logGroup.logGroupName,
        incomingBytesSum: totalBytesInPeriod,
        incomingLogEventsSum: estimatedLogEvents,
      }),
    );
  }

  context.log.info(
    `estimated ingestion for ${metrics.length} log groups based on storage and retention`,
    {},
  );

  return metrics;
};
