/**
 * .what = CloudWatch log group information
 * .why = represents a log group with its retention policy
 */
import { DomainLiteral } from 'domain-objects';

export interface CloudWatchLogGroup {
  logGroupName: string;
  retentionInDays?: number;
  storedBytes?: number;
  creationTime?: number;
}
export class CloudWatchLogGroup
  extends DomainLiteral<CloudWatchLogGroup>
  implements CloudWatchLogGroup {}
