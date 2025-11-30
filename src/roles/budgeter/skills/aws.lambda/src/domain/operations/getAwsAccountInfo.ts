/**
 * .what = get AWS account ID and alias
 * .why = identifies which AWS account is being analyzed
 */
import { ContextLogTrail } from 'as-procedure';
import { join } from 'path';
import { withSimpleCachingOnDisk } from 'with-simple-caching';
import { withRetry } from 'wrapper-fns';

import { AwsAccount } from '../objects/AwsAccount';
import { execAws } from './execAws';

const getAwsAccountInfoLogic = async (
  input: { asOfDate: string },
  context: ContextLogTrail,
): Promise<AwsAccount> => {
  context.log.info('getting AWS account info...', {});

  const accountId = execAws(
    'aws sts get-caller-identity --query Account --output text',
    context,
  );

  let accountAlias: string | undefined;
  try {
    const aliasOutput = execAws(
      "aws iam list-account-aliases --query 'AccountAliases[0]' --output text",
      context,
    );
    if (aliasOutput && aliasOutput !== 'None') {
      accountAlias = aliasOutput;
    }
  } catch (error) {
    // alias is optional; ignore errors
  }

  const display = accountAlias
    ? `${accountAlias} (${accountId})`
    : accountId;

  context.log.info(`account: ${display}`, {});

  return new AwsAccount({
    id: accountId,
    alias: accountAlias,
    display,
  });
};

/**
 * .what = cached version of getAwsAccountInfo
 * .why = account info is static and doesn't change
 */
export const getAwsAccountInfo = withRetry(
  withSimpleCachingOnDisk(getAwsAccountInfoLogic, {
    directory: {
      mounted: {
        path: join(
          __dirname,
          '.cache',
          new Date().toISOString().split('T')[0]!, // reuse per day
        ),
      },
    },
    procedure: { name: 'getAwsAccountInfo', version: 'v2025_11_10' },
  }),
);
