/**
 * .what = list all Lambda functions in the current AWS account/region
 * .why = provides the full set of functions to analyze
 */
import { ContextLogTrail } from 'as-procedure';
import { LambdaFunction } from '../objects/LambdaFunction';
import { execAws } from './execAws';

export const listLambdaFunctions = (
  _: Record<string, never>,
  context: ContextLogTrail,
): LambdaFunction[] => {
  context.log.info('listing Lambda functions...', {});

  const functionsRaw = execAws(
    'aws lambda list-functions --output json',
    context,
  );

  const functionsData = JSON.parse(functionsRaw) as {
    Functions: Array<{
      FunctionName: string;
      Runtime: string;
      MemorySize: number;
      Timeout: number;
      Architectures: string[];
    }>;
  };

  const functions = functionsData.Functions.map(
    (fn) =>
      new LambdaFunction({
        functionName: fn.FunctionName,
        runtime: fn.Runtime,
        memorySize: fn.MemorySize,
        timeout: fn.Timeout,
        architectures: fn.Architectures,
      }),
  );

  context.log.info(`found ${functions.length} Lambda functions`, {});

  return functions;
};
