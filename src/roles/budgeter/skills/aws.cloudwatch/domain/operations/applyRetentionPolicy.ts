/**
 * .what = apply retention policy to a CloudWatch log group
 * .why = sets the retention period for log data
 */
import { ContextLogTrail } from 'as-procedure';
import { execAws } from './execAws';

export const applyRetentionPolicy = (
  input: {
    logGroupName: string;
    retentionInDays: number;
  },
  context: ContextLogTrail,
): void => {
  context.log.info(
    `AWS API: put-retention-policy for ${input.logGroupName} (${input.retentionInDays} days)`,
    {},
  );

  execAws(
    `aws logs put-retention-policy --log-group-name "${input.logGroupName}" --retention-in-days ${input.retentionInDays}`,
    context,
  );

  context.log.info(
    `AWS API: put-retention-policy completed for ${input.logGroupName}`,
    {},
  );
};
