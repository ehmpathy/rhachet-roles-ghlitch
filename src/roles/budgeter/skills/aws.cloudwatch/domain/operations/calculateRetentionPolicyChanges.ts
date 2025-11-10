/**
 * .what = calculate retention policy changes needed for log groups
 * .why = identifies which log groups need retention policy updates
 */
import { ContextLogTrail } from 'as-procedure';
import { CloudWatchLogGroup } from '../objects/CloudWatchLogGroup';
import { RetentionPolicyChange } from '../objects/RetentionPolicyChange';

export const calculateRetentionPolicyChanges = (
  input: {
    logGroups: CloudWatchLogGroup[];
    desiredRetentionDays: number;
  },
  context: ContextLogTrail,
): RetentionPolicyChange[] => {
  context.log.info('calculating retention policy changes...', {});

  const changes = input.logGroups.map((lg) => {
    const retentionRealized = lg.retentionInDays;
    const retentionDesired = input.desiredRetentionDays;
    const requiresChange = retentionRealized !== retentionDesired;

    return new RetentionPolicyChange({
      logGroupName: lg.logGroupName,
      retentionRealized,
      retentionDesired,
      requiresChange,
    });
  });

  const changesNeeded = changes.filter((c) => c.requiresChange);
  context.log.info(
    `${changesNeeded.length} log groups require retention policy changes`,
    {},
  );

  return changes;
};
