/**
 * .what = CloudWatch metrics for a Lambda function
 * .why = represents invocation, duration, and error metrics
 */
import { DomainLiteral } from 'domain-objects';

export interface LambdaMetrics {
  functionName: string;
  invocations: number;
  durationAvgMs: number;
  durationSumMs: number;
  errors: number;
  memoryMaxUsedMb?: number;
  memoryUtilPct?: number;
}
export class LambdaMetrics extends DomainLiteral<LambdaMetrics> implements LambdaMetrics {}
