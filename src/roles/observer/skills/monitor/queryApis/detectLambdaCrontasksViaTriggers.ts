/**
 * command to detect AWS Lambda functions with cron task triggers
 * fulfills acceptance criteria: enumerate lambdas, check triggers, filter for crontasks
 */
import { asCommand } from '@ehmpathy/as-command';
import { ContextLogTrail, LogLevel, withLogTrail } from 'as-procedure';
import Bottleneck from 'bottleneck';
import { execSync } from 'child_process';
import { basename, join } from 'path';
import { generateLogMethods } from 'simple-leveled-log-methods';
import { withSimpleCachingOnDisk } from 'with-simple-caching';

const log = generateLogMethods();

interface Crontask {
  rule: string;
  schedule: string;
}

interface LambdaWithCrontask {
  functionName: string;
  crontasks: Crontask[];
}

// npx tsx src/skills/diagnose/queryApis/detectLambdaCrontasks.ts
export const command = asCommand(
  {
    name: basename(__filename, '.ts'),
    purpose: 'detect AWS Lambda functions with crontask triggers',
    stage: process.env.STAGE || 'local',
    dir: join(__dirname, '.rhachet'),
    log,
  },
  async (_, context) => {
    context.log.info(
      '🌊 detecting Lambda functions with crontask triggers...',
      {},
    );

    // step 1: enumerate all Lambda functions
    context.log.info('🌱 step 1: enumerating all Lambda functions...', {});
    const lambdaFunctions = getLambdaFunctions({}, context);

    await context.out.write({
      name: 'lambda_functions.json',
      data: JSON.stringify(lambdaFunctions, null, 2),
    });

    if (lambdaFunctions.length === 0) {
      context.log.warn(
        '🍂 no Lambda functions found in this AWS account/region.',
        {},
      );
      return {
        lambdasWithCrontask: [],
        totalFunctions: 0,
        functionsWithCrontask: 0,
      };
    }

    context.log.info(
      `🌿 found ${lambdaFunctions.length} Lambda function(s)`,
      {},
    );

    // step 2: frontload all data fetching in parallel
    context.log.info(
      '🌾 step 2: fetching all EventBridge rules and details...',
      {},
    );

    // get all enabled EventBridge rules
    const rules = getEnabledEventBridgeRules({}, context);

    // instantiate bottleneck to limit concurrency
    const bottleneck = new Bottleneck({ maxConcurrent: 100 });

    // fetch all rule details in parallel upfront
    const ruleDetailsMap = new Map<
      string,
      { scheduleExpression?: string; targets: Array<{ Arn?: string }> }
    >(
      await Promise.all(
        rules.map(
          bottleneck.wrap(async (rule: { Name: string }) => {
            const details = await getRuleScheduleAndTargets(
              { ruleName: rule.Name },
              context,
            );
            return [rule.Name, details] as const;
          }),
        ),
      ),
    );

    // filter to only rules that have schedule expressions (crontasks)
    const crontaskRules = rules.filter((rule) => {
      const details = ruleDetailsMap.get(rule.Name);
      return details?.scheduleExpression !== undefined;
    });

    context.log.info(
      `🌿 found ${crontaskRules.length} crontask rule(s) to check against`,
      {},
    );

    // step 3: analyze lambda functions against fetched data
    context.log.info(
      '🌾 step 3: analyzing triggers for each Lambda function...',
      {},
    );

    // iterate through each Lambda function in parallel
    const lambdasWithCrontask: LambdaWithCrontask[] = (
      await Promise.all(
        lambdaFunctions.map(
          bottleneck.wrap(async (functionName: string) => {
            // find rules that target this lambda
            const rulesThatTargetLambda = crontaskRules.filter((rule) => {
              const details = ruleDetailsMap.get(rule.Name)!;
              return details.targets.some((target) => {
                const targetArn = target.Arn || '';
                return new RegExp(`:function:${functionName}$`).test(targetArn);
              });
            });

            // bailfast: if no rules target this lambda, skip it
            if (rulesThatTargetLambda.length === 0) return null;

            // map to crontasks
            const crontasks: Crontask[] = rulesThatTargetLambda.map((rule) => {
              const details = ruleDetailsMap.get(rule.Name)!;
              return {
                rule: rule.Name,
                schedule: details.scheduleExpression!,
              };
            });

            // write summary
            const lambdaInfo: LambdaWithCrontask = {
              functionName,
              crontasks,
            };
            await context.out.write({
              name: `functions/${lambdaInfo.functionName}/crontask_summary.json`,
              data: JSON.stringify(lambdaInfo, null, 2),
            });

            return lambdaInfo;
          }),
        ),
      )
    ).filter(
      (lambdaInfo): lambdaInfo is LambdaWithCrontask => lambdaInfo !== null,
    );

    // step 3: output results - Lambda functions with crontasks
    context.log.info('🌸 step 3: Lambda functions with crontask triggers:', {});

    // write final results to log
    await context.out.write({
      name: 'final_results.json',
      data: JSON.stringify(lambdasWithCrontask, null, 2),
    });

    if (lambdasWithCrontask.length === 0) {
      context.log.info(
        '🌙 no Lambda functions with crontask triggers found.',
        {},
      );
    } else {
      context.log.info(JSON.stringify(lambdasWithCrontask, null, 2), {});
      context.log.info(
        `🌻 summary: found ${lambdasWithCrontask.length} Lambda function(s) with crontask triggers`,
        {},
      );
    }

    return {
      lambdasWithCrontask,
      totalFunctions: lambdaFunctions.length,
      functionsWithCrontask: lambdasWithCrontask.length,
    };
  },
);

// execute the command when run directly
// npx tsx src/skills/diagnose/queryApis/detectLambdaCrontasks.ts
if (require.main === module) void command({});

// helper function to execute AWS CLI commands
const execAws = withLogTrail(
  (input: string): string => {
    return execSync(input, { encoding: 'utf-8' }).trim();
  },
  { name: 'execAws', log: { level: LogLevel.INFO } },
);

// helper function to parse JSON
const parseJson = <T>(input: string): T => {
  return JSON.parse(input);
};

/**
 * .what = enumerate all Lambda functions in the current AWS account and region
 * .why = provides the list of functions to check for crontasks
 */
const getLambdaFunctions = (
  _: Record<string, never>,
  context: ContextLogTrail,
): string[] => {
  const lambdaFunctionsRaw = execAws(
    "aws lambda list-functions --query 'Functions[].FunctionName' --output json",
    context,
  );
  return parseJson<string[]>(lambdaFunctionsRaw).sort();
};

/**
 * .what = get all enabled EventBridge rules
 * .why = filters to only enabled rules to avoid checking inactive schedules
 */
const getEnabledEventBridgeRules = (
  _input: Record<string, never>,
  context: ContextLogTrail,
): Array<{ Name: string }> => {
  const rulesRaw = execAws(
    'aws events list-rules --query "Rules[?State==\'ENABLED\']" --output json',
    context,
  );
  return parseJson<Array<{ Name: string }>>(rulesRaw);
};

/**
 * .what = get rule schedule expression and target ARNs for a specific EventBridge rule
 * .why = determines if the rule is a cron trigger and which Lambda functions it targets
 */
const getRuleScheduleAndTargets = withSimpleCachingOnDisk(
  async (
    input: { ruleName: string },
    context: ContextLogTrail,
  ): Promise<{
    scheduleExpression?: string;
    targets: Array<{ Arn?: string }>;
  }> => {
    // fetch rule details to extract schedule expression
    const ruleDetailRaw = execAws(
      `aws events describe-rule --name "${input.ruleName}" --output json`,
      context,
    );
    const ruleDetail = parseJson<{ ScheduleExpression?: string }>(
      ruleDetailRaw,
    );

    // fetch targets to identify which Lambda functions this rule triggers
    const targetsRaw = execAws(
      `aws events list-targets-by-rule --rule "${input.ruleName}" --output json`,
      context,
    );
    const targets = parseJson<{ Targets: Array<{ Arn?: string }> }>(targetsRaw);

    return {
      scheduleExpression: ruleDetail.ScheduleExpression,
      targets: targets.Targets,
    };
  },
  {
    directory: {
      mounted: {
        path: join(
          __dirname,
          '.cache',
          new Date().toISOString().split('T')[0]!, // reuse per day only
        ),
      },
    },
    procedure: { name: 'getRuleScheduleAndTargets', version: 'v2025_11_03' },
  },
);
