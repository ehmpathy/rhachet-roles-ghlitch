/**
 * .what = AWS account information
 * .why = represents the AWS account being analyzed
 */
import { DomainLiteral } from 'domain-objects';

export interface AwsAccount {
  id: string;
  alias?: string;
  display: string;
}
export class AwsAccount extends DomainLiteral<AwsAccount> implements AwsAccount {}
