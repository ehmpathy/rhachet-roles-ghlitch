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
    `applying retention policy of ${input.retentionInDays} days to ${input.logGroupName}...`,
    {},
  );

  execAws(
    `aws logs put-retention-policy --log-group-name "${input.logGroupName}" --retention-in-days ${input.retentionInDays}`,
    context,
  );

  context.log.info(
    `retention policy applied to ${input.logGroupName}`,
    {},
  );
};
