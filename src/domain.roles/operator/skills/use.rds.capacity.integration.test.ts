import { genTempDir, given, then, useBeforeAll, useThen, when } from 'test-fns';

import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * .what = integration test for use.rds.capacity failfast on absent config
 * .why = prove the skill fails fast and guides the caller when repo config
 *        is placeholder "null" instead of opaque downstream failure
 */

/**
 * .what = type guard for Node.js execSync error shape
 * .why = execSync throws errors with stdout/stderr/status; TypeScript lacks types
 * .note = external boundary - Node.js child_process API
 */
const isExecSyncError = (
  error: unknown,
): error is { stdout?: string; stderr?: string; status: number } => {
  if (error === null || typeof error !== 'object') return false;
  if (!('status' in error)) return false;
  const obj = error as Record<string, unknown>;
  return typeof obj.status === 'number';
};

/**
 * .what = run the skill from a given cwd with creds set to skip keyrack
 * .why = exercises the real src skill against a stubbed repo getConfig
 */
const runSkill = (input: {
  args: string;
  cwd: string;
}): { stdout: string; stderr: string; exitCode: number } => {
  const skillPath = `${__dirname}/use.rds.capacity.sh`;

  // set static aws creds so the skill skips keyrack unlock + sso export
  const env = {
    ...process.env,
    AWS_ACCESS_KEY_ID: 'test-skip-keyrack',
    AWS_SECRET_ACCESS_KEY: 'test-skip-keyrack',
  };

  try {
    const stdout = execSync(`bash "${skillPath}" ${input.args}`, {
      encoding: 'utf-8',
      cwd: input.cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (error: unknown) {
    if (isExecSyncError(error)) {
      return {
        stdout: error.stdout ?? '',
        stderr: error.stderr ?? '',
        exitCode: error.status,
      };
    }
    throw error;
  }
};

/**
 * .what = write a stub getConfig that returns placeholder "null" tunnel config
 * .why = reproduces the reported scenario where repo config was never filled in
 */
const setStubConfig = (input: {
  cwd: string;
  bastionExid: string;
  clusterName: string;
  account: string;
}): void => {
  const configDir = join(input.cwd, 'src/utils/config');
  mkdirSync(configDir, { recursive: true });
  writeFileSync(
    join(configDir, 'getConfig.ts'),
    `export const getConfig = async () => ({
  database: {
    tunnel: {
      bastion: { exid: ${JSON.stringify(input.bastionExid)} },
      cluster: { name: ${JSON.stringify(input.clusterName)} },
      local: { host: 'localhost', port: 5432 },
    },
  },
  aws: { account: ${JSON.stringify(input.account)} },
});
`,
  );
};

describe('use.rds.capacity', () => {
  const scene = useBeforeAll(async () => {
    const dir = genTempDir({
      slug: 'use-rds-capacity-failfast',
      git: true,
      symlink: [{ at: 'node_modules', to: 'node_modules' }],
    });
    return { dir };
  });

  given('[case1] absent --env', () => {
    when('[t0] skill runs without --env', () => {
      const result = useThen('skill runs', () =>
        runSkill({ args: '', cwd: scene.dir }),
      );

      then('it exits 2 (constraint)', () => {
        expect(result.exitCode).toBe(2);
      });

      then('it shows belay that', () => {
        expect(result.stdout + result.stderr).toContain('belay that');
      });

      then('it names the absent --env arg', () => {
        expect(result.stdout + result.stderr).toContain('--env');
      });
    });
  });

  given('[case2] invalid --env', () => {
    when('[t0] skill runs with a bogus env', () => {
      const result = useThen('skill runs', () =>
        runSkill({ args: '--env bogus', cwd: scene.dir }),
      );

      then('it exits 2 (constraint)', () => {
        expect(result.exitCode).toBe(2);
      });

      then('it explains valid envs', () => {
        expect(result.stdout + result.stderr).toContain('test, prep, or prod');
      });
    });
  });

  given('[case3] config is placeholder "null" for tunnel targets', () => {
    const stubbed = useBeforeAll(async () => {
      setStubConfig({
        cwd: scene.dir,
        bastionExid: 'null',
        clusterName: 'null',
        account: 'null',
      });
      return runSkill({ args: '--env test', cwd: scene.dir });
    });

    when('[t0] skill runs with valid --env but absent config', () => {
      then('it exits 2 (constraint, caller must fix config)', () => {
        expect(stubbed.exitCode).toBe(2);
      });

      then('it shows belay that', () => {
        expect(stubbed.stdout + stubbed.stderr).toContain('belay that');
      });

      then('it names the absent bastion config key', () => {
        expect(stubbed.stdout + stubbed.stderr).toContain(
          'database.tunnel.bastion.exid',
        );
      });

      then('it names the absent cluster config key', () => {
        expect(stubbed.stdout + stubbed.stderr).toContain(
          'database.tunnel.cluster.name',
        );
      });

      then('it names the absent account config key', () => {
        expect(stubbed.stdout + stubbed.stderr).toContain('aws.account');
      });

      then('it guides the caller to fix their config', () => {
        expect(stubbed.stdout + stubbed.stderr).toContain('hint:');
      });

      then('it does not proceed to open the tunnel', () => {
        expect(stubbed.stdout + stubbed.stderr).not.toContain('await capacity');
      });
    });
  });

  given('[case4] help requested without --env', () => {
    when('[t0] help is passed as positional arg', () => {
      const result = useThen('skill runs', () =>
        runSkill({ args: 'help', cwd: scene.dir }),
      );

      then('it exits 0 (help short-circuits before --env validation)', () => {
        expect(result.exitCode).toBe(0);
      });

      then('it shows the deal', () => {
        expect(result.stdout).toContain('heres the deal');
      });

      then('it names the skill', () => {
        expect(result.stdout).toContain('use.rds.capacity');
      });

      then('it does not show belay that', () => {
        expect(result.stdout + result.stderr).not.toContain('belay that');
      });
    });

    when('[t0b] --help is passed after other args (rhx passthrough)', () => {
      const result = useThen('skill runs', () =>
        runSkill({
          args: '--skill use.rds.capacity --repo ghlitch --role operator --help',
          cwd: scene.dir,
        }),
      );

      then('it exits 0 (help detected regardless of position)', () => {
        expect(result.exitCode).toBe(0);
      });

      then('it shows the deal', () => {
        expect(result.stdout).toContain('heres the deal');
      });
    });
  });
});
