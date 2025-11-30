/**
 * .what = list all Lambda functions in the current AWS account/region
 * .why = provides the full set of functions to analyze
 */
import { ContextLogTrail } from 'as-procedure';
import { join } from 'path';
import { withSimpleCachingOnDisk } from 'with-simple-caching';
import { withRetry } from 'wrapper-fns';

import { LambdaFunction } from '../objects/LambdaFunction';
import { execAws } from './execAws';

const listLambdaFunctionsLogic = async (
  input: { asOfDate: string },
  context: ContextLogTrail,
): Promise<LambdaFunction[]> => {
  context.log.info('listing Lambda functions...', {});

  const allFunctions: LambdaFunction[] = [];
  let nextMarker: string | undefined;

  // paginate through all functions
  do {
    const command = nextMarker
      ? `aws lambda list-functions --output json --starting-token "${nextMarker}"`
      : 'aws lambda list-functions --output json';

    const functionsRaw = execAws(command, context);

    const functionsData = JSON.parse(functionsRaw) as {
      Functions: Array<{
        FunctionName: string;
        Runtime: string;
        MemorySize: number;
        Timeout: number;
        Architectures: string[];
      }>;
      NextMarker?: string;
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

    allFunctions.push(...functions);
    nextMarker = functionsData.NextMarker;

    if (nextMarker) {
      context.log.info(
        `fetched ${functions.length} functions, continuing pagination...`,
        {},
      );
    }
  } while (nextMarker);

  context.log.info(`found ${allFunctions.length} Lambda functions`, {});

  return allFunctions;
};

/**
 * .what = cached version of listLambdaFunctions
 * .why = function list changes infrequently, caching per asOfDate improves performance
 */
export const listLambdaFunctions = withRetry(
  withSimpleCachingOnDisk(listLambdaFunctionsLogic, {
    directory: {
      mounted: {
        path: join(
          __dirname,
          '.cache',
          new Date().toISOString().split('T')[0]!, // reuse per day
        ),
      },
    },
    procedure: { name: 'listLambdaFunctions', version: 'v2025_11_10' },
  }),
);
