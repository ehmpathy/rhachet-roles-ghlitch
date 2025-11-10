/**
 * .what = CloudWatch log group ingestion expense
 * .why = represents ingestion costs per log group
 */
import { DomainLiteral } from 'domain-objects';

export interface LogGroupIngestionExpense {
  logGroupName: string;
  incomingBytes: number;
  incomingGb: number;
  incomingLogEvents: number;
  monthlyCost: number;
}
export class LogGroupIngestionExpense
  extends DomainLiteral<LogGroupIngestionExpense>
  implements LogGroupIngestionExpense {}
