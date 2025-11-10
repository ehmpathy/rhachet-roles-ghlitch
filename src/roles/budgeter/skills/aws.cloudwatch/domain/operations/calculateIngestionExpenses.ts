/**
 * .what = calculate ingestion expenses for log groups
 * .why = determine costs based on ingested data volume
 */
import { ContextLogTrail } from 'as-procedure';
import { LogGroupIngestionMetrics } from '../objects/LogGroupIngestionMetrics';
import { LogGroupIngestionExpense } from '../objects/LogGroupIngestionExpense';

export const calculateIngestionExpenses = (
  input: {
    metrics: LogGroupIngestionMetrics[];
    daysLookback: number;
    actualTotalCost: number;
  },
  context: ContextLogTrail,
): LogGroupIngestionExpense[] => {
  context.log.info('calculating ingestion expenses...', {});

  // calculate ingestion volumes for each log group
  const logGroupVolumes = input.metrics.map((metric) => {
    const incomingGb = metric.incomingBytesSum / (1024 * 1024 * 1024);

    return {
      logGroupName: metric.logGroupName,
      incomingBytes: metric.incomingBytesSum,
      incomingGb,
      incomingLogEvents: metric.incomingLogEventsSum,
    };
  });

  // calculate total ingestion volume
  const totalIncomingGb = logGroupVolumes.reduce(
    (sum, vol) => sum + vol.incomingGb,
    0,
  );

  // log distribution details
  context.log.info(
    `distributing actual cost $${input.actualTotalCost.toFixed(2)} based on ingestion volume (${totalIncomingGb.toFixed(2)} GB total)`,
    {},
  );

  // distribute total cost based on each log group's percentage of total ingestion
  const expenses = logGroupVolumes.map((vol) => {
    const percentOfTotal =
      totalIncomingGb > 0 ? vol.incomingGb / totalIncomingGb : 0;
    const monthlyCost = percentOfTotal * input.actualTotalCost;

    return new LogGroupIngestionExpense({
      logGroupName: vol.logGroupName,
      incomingBytes: vol.incomingBytes,
      incomingGb: vol.incomingGb,
      incomingLogEvents: vol.incomingLogEvents,
      monthlyCost,
    });
  });

  const totalCost = expenses.reduce((sum, exp) => sum + exp.monthlyCost, 0);
  context.log.info(
    `total actual ingestion cost for ${input.daysLookback} days: $${totalCost.toFixed(2)}`,
    {},
  );

  return expenses;
};
