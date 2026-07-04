import { genTempDir, given, then, useBeforeAll, useThen, when } from 'test-fns';

import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * .what = integration test for use.vpc.tunnel env-awareness
 * .why = prove the skill derives its target per-env from config, fails fast
 *        on absent config, short-circuits localhost targets, and validates
 *        --env — all without an opaque downstream failure
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
  const skillPath = `${__dirname}/use.vpc.tunnel.sh`;

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
 * .what = write a stub getConfig that returns the given tunnel config
 * .why = lets each case model a specific env's config (localhost, ssm, or null)
 */
const setStubConfig = (input: {
  cwd: string;
  bastionExid: string;
  clusterName: string;
  account: string;
  host: string;
  port: string;
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
      local: { host: ${JSON.stringify(input.host)}, port: ${input.port} },
    },
  },
  aws: { account: ${JSON.stringify(input.account)} },
});
`,
  );
};

describe('use.vpc.tunnel', () => {
  const scene = useBeforeAll(async () => {
    const dir = genTempDir({
      slug: 'use-vpc-tunnel-env',
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

      then('its output matches snapshot', () => {
        expect(result.stdout + result.stderr).toMatchSnapshot();
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

      then('its output matches snapshot', () => {
        expect(result.stdout + result.stderr).toMatchSnapshot();
      });
    });
  });

  given('[case3] localhost target (local testdb, no bastion)', () => {
    const stubbed = useBeforeAll(async () => {
      setStubConfig({
        cwd: scene.dir,
        bastionExid: 'null',
        clusterName: 'null',
        account: 'null',
        host: 'localhost',
        port: '7821',
      });
      return runSkill({ args: '--env test', cwd: scene.dir });
    });

    when('[t0] skill runs with a localhost config host', () => {
      then('it exits 0 (localhost needs no ssm tunnel)', () => {
        expect(stubbed.exitCode).toBe(0);
      });

      then('it confirms the localhost target', () => {
        expect(stubbed.stdout).toContain('localhost');
      });

      then('it does not attempt an ssm tunnel (no declastruct)', () => {
        expect(stubbed.stdout + stubbed.stderr).not.toContain('declastruct');
      });

      then('it does not belay despite null bastion/cluster', () => {
        expect(stubbed.stdout + stubbed.stderr).not.toContain('belay that');
      });

      then('its output matches snapshot', () => {
        expect(stubbed.stdout).toMatchSnapshot();
      });
    });
  });

  given(
    '[case4] ssm target with placeholder "null" bastion/cluster/account',
    () => {
      const stubbed = useBeforeAll(async () => {
        setStubConfig({
          cwd: scene.dir,
          bastionExid: 'null',
          clusterName: 'null',
          account: 'null',
          host: 'aws.ssmproxy.ahbodedb.prep',
          port: '15432',
        });
        return runSkill({ args: '--env prep', cwd: scene.dir });
      });

      when('[t0] skill runs with valid --env but absent ssm config', () => {
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

        then('it does not open the tunnel', () => {
          expect(stubbed.stdout + stubbed.stderr).not.toContain('declastruct');
        });

        then('its output matches snapshot', () => {
          expect(stubbed.stdout + stubbed.stderr).toMatchSnapshot();
        });
      });
    },
  );

  given('[case5] placeholder "null" local port', () => {
    const stubbed = useBeforeAll(async () => {
      setStubConfig({
        cwd: scene.dir,
        bastionExid: 'vpc-main-bastion',
        clusterName: 'ahbodedb-prep',
        account: '123456789012',
        host: 'aws.ssmproxy.ahbodedb.prep',
        port: 'null',
      });
      return runSkill({ args: '--env prep', cwd: scene.dir });
    });

    when('[t0] skill runs with an absent local port', () => {
      then('it exits 2 (constraint)', () => {
        expect(stubbed.exitCode).toBe(2);
      });

      then('it names the absent port config key', () => {
        expect(stubbed.stdout + stubbed.stderr).toContain(
          'database.tunnel.local.port',
        );
      });

      then('its output matches snapshot', () => {
        expect(stubbed.stdout + stubbed.stderr).toMatchSnapshot();
      });
    });
  });

  given('[case6] help requested', () => {
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
        expect(result.stdout).toContain('use.vpc.tunnel');
      });

      then('it does not show belay that', () => {
        expect(result.stdout + result.stderr).not.toContain('belay that');
      });

      then('its output matches snapshot', () => {
        expect(result.stdout).toMatchSnapshot();
      });
    });

    when('[t0b] --help is passed after other args (rhx passthrough)', () => {
      const result = useThen('skill runs', () =>
        runSkill({
          args: '--skill use.vpc.tunnel --repo ghlitch --role operator --help',
          cwd: scene.dir,
        }),
      );

      then('it exits 0 (help detected regardless of position)', () => {
        expect(result.exitCode).toBe(0);
      });

      then('it shows the deal', () => {
        expect(result.stdout).toContain('heres the deal');
      });

      then('its output matches snapshot', () => {
        expect(result.stdout).toMatchSnapshot();
      });
    });
  });

  given('[case7] prod ssm target with placeholder "null" config', () => {
    const stubbed = useBeforeAll(async () => {
      // prove --env prod is accepted (not rejected) and takes the ssm path,
      // symmetric to prep (case4) — the wish requires prep AND prod AND test
      setStubConfig({
        cwd: scene.dir,
        bastionExid: 'null',
        clusterName: 'null',
        account: 'null',
        host: 'aws.ssmproxy.ahbodedb.prod',
        port: '15433',
      });
      return runSkill({ args: '--env prod', cwd: scene.dir });
    });

    when('[t0] skill runs with --env prod but absent ssm config', () => {
      then('it accepts prod (does not reject as invalid env)', () => {
        expect(stubbed.stdout + stubbed.stderr).not.toContain(
          'must be: test, prep, or prod',
        );
      });

      then('it exits 2 (constraint, caller must fix config)', () => {
        expect(stubbed.exitCode).toBe(2);
      });

      then('it names prod in the failfast message', () => {
        expect(stubbed.stdout + stubbed.stderr).toContain('prod');
      });

      then('it names the absent ssm config keys', () => {
        expect(stubbed.stdout + stubbed.stderr).toContain(
          'database.tunnel.bastion.exid',
        );
      });

      then('it does not open the tunnel', () => {
        expect(stubbed.stdout + stubbed.stderr).not.toContain('declastruct');
      });

      then('its output matches snapshot', () => {
        expect(stubbed.stdout + stubbed.stderr).toMatchSnapshot();
      });
    });
  });

  given('[case8] a removed old-interface arg (--bastion)', () => {
    when('[t0] skill runs with a no-longer-supported --bastion', () => {
      const result = useThen('skill runs', () =>
        runSkill({ args: '--env prep --bastion vpc-main', cwd: scene.dir }),
      );

      then('it exits 2 (constraint, not a silent no-op)', () => {
        expect(result.exitCode).toBe(2);
      });

      then('it names the unknown option rather than a silent skip', () => {
        expect(result.stdout + result.stderr).toContain('unknown option');
        expect(result.stdout + result.stderr).toContain('--bastion');
      });

      then('its output matches snapshot', () => {
        expect(result.stdout + result.stderr).toMatchSnapshot();
      });
    });
  });

  given('[case9] placeholder "null" local host', () => {
    const stubbed = useBeforeAll(async () => {
      setStubConfig({
        cwd: scene.dir,
        bastionExid: 'vpc-main-bastion',
        clusterName: 'ahbodedb-prep',
        account: '123456789012',
        host: 'null',
        port: '15432',
      });
      return runSkill({ args: '--env prep', cwd: scene.dir });
    });

    when('[t0] skill runs with an absent local host', () => {
      then('it exits 2 (constraint, not a null host into the ssm path)', () => {
        expect(stubbed.exitCode).toBe(2);
      });

      then('it names the absent host config key', () => {
        expect(stubbed.stdout + stubbed.stderr).toContain(
          'database.tunnel.local.host',
        );
      });

      then('it does not open the tunnel', () => {
        expect(stubbed.stdout + stubbed.stderr).not.toContain('declastruct');
      });

      then('its output matches snapshot', () => {
        expect(stubbed.stdout + stubbed.stderr).toMatchSnapshot();
      });
    });
  });
});
