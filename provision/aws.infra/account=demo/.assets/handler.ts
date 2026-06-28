/**
 * .what = test lambda handler for rhachet-roles-ghlitch integration tests
 * .why = enables real cloudwatch log group queries via aws.cloudwatch.logs.query skill
 *
 * .note = simple echo handler that logs to CloudWatch and returns input
 */
export const handler = async (payload: {
  message?: string;
  timestamp?: string;
}): Promise<{
  echo: {
    message: string | null;
    timestamp: string | null;
  };
  meta: {
    invokedAt: string;
    functionName: string;
  };
}> => {
  // log to CloudWatch so we have logs to query
  console.log('echo handler invoked', { payload });

  return {
    echo: {
      message: payload.message ?? null,
      timestamp: payload.timestamp ?? null,
    },
    meta: {
      invokedAt: new Date().toISOString(),
      functionName: process.env.AWS_LAMBDA_FUNCTION_NAME ?? 'unknown',
    },
  };
};
