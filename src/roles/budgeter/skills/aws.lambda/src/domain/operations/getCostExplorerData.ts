/**
 * .what = get Lambda costs from AWS Cost Explorer
 * .why = provides the actual service-level cost for comparison
 */
import { ContextLogTrail } from 'as-procedure';
import { execAws } from './execAws';

export interface CostExplorerData {
  totalCost: number;
  currency: string;
}

export const getCostExplorerData = (
  input: {
    accountId: string;
    periodSince: string;
    periodUptil: string;
  },
  context: ContextLogTrail,
): CostExplorerData => {
  context.log.info('querying AWS Cost Explorer...', {});

  const costDataRaw = execAws(
    `aws ce get-cost-and-usage ` +
      `--time-period Start=${input.periodSince},End=${input.periodUptil} ` +
      `--granularity MONTHLY ` +
      `--metrics 'UnblendedCost' 'UsageQuantity' ` +
      `--group-by Type=DIMENSION,Key=USAGE_TYPE ` +
      `--filter '{"And":[{"Dimensions":{"Key":"SERVICE","Values":["AWS Lambda"]}},{"Dimensions":{"Key":"LINKED_ACCOUNT","Values":["${input.accountId}"]}}]}' ` +
      `--output json`,
    context,
  );

  const costData = JSON.parse(costDataRaw) as {
    ResultsByTime: Array<{
      Groups?: Array<{
        Metrics: {
          UnblendedCost: {
            Amount: string;
            Unit: string;
          };
        };
      }>;
    }>;
  };

  let totalCost = 0;
  let currency = 'USD';

  if (
    costData.ResultsByTime.length > 0 &&
    costData.ResultsByTime[0]!.Groups
  ) {
    totalCost = costData.ResultsByTime[0]!.Groups.reduce((sum, group) => {
      return sum + parseFloat(group.Metrics.UnblendedCost.Amount);
    }, 0);
    currency =
      costData.ResultsByTime[0]!.Groups[0]?.Metrics.UnblendedCost.Unit ||
      'USD';
  }

  context.log.info(`total Lambda cost: $${totalCost.toFixed(2)} ${currency}`, {});

  return { totalCost, currency };
};
