import { genTempDir, given, then, useBeforeAll, when } from 'test-fns';

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { genStubBinPath } from '../../.test/runRoleSkill';

/**
 * .what = render clamps for every critipath of the `use.testdb` contract
 * .why  = this skill had NO test at all, and four children ran un-framed inside its tree
 *         for its whole life: `npm run start:testdb` (twice), the docker self-heal, and
 *         the container-log dump on the wedged path. all four RENDER, so all four are
 *         framed (rule.require.nest-subskill-output-in-buckets) — and a frame is a claim
 *         about a render, so each needs a case that produces one.
 *
 *         it also could not be tested before without a docker daemon, which is the
 *         host-shaped fork the stub bin closes (rule.require.hermetic-tests).
 */

/**
 * .what = run use.testdb from a temp repo, with the stub bin staged FIRST on PATH
 * .why  = docker and npm are both stubbed, so the three real branches — healthy on the
 *         first try, healthy after a heal, and wedged — are each reachable with no
 *         daemon, no container, and no volume.
 *
 * .note = spawnSync, never execSync: the wedged path exits 1 while it still renders a
 *         full tree on stdout, and execSync would throw one away.
 *
 * .note = the host's shell rc must not load into a run. an rc-defined FUNCTION or ALIAS
 *         beats PATH outright, so a stub placed first still loses to one. BASH_ENV is the
 *         vector that carries it into a NON-interactive bash, and this host has it set —
 *         its `.bash_aliases` maps `npm` to `pnpm`, which would route straight past the
 *         stub (rule.require.hermetic-tests).
 */
const runTestdb = (input: {
  cwd: string;
  args: string;
  env?: Record<string, string>;
}): { stdout: string; stderr: string; exitCode: number } => {
  const env: Record<string, string> = {
    ...process.env,
    HOME: input.cwd,
    PATH: genStubBinPath({ cwd: input.cwd }),
    ...(input.env ?? {}),
  };
  delete env.BASH_ENV;

  const result = spawnSync(
    'bash',
    [
      '--noprofile',
      '--norc',
      `${__dirname}/use.testdb.sh`,
      ...input.args.split(' ').filter((arg) => arg.length > 0),
    ],
    { encoding: 'utf-8', cwd: input.cwd, env },
  );

  // status is null only when a signal killed the process, which we never expect — fail
  // loud rather than mask a signal death as a 0 or a 1 (rule.forbid.failhide).
  if (result.status === null)
    throw new Error(
      `use.testdb did not exit normally: ${result.error?.message ?? 'killed by signal'}`,
    );

  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    exitCode: result.status,
  };
};

const setupRepo = (input: { slug: string }): string =>
  genTempDir({
    slug: input.slug,
    git: true,
    symlink: [{ at: 'node_modules', to: 'node_modules' }],
  });

describe('use.testdb (contract renders)', () => {
  given('[case1] help is requested', () => {
    const scene = useBeforeAll(async () => {
      const dir = setupRepo({ slug: 'use-testdb-help' });
      return {
        bare: runTestdb({ cwd: dir, args: 'help' }),
        long: runTestdb({ cwd: dir, args: '--help' }),
      };
    });

    when('[t0] help is the first token', () => {
      then('it exits 0', () => {
        expect(scene.bare.exitCode).toBe(0);
      });

      then('the full help stdout matches snapshot (visual vibecheck)', () => {
        expect(scene.bare.stdout).toMatchSnapshot();
      });
    });

    when('[t1] --help is the first token', () => {
      then('it exits 0 and renders the same help', () => {
        expect(scene.long.exitCode).toBe(0);
        expect(scene.long.stdout).toEqual(scene.bare.stdout);
      });
    });
  });

  given('[case2] the testdb is healthy on the first try', () => {
    const scene = useBeforeAll(async () =>
      runTestdb({ cwd: setupRepo({ slug: 'use-testdb-healthy' }), args: '' }),
    );

    when('[t0] the start succeeds', () => {
      then('the run REACHES the start (exit 0)', () => {
        // the guard on this whole case. if a belay ever creeps back in ahead of the
        // start, this reddens instead of the frame controls below quietly held over a
        // render that was never produced.
        expect({ exitCode: scene.exitCode, stderr: scene.stderr }).toEqual({
          exitCode: 0,
          stderr: '',
        });
        expect(scene.stdout).toContain('npm-run: start:testdb');
      });

      then('the start child sits BEHIND the bucket gutter', () => {
        // the exact defect: `npm run start:testdb` used to stream at column 0, inside
        // this skill's own tree. the negative control is what proves it moved.
        expect(scene.stdout).toContain('   │  │  npm-run: start:testdb');
        expect(scene.stdout).not.toMatch(/^npm-run: /m);
      });

      then('the frame is drawn, and it is NOT empty', () => {
        expect(scene.stdout).toContain('   ├─ start testdb...');
        expect(scene.stdout).not.toMatch(
          / {3}│ {2}├─\n {3}│ {2}│\n {3}│ {2}│\n {3}│ {2}└─/,
        );
      });

      then('the self-heal is NEVER reached on a healthy start', () => {
        expect(scene.stdout).not.toContain('self-heal');
        expect(scene.stdout).not.toContain('retry testdb');
      });

      then('the FULL stdout matches snapshot (visual vibecheck)', () => {
        expect(scene.stdout).toMatchSnapshot();
      });
    });
  });

  given('[case3] the first start fails, and the self-heal recovers it', () => {
    const scene = useBeforeAll(async () => {
      const dir = setupRepo({ slug: 'use-testdb-healed' });
      return runTestdb({
        cwd: dir,
        args: '',
        // fail the FIRST start only, so the heal runs and the retry succeeds — the
        // branch that carried two un-framed children and no coverage at all
        env: { STUB_NPM_FAIL_ONCE_AT: join(dir, '.stub.npm.failed-once') },
      });
    });

    when('[t0] the retry succeeds after the heal', () => {
      then('the run recovers (exit 0)', () => {
        expect(scene.exitCode).toBe(0);
        expect(scene.stdout).toContain('testdb ready at localhost:7821');
      });

      then('all THREE children sit behind the same gutter', () => {
        // start, heal, retry — each its own bucket under its own `├─` item, all at the
        // same depth because all three are continuations of one open tree.
        expect(scene.stdout).toContain('   ├─ start testdb...');
        expect(scene.stdout).toContain('   ├─ start failed — self-heal...');
        expect(scene.stdout).toContain('   ├─ retry testdb...');
        expect(scene.stdout).not.toMatch(/^Container ghlitch-testdb/m);
        expect(scene.stdout).not.toMatch(/^npm-run: /m);
      });

      then('the heal bucket is NOT empty', () => {
        // the heal used to be `2>/dev/null || true` on every command — a failhide that
        // hid why a heal did not help. framed and un-silenced, it must now speak.
        expect(scene.stdout).toContain(
          '   │  │  Container ghlitch-testdb  Removed',
        );
      });

      then('the tree closes exactly ONCE per artifact header', () => {
        const closes = scene.stdout
          .split('\n')
          .filter((line) => line.startsWith('   └─ '));
        const headers = scene.stdout
          .split('\n')
          .filter((line) => line.startsWith('🦺 '));
        expect(closes.length).toBe(headers.length);
      });

      then('the FULL stdout matches snapshot (visual vibecheck)', () => {
        expect(scene.stdout).toMatchSnapshot();
      });
    });
  });

  given('[case4] the testdb stays wedged even after the heal', () => {
    const scene = useBeforeAll(async () =>
      runTestdb({
        cwd: setupRepo({ slug: 'use-testdb-wedged' }),
        args: '',
        env: { STUB_NPM_FAIL: 'start:testdb' },
      }),
    );

    when('[t0] both the start and the retry fail', () => {
      then('it is a malfunction (exit 1)', () => {
        expect(scene.exitCode).toBe(1);
      });

      then('the tree is CLOSED before the belay', () => {
        // an exit taken mid-tree leaves items under no close — the half-drawn shape,
        // under a mascot that already claimed the run was underway.
        expect(scene.stdout).toContain('   └─ halted: testdb did not start');
        expect(scene.stdout).toContain('🐈 wet paws...');
      });

      then('the container logs sit BEHIND the bucket gutter', () => {
        // the fourth un-framed child. it landed at column 0 under a `└─ container logs
        // follow:` that had already closed the tree.
        expect(scene.stdout).toContain(
          '      │  FATAL:  database files are incompatible with server',
        );
        expect(scene.stdout).not.toMatch(/^FATAL: {2}database files/m);
      });

      then('the FULL stdout matches snapshot (visual vibecheck)', () => {
        expect(scene.stdout).toMatchSnapshot();
      });
    });
  });
});
