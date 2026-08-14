import { genTempDir, given, then, useBeforeAll, useThen, when } from 'test-fns';

import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { asEnvHermetic, genStubBinPath } from '../../.test/runRoleSkill';

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
  // a narrowed PATH that stages the stub bin FIRST. supplied only by the case that must
  // reach the capacity poll; every other case belays long before a tool is touched.
  path?: string;
}): { stdout: string; stderr: string; exitCode: number } => {
  const skillPath = `${__dirname}/use.rds.capacity.sh`;

  // the base withholds every ambient credential and closes the rc, so the static creds
  // below are a DECLARATION rather than a top-up of whatever the host happened to hold —
  // which is what keeps the keyrack-skip arm the same on a laptop and a runner
  // (rule.require.hermetic-tests).
  const env: Record<string, string | undefined> = {
    ...asEnvHermetic(),
    AWS_ACCESS_KEY_ID: 'test-skip-keyrack',
    AWS_SECRET_ACCESS_KEY: 'test-skip-keyrack',
    ...(input.path
      ? {
          PATH: input.path,
          // the stub npx delegates the config read to the genuine one; it reaches it by
          // env var, never a PATH lookup, which would find the stub again and spin.
          STUB_REAL_NPX: execSync('which npx', { encoding: 'utf-8' }).trim(),
        }
      : {}),
  };

  try {
    const stdout = execSync(
      `bash --noprofile --norc "${skillPath}" ${input.args}`,
      {
        encoding: 'utf-8',
        cwd: input.cwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
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

  given('[case3] ssm config is placeholder "null" for tunnel targets', () => {
    const stubbed = useBeforeAll(async () => {
      // model a prep (ssm) env whose targets were never filled in.
      // .note = host is non-localhost so use.vpc.tunnel takes the ssm path
      //         and fails fast on the absent targets (localhost would short-circuit)
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

    when('[t0] skill runs with valid --env but absent config', () => {
      then('it exits 2 (constraint, caller must fix config)', () => {
        expect(stubbed.exitCode).toBe(2);
      });

      then('it delegates to use.vpc.tunnel (composition is real)', () => {
        // the failfast + named keys now originate from use.vpc.tunnel, whose
        // own header surfaces here — proof the config-read was not duplicated
        expect(stubbed.stdout + stubbed.stderr).toContain('use.vpc.tunnel');
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

      then('its output matches snapshot', () => {
        expect(stubbed.stdout + stubbed.stderr).toMatchSnapshot();
      });
    });
  });

  given(
    '[case5] the happy path reaches capacity, and FRAMES its children',
    () => {
      // the coverage this suite lacked entirely. every other case belays before a tool is
      // ever touched, so the branch that actually AWAITS capacity had never been rendered
      // by a test. two children ran there: the composed `use.vpc.tunnel`, and the
      // `timeout 180 bash -c "until pg_isready ...; done"` poll — and the poll streamed
      // un-framed at column 0 for its whole life, right after this skill's tree had
      // already closed.
      //
      // that miss is instructive: the earlier sweep for un-framed children grepped a
      // command ALLOWLIST (npm/npx/terraform/rhx), and `timeout ... bash -c` matched none
      // of them. a wrapper hides a child from a name-based sweep
      // (rule.require.nest-subskill-output-in-buckets).
      //
      // the config points at localhost, so use.vpc.tunnel takes its short-circuit and no
      // aws, keyrack, or ssm session is touched. the stub bin answers the poll.
      const stubbed = useBeforeAll(async () => {
        const dir = genTempDir({
          slug: 'use-rds-capacity-happy',
          git: true,
          symlink: [{ at: 'node_modules', to: 'node_modules' }],
        });
        setStubConfig({
          cwd: dir,
          bastionExid: 'null',
          clusterName: 'null',
          account: 'null',
          host: 'localhost',
          port: '7821',
        });
        // node's own directory joins the narrowed PATH: the real npx (which the stub
        // delegates the config read to) is a `#!/usr/bin/env node` executable, so an
        // absent node would collapse the read to a 127 and the case would exercise a
        // different path than the one it names. the stubs stay FIRST.
        const nodeDir = dirname(
          execSync('which node', { encoding: 'utf-8' }).trim(),
        );
        return runSkill({
          args: '--env prep',
          cwd: dir,
          path: `${genStubBinPath({ cwd: dir })}:${nodeDir}`,
        });
      });

      when('[t0] capacity is awaited', () => {
        then('the run REACHES the poll (exit 0)', () => {
          // the guard on this whole case. if a belay ever creeps back in ahead of the
          // poll, this reddens — instead of the frame controls below quietly held over a
          // render that was never produced.
          expect({
            exitCode: stubbed.exitCode,
            stderr: stubbed.stderr,
          }).toEqual({ exitCode: 0, stderr: '' });
          expect(stubbed.stdout).toContain('accepting connections');
        });

        then('the pg_isready child sits BEHIND the bucket gutter', () => {
          // the exact defect: `localhost:7821 - accepting connections` used to land at
          // column 0. the negative control is what proves it moved.
          expect(stubbed.stdout).toContain(
            '      │  localhost:7821 - accepting connections',
          );
          expect(stubbed.stdout).not.toMatch(/^localhost:7821 - /m);
        });

        then('the tunnel child sits BEHIND its own, DEEPER gutter', () => {
          // `   │  `, not 6 spaces: its item is a `├─`, so the tree's gutter continues
          // past it. two children at two depths is what proves two separate buckets
          // rather than one merged frame.
          expect(stubbed.stdout).toContain(
            '   │  │  🦺 use.vpc.tunnel --env prep',
          );
          expect(stubbed.stdout).toContain('   ├─ lets open the channel...');
          expect(stubbed.stdout).toContain('   └─ await capacity...');
        });

        then('each frame is drawn, and NEITHER is empty', () => {
          expect(stubbed.stdout).not.toMatch(
            / {3}│ {2}├─\n {3}│ {2}│\n {3}│ {2}│\n {3}│ {2}└─/,
          );
          expect(stubbed.stdout).not.toMatch(/ {6}├─\n {6}│\n {6}│\n {6}└─/);
        });

        then('ONE header is drawn, not one per paragraph', () => {
          // the other defect this case guards: the skill used to reprint
          // `🦺 use.rds.capacity --env prep` before each paragraph, so one run drew three
          // trees. exactly two artifact headers are correct — one per mascot phase
          // (`🐈 rise and shine...` and `🐈 caught it!`), and the second drops the flag
          // because it reports an outcome rather than an invocation.
          const headers = stubbed.stdout
            .split('\n')
            .filter((line) => line.startsWith('🦺 use.rds.capacity'));
          expect(headers).toEqual([
            '🦺 use.rds.capacity --env prep',
            '🦺 use.rds.capacity',
          ]);
        });

        then('the FULL stdout matches snapshot (visual vibecheck)', () => {
          expect(stubbed.stdout).toMatchSnapshot();
        });
      });
    },
  );

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

      then('its output matches snapshot', () => {
        expect(result.stdout).toMatchSnapshot();
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
