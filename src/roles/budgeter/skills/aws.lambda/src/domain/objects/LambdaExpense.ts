/**
 * .what = complete expense analysis for a Lambda function
 * .why = combines function config, metrics, and costs into a single view
 */
import { DomainLiteral } from 'domain-objects';

export interface LambdaExpense {
  functionName: string;
  runtime: string;
  architecture: string;
  memoryMb: number;
  memoryUtilPct?: number;
  memoryMaxUsedMb?: number;
  timeoutSeconds: number;
  invocations: number;
  durationAvgMs: number;
  durationSumMs: number;
  errors: number;
  gbSeconds: number;
  requestCost: number;
  computeCost: number;
  monthlyCost: number;
}
export class LambdaExpense extends DomainLiteral<LambdaExpense> implements LambdaExpense {}
