/**
 * .what = get AWS account ID and alias
 * .why = identifies which AWS account is being analyzed
 */
import { ContextLogTrail } from 'as-procedure';
import { AwsAccount } from '../objects/AwsAccount';
import { execAws } from './execAws';

export const getAwsAccountInfo = (
  _: Record<string, never>,
  context: ContextLogTrail,
): AwsAccount => {
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
