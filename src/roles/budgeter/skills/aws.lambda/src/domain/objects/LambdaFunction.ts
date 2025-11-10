/**
 * .what = AWS Lambda function configuration
 * .why = represents a Lambda function's basic configuration properties
 */
import { DomainLiteral } from 'domain-objects';

export interface LambdaFunction {
  functionName: string;
  runtime: string;
  memorySize: number;
  timeout: number;
  architectures: string[];
}
export class LambdaFunction extends DomainLiteral<LambdaFunction> implements LambdaFunction {}
