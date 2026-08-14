import { genTempDir, given, then, useBeforeAll, useThen, when } from 'test-fns';

import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
// the stub bin is generic — it stands in for `rhx`, `aws`, `npx` and friends — so every
// role's suite reuses the one copy rather than grow a second that could drift. it used to
// live under the deployer suite, where the first caller was; this comment is what made the
// cross-role reach look intentional rather than like the lift it was owed
// (rule.prefer.most-common-denominator).
import { genStubBinPath } from '../../.test/runRoleSkill';

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
  // when set, PATH is pinned to this and the static aws creds are WITHHELD, so the run
  // takes the keyrack branch and reaches the wrapped tools through the stub bin. absent,
  // the legacy behavior holds: creds set, keyrack skipped, host PATH.
  path?: string;
}): { stdout: string; stderr: string; exitCode: number } => {
  const skillPath = `${__dirname}/use.vpc.tunnel.sh`;

  // set static aws creds so the skill skips keyrack unlock + sso export
  const env: Record<string, string> = {
    ...process.env,
    ...(input.path
      ? {
          PATH: input.path,
          // the stub npx shadows the real one, but the skill's CONFIG READ (`npx tsx -e`)
          // is real work this case depends on — the tunnel target comes out of it. hand
          // the stub the genuine npx by absolute path so it can delegate that one call.
          // resolved from the host PATH here, before it is narrowed for the child.
          STUB_REAL_NPX: execSync('which npx', { encoding: 'utf-8' }).trim(),
        }
      : {
          AWS_ACCESS_KEY_ID: 'test-skip-keyrack',
          AWS_SECRET_ACCESS_KEY: 'test-skip-keyrack',
        }),
  };

  // the host's shell rc must not load into a run: an rc-defined function or alias beats
  // PATH outright, so a stub placed first on PATH still loses to one. BASH_ENV is the
  // vector a NON-interactive bash reads, and this developer's host sets it
  // (rule.require.hermetic-tests).
  delete env.BASH_ENV;

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

  given(
    '[case10] the ssm path opens the tunnel, and FRAMES its children',
    () => {
      // the coverage this suite lacked entirely. every other case belays before the ssm
      // path — on an absent env, an invalid env, a localhost short-circuit, or a "null"
      // config key — so the branch that actually opens a tunnel had NEVER been rendered by
      // a test. two children ran un-framed at column 0 there for its whole life:
      // `rhx keyrack unlock` (its own 🔓 tree) and `npx declastruct apply` (its own
      // 🌊/🔮/🥥 tree). both are renders, so both are framed
      // (rule.require.nest-subskill-output-in-buckets — a tree is never a payload).
      //
      // it matters doubly here because this skill usually runs AS a child, inside
      // provision.database's gutter. an un-framed grandchild there does not just lose its
      // own delineation — it punches a hole in the parent's frame.
      //
      // the stub bin makes the branch reachable: it answers the credential read and stands
      // in for the wrapped tools, so no aws, no keyrack, and no ssm session is touched.
      const stubbed = useBeforeAll(async () => {
        const dir = genTempDir({
          slug: 'use-vpc-tunnel-ssm',
          git: true,
          symlink: [{ at: 'node_modules', to: 'node_modules' }],
        });
        setStubConfig({
          cwd: dir,
          bastionExid: 'vpc-main-bastion',
          clusterName: 'ahbodedb-prep',
          account: '123456789012',
          host: 'aws.ssmproxy.ahbodedb.prep',
          port: '15432',
        });
        // node's own directory joins the narrowed PATH, for the same reason `git` already
        // sits on it: the real npx (which the stub delegates the config read to) is a
        // `#!/usr/bin/env node` executable, so an absent node collapses the read to a 127
        // and the case would exercise a different path than the one it names.
        // the stubs stay FIRST, so they still shadow any same-named tool the host holds.
        const nodeDir = dirname(
          execSync('which node', { encoding: 'utf-8' }).trim(),
        );

        // no AWS_ACCESS_KEY_ID, so the keyrack branch is taken — that is the point
        return runSkill({
          args: '--env prep',
          cwd: dir,
          path: `${genStubBinPath({ cwd: dir })}:${nodeDir}`,
        });
      });

      when('[t0] the tunnel is opened', () => {
        then('the run REACHES both tools (exit 0)', () => {
          // the guard on this whole case. if a belay ever creeps back in ahead of the ssm
          // path, this reddens instead of the frame controls below quietly held over a
          // render that was never produced.
          expect({
            exitCode: stubbed.exitCode,
            stderr: stubbed.stderr,
          }).toEqual({ exitCode: 0, stderr: '' });
          expect(stubbed.stdout).toContain('declastruct-argv:');
        });

        then('the keyrack child sits BEHIND the bucket gutter', () => {
          // `   │  `, not 6 spaces: its item is a `├─`, so the tree's gutter continues
          // past it (the config items and the channel still follow). the depth IS the
          // claim — a 6-space frame here would say the tree had closed, which is the
          // lie the three-header shape used to tell.
          expect(stubbed.stdout).toContain('   │  │  🔓 keyrack unlock');
          expect(stubbed.stdout).not.toMatch(/^🔓 keyrack unlock/m);
        });

        then('the declastruct child sits BEHIND the bucket gutter', () => {
          // 6 spaces here, because `└─ open the channel...` IS the tree's close.
          expect(stubbed.stdout).toContain('      │  declastruct-argv:');
          expect(stubbed.stdout).not.toMatch(/^declastruct-argv:/m);
        });

        then(
          'the two frames sit at DIFFERENT depths (separate buckets)',
          () => {
            // equal depths would mean one merged frame, which the one-bucket-per-invocation
            // rule forbids. the difference also proves the tree stayed open across the
            // first child and closed on the second.
            expect(stubbed.stdout).toContain('   ├─ unlock the keyrack...');
            expect(stubbed.stdout).toContain('   └─ open the channel...');
          },
        );

        then('each frame is drawn, and NEITHER is empty', () => {
          expect(stubbed.stdout).not.toMatch(
            / {3}│ {2}├─\n {3}│ {2}│\n {3}│ {2}│\n {3}│ {2}└─/,
          );
          expect(stubbed.stdout).not.toMatch(/ {6}├─\n {6}│\n {6}│\n {6}└─/);
        });

        then('ONE header is drawn, not one per paragraph', () => {
          // the defect this case now also guards: the skill used to reprint
          // `🦺 use.vpc.tunnel --env prep` before each paragraph, so one run drew three
          // trees. exactly two artifact headers are correct — one per mascot phase
          // (`🐈 chartin course...` and `🐈 smooth sailin!`).
          const headers = stubbed.stdout
            .split('\n')
            .filter((line) => line.startsWith('🦺 use.vpc.tunnel'));
          expect(headers).toEqual([
            '🦺 use.vpc.tunnel --env prep',
            '🦺 use.vpc.tunnel --env prep',
          ]);
        });

        then('the FULL stdout matches snapshot (skill dir masked)', () => {
          // the declastruct argv carries `--wish <SCRIPT_DIR>/use.vpc.tunnel.ts`, an
          // ABSOLUTE path that differs between this developer's worktree and a CI runner.
          // left raw it would be a host-shaped snapshot that reddens on drift
          // (rule.require.hermetic-tests). mask the directory, keep the filename — the
          // filename is the part the contract actually asserts.
          expect(
            stubbed.stdout.split(`${__dirname}/`).join('<SKILL_DIR>/'),
          ).toMatchSnapshot();
        });
      });
    },
  );
});
