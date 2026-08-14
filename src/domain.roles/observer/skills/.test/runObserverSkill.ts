import { join } from 'node:path';

import { runRoleSkill } from '../../../.test/runRoleSkill';

/**
 * .what = the observer-specific half of the skill harness
 * .why  = the runner, the stub bin and `PATH_WITHOUT_RHX` are shared across every role
 *         (`src/domain.roles/.test/runRoleSkill`). what belongs here is only the hop from
 *         a suite under `skills/` to a helper under `skills/.test/`, so each observer
 *         suite names its skill as `aws.ssm.param.check.sh` rather than as a path.
 */

const SKILL_DIR = join(__dirname, '..');

export const runObserverSkill = (
  input: {
    skill: string;
    args: string;
    cwd: string;
  },
  options?: {
    asHuman?: boolean;
    env?: Record<string, string>;
  },
): { stdout: string; stderr: string; exitCode: number } =>
  runRoleSkill(
    {
      skillPath: join(SKILL_DIR, input.skill),
      args: input.args,
      cwd: input.cwd,
    },
    options,
  );
