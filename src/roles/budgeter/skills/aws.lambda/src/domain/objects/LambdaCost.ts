/**
 * .what = cost breakdown for a Lambda function
 * .why = represents the calculated costs based on usage and pricing
 */
import { DomainLiteral } from 'domain-objects';

export interface LambdaCost {
  functionName: string;
  gbSeconds: number;
  requestCost: number;
  computeCost: number;
  monthlyCost: number;
}
export class LambdaCost extends DomainLiteral<LambdaCost> implements LambdaCost {}
