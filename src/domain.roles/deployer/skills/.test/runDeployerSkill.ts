import { join } from 'node:path';

import { runRoleSkill } from '../../../.test/runRoleSkill';

/**
 * .what = the deployer-specific half of the skill harness
 * .why  = `PATH_WITHOUT_RHX`, `genStubBinPath` and the runner itself moved up to
 *         `src/domain.roles/.test/runRoleSkill`, because the operator and observer suites
 *         use them too (rule.prefer.most-common-denominator). what stays here is what is
 *         genuinely deployer-only: this role's fixture directory, the skill-dir hop, and
 *         the prod-gate slice.
 *
 *         a caller that wants `PATH_WITHOUT_RHX` or `genStubBinPath` imports them from the
 *         shared module directly — this file does NOT forward them
 *         (rule.forbid.barrel-exports).
 */

/**
 * .what = the deployer skills directory, derived from this file's own location
 * .why  = a suite under `skills/` and a helper under `skills/.test/` sit one level
 *         apart; the hop is resolved once here rather than at every caller.
 */
const SKILL_DIR = join(__dirname, '..');

/**
 * .what = the fixture directory symlinked into each temp repo
 * .why  = the skills read `.agent/keyrack.yml#org` for org-scope policy and
 *         `package.json#name` for the repo slug. both come from a checked-in fixture
 *         via genTempDir symlinks, never an adhoc mkdir/writeFile
 *         (rule.forbid.adhoc-gentempdir-reimpl).
 */
export const DEPLOYER_FIXTURE =
  'src/domain.roles/deployer/skills/.test/assets';

/**
 * .what = run a deployer skill by bare filename, from a temp repo
 * .why  = every deployer suite names its skill as `deploy.sh`, not as an absolute path;
 *         this resolves the hop so each caller does not.
 */
export const runDeployerSkill = (
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

/**
 * .what = cut a composer's stdout at the close of the prod-gate bucket
 * .why  = every composer's tail past the gate is volatile (a keyrack read, an aws
 *         account, a temp path). the bucket close `   │  └─` is the last deterministic
 *         line, and it is the exact span
 *         `rule.require.nest-subskill-output-in-buckets` governs — so the slice keeps
 *         the whole of what the rule clamps and drops only what it does not.
 */
export const sliceThroughGate = (out: string): string => {
  const close = '   │  └─';
  const at = out.indexOf(close);
  // throw, never fall back to the whole string. a slice that silently no-ops is a
  // failhide (rule.forbid.failhide): the snapshot would swallow the volatile tail — a
  // temp path, an aws account, a stack trace — and read as a pass. the kin slice in
  // uses.play did exactly that once, and leaked tsx internals into a snapshot for it.
  if (at === -1)
    throw new Error(
      `gate slice marker absent from output: ${JSON.stringify(close)}`,
    );
  return out.slice(0, at + close.length);
};
