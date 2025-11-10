/**
 * .what = retention policy change for a log group
 * .why = represents the diff between current and desired retention
 */
import { DomainLiteral } from 'domain-objects';

export interface RetentionPolicyChange {
  logGroupName: string;
  retentionRealized?: number;
  retentionDesired: number;
  requiresChange: boolean;
}
export class RetentionPolicyChange
  extends DomainLiteral<RetentionPolicyChange>
  implements RetentionPolicyChange {}
