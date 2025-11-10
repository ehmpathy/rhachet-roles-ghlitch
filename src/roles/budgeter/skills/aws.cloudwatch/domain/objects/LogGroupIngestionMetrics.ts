/**
 * .what = CloudWatch log group ingestion metrics
 * .why = represents ingestion data volume for cost calculation
 */
import { DomainLiteral } from 'domain-objects';

export interface LogGroupIngestionMetrics {
  logGroupName: string;
  incomingBytesSum: number;
  incomingLogEventsSum: number;
}
export class LogGroupIngestionMetrics
  extends DomainLiteral<LogGroupIngestionMetrics>
  implements LogGroupIngestionMetrics {}
