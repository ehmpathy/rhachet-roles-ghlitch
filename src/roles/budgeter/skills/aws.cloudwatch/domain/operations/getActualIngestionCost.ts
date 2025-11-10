/**
 * .what = get actual CloudWatch Logs ingestion cost from Cost Explorer
 * .why = calibrate estimates with real costs
 */
import { ContextLogTrail } from 'as-procedure';
import { execAws } from './execAws';

export const getActualIngestionCost = (
  input: {
    accountId: string;
    periodSince: string;
    periodUptil: string;
  },
  context: ContextLogTrail,
): { totalCost: number; currency: string } => {
  context.log.info('querying actual ingestion cost from Cost Explorer...', {});

  // execute AWS CLI to fetch cost data
  const costRaw = execAws(
    `aws ce get-cost-and-usage --time-period Start=${input.periodSince},End=${input.periodUptil} --granularity MONTHLY --metrics UnblendedCost --group-by Type=DIMENSION,Key=SERVICE Type=DIMENSION,Key=USAGE_TYPE --filter '{"Dimensions":{"Key":"LINKED_ACCOUNT","Values":["${input.accountId}"]}}' --output json`,
    context,
  );

  // parse JSON response
  const costData = JSON.parse(costRaw) as {
    ResultsByTime: Array<{
      Groups: Array<{
        Keys: string[];
        Metrics: {
          UnblendedCost: {
            Amount: string;
            Unit: string;
          };
        };
      }>;
    }>;
  };

  // sum up all VendedLog-Bytes costs (ingestion across all regions)
  const { totalCost, currency } = costData.ResultsByTime.flatMap(
    (tr) => tr.Groups,
  )
    .filter((group) => {
      const serviceName = group.Keys[0];
      const usageType = group.Keys[1];
      return (
        serviceName?.includes('CloudWatch') &&
        usageType?.includes('VendedLog-Bytes')
      );
    })
    .reduce(
      (acc, group) => ({
        totalCost:
          acc.totalCost + parseFloat(group.Metrics.UnblendedCost.Amount),
        currency: group.Metrics.UnblendedCost.Unit,
      }),
      { totalCost: 0, currency: 'USD' },
    );

  context.log.info(
    `actual ingestion cost: ${currency} ${totalCost.toFixed(2)}`,
    {},
  );

  return { totalCost, currency };
};
