import { genTempDir } from 'test-fns';

import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { genStubBinPath, runRoleSkill } from '../../../.test/runRoleSkill';

/**
 * .what = the operator-specific half of the skill harness
 * .why  = the runner, the stub bin and `PATH_WITHOUT_RHX` are shared across every role
 *         (`src/domain.roles/.test/runRoleSkill`). what belongs here is only the hop from
 *         a suite under `skills/` to a helper under `skills/.test/`, so each operator suite
 *         names its skill as `invoke.command.sh` rather than as a path.
 */

const SKILL_DIR = join(__dirname, '..');

export const runOperatorSkill = (
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
 * .what = a temp repo that holds the child directory an invoke skill reads
 * .why  = `invoke.command` and `invoke.vital` are twins that differ only in the directory
 *         they read (`src/contract/commands` vs `src/contract/vitals`), so their setup is
 *         one operation with one parameter — lifted here on its SECOND consumer
 *         (rule.prefer.most-common-denominator).
 *
 * .note = `git: true` carries weight. both skills look their directory up from
 *         `git rev-parse --show-toplevel`; absent a real repo that lookup collapses to `.`
 *         and the case exercises a different path than the one it names.
 */
export const setupInvokeRepo = (input: {
  slug: string;
  /** the path under the repo root the skill reads, e.g. `src/contract/commands` */
  at: string;
  children: { name: string; body: string }[];
  /** false omits the directory entirely, to reach the absent-directory belay */
  withDir?: boolean;
}): string => {
  const dir = genTempDir({
    slug: input.slug,
    git: true,
    symlink: [{ at: 'node_modules', to: 'node_modules' }],
  });

  if (input.withDir ?? true) {
    const at = join(dir, input.at);
    mkdirSync(at, { recursive: true });
    for (const child of input.children)
      writeFileSync(join(at, `${child.name}.ts`), child.body);
  }

  return dir;
};

/**
 * .what = the env that lets a case reach the child, past the credential read
 * .why  = the stub bin answers `rhx keyrack get` and `aws configure export-credentials`,
 *         which is what makes the tail reachable at all. `STUB_REAL_NPX` hands the stub npx
 *         the genuine one by absolute path, so the `npx tsx <child>` call runs for real
 *         while the stub still shadows every other npx shape — looked up HERE, on the host
 *         PATH, before it is narrowed for the child.
 */
export const genInvokeReachEnv = (input: {
  cwd: string;
}): Record<string, string> => {
  const npxAt = execSync('which npx', { encoding: 'utf-8' }).trim();

  // `node` must stay reachable, for the same reason `git` does in PATH_WITHOUT_RHX: npx is
  // a node program, so a PATH held to the system directories makes the genuine npx die
  // `/usr/bin/env: 'node': No such file or directory` and exit 127 — a fork a case would
  // then clamp as though it were the skill's own render.
  //
  // the stub bin still comes FIRST, so a same-named tool in the node directory (`npx`,
  // `rhx`) is shadowed exactly as before; this only appends a fallback.
  const nodeDir = dirname(execSync('which node', { encoding: 'utf-8' }).trim());

  return {
    PATH: `${genStubBinPath({ cwd: input.cwd })}:${nodeDir}`,
    STUB_REAL_NPX: npxAt,
  };
};

/**
 * .what = a child program that reports what it was handed
 * .why  = the bucket around it must be shown NOT hollow, and two lines are what proves it:
 *         one line alone could not distinguish a framed render from a frame with a single
 *         stray in it.
 */
export const CHILD_ECHO = [
  "console.log('the child ran');",
  "console.log(`the child saw: ${process.argv.slice(2).join(' ')}`);",
  '',
].join('\n');

/**
 * .what = a child program that speaks on BOTH streams, then exits 3
 * .why  = `run_sub_bucket` reads its child as `2>&1`, so a stderr line must arrive on the
 *         composer's stdout once framed. a child that spoke on one stream only could not
 *         show that.
 */
export const CHILD_FAILS = [
  "console.log('the child started');",
  "console.error('the child could not finish');",
  'process.exit(3);',
  '',
].join('\n');
