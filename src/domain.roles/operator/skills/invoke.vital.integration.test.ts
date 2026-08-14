import { given, then, useBeforeAll, when } from 'test-fns';

import { expectNoStrayLines } from '../../.test/expectNoStrayLines';
import { PATH_WITHOUT_RHX } from '../../.test/runRoleSkill';
import {
  CHILD_ECHO,
  CHILD_FAILS,
  genInvokeReachEnv,
  runOperatorSkill,
  setupInvokeRepo,
} from './.test/runOperatorSkill';

/**
 * .what = render clamps for every critipath of the `invoke.vital` contract
 * .why  = this skill had NO test at all, and it is a line-for-line TWIN of
 *         `invoke.command` — so it carried every one of that skill's six defects, and it
 *         is the reason the sweep had to be by artifact rather than by name: a fix applied
 *         to one twin leaves the other silently broken.
 *
 *         the six, all found by a structural read rather than by any failure:
 *           1. help was checked ONLY as `$1`, ahead of the arg loop — so under `rhx`,
 *              which passes `--skill/--repo/--role` first, `--help` fell through to the
 *              passthrough arm and was handed to the vital rather than answered
 *           2. `--list` printed a bare `🦺 available vitals:` — an artifact header with no
 *              mascot above it, a colon at its tail, and, when the directory held no
 *              vital, not one line below it
 *           3. the tunnel failure arm printed a SECOND `└─` on a tree the item above had
 *              already closed, so one run drew two closes
 *           4. `exec npx tsx` handed the terminal to the vital, so its whole render landed
 *              at column 0 under a tree that never closed — and the run had no success
 *              close at all
 *           5. `--name` / `--env` took `$2` with no guard, so a flag in last position
 *              tripped a cryptic `set -u` crash rather than a belay
 *           6. the credential `eval` was unguarded, so a failed read died under `set -e`
 *              with aws's own message at column 0 and no belay
 *
 * .note = the invoke cases run the vital through the GENUINE `npx tsx` against a real
 *         `.ts` file written into the temp repo. the vital is the subject of the bucket
 *         under test, so a faked one would clamp the fake's render rather than a real
 *         child's (rule.forbid.integration.mocks).
 */

const ARTIFACT = '🦺';

const setupRepo = (input: {
  slug: string;
  vitals: { name: string; body: string }[];
  withVitalsDir?: boolean;
}): string =>
  setupInvokeRepo({
    slug: input.slug,
    at: 'src/contract/vitals',
    children: input.vitals,
    withDir: input.withVitalsDir,
  });

const runInvoke = (
  input: { args: string; cwd: string },
  options?: { env?: Record<string, string> },
): { stdout: string; stderr: string; exitCode: number } =>
  runOperatorSkill(
    { skill: 'invoke.vital.sh', args: input.args, cwd: input.cwd },
    { env: { PATH: PATH_WITHOUT_RHX, ...(options?.env ?? {}) } },
  );

describe('invoke.vital (contract renders)', () => {
  given('[case1] help is requested', () => {
    const scene = useBeforeAll(async () => {
      const dir = setupRepo({ slug: 'invoke-vital-help', vitals: [] });
      return {
        bare: runInvoke({ args: 'help', cwd: dir }),
        long: runInvoke({ args: '--help', cwd: dir }),
        short: runInvoke({ args: '-h', cwd: dir }),
        // the shape that mattered: under `rhx`, help is NEVER the first token, so a
        // `$1`-only check misses it entirely (rule.require.skill-help, `.antipattern`)
        viaRhx: runInvoke({
          args: '--skill invoke.vital --repo ghlitch --role operator --help',
          cwd: dir,
        }),
      };
    });

    when('[t0] help is the first token', () => {
      then('the full help stdout matches snapshot (visual vibecheck)', () => {
        expect(scene.bare.exitCode).toEqual(0);
        expect(scene.bare.stdout).toMatchSnapshot();
      });
    });

    when('[t1] help arrives in any of its four shapes', () => {
      then('every shape answers with the SAME text', () => {
        expect(scene.long.stdout).toEqual(scene.bare.stdout);
        expect(scene.short.stdout).toEqual(scene.bare.stdout);
        expect(scene.viaRhx.stdout).toEqual(scene.bare.stdout);
      });

      then('every shape exits 0', () => {
        expect(scene.long.exitCode).toEqual(0);
        expect(scene.short.exitCode).toEqual(0);
        expect(scene.viaRhx.exitCode).toEqual(0);
      });

      then(
        'the rhx shape does NOT fall through to the absent-arg belay',
        () => {
          expect(scene.viaRhx.stdout).not.toContain('absent required arg');
        },
      );
    });
  });

  given('[case2] the available vitals are listed', () => {
    const scene = useBeforeAll(async () => {
      const many = setupRepo({
        slug: 'invoke-vital-list-many',
        vitals: [
          { name: 'checkCoverage', body: CHILD_ECHO },
          { name: 'checkFreshness', body: CHILD_ECHO },
          { name: 'checkLatency', body: CHILD_ECHO },
        ],
      });
      const none = setupRepo({ slug: 'invoke-vital-list-none', vitals: [] });
      return {
        many: runInvoke({ args: '--list', cwd: many }),
        none: runInvoke({ args: '--list', cwd: none }),
      };
    });

    when('[t0] the directory holds three vitals', () => {
      then('the FULL stdout matches snapshot (visual vibecheck)', () => {
        expect(scene.many.exitCode).toEqual(0);
        expect(scene.many.stdout).toMatchSnapshot();
      });

      then('every line is a mascot, a header, or a tree item', () => {
        expectNoStrayLines({ out: scene.many.stdout, artifact: ARTIFACT });
      });

      then('the header carries a mascot and no colon at its tail', () => {
        expect(scene.many.stdout).not.toContain('available vitals:');
        expect(scene.many.stdout.startsWith('🐈 ')).toEqual(true);
      });

      then('the last vital takes the └─ and the rest take ├─', () => {
        expect(scene.many.stdout).toContain('      ├─ checkCoverage');
        expect(scene.many.stdout).toContain('      ├─ checkFreshness');
        expect(scene.many.stdout).toContain('      └─ checkLatency');
      });
    });

    when('[t1] the directory holds no vital', () => {
      then(
        'the empty list is a nested item, never a header with no body',
        () => {
          expect(scene.none.exitCode).toEqual(0);
          expect(scene.none.stdout).toMatchSnapshot();
        },
      );

      then('the answer is SPOKEN rather than left as silence', () => {
        expect(scene.none.stdout).toContain('      └─ (none)');
      });
    });
  });

  given('[case3] the repo holds no vital directory', () => {
    const scene = useBeforeAll(async () => {
      const dir = setupRepo({
        slug: 'invoke-vital-nodir',
        vitals: [],
        withVitalsDir: false,
      });
      return {
        list: runInvoke({ args: '--list', cwd: dir }),
        named: runInvoke({ args: '--name checkCoverage --env prep', cwd: dir }),
      };
    });

    when('[t0] --list is asked of it', () => {
      then('it is a constraint (exit 2) and matches snapshot', () => {
        expect(scene.list.exitCode).toEqual(2);
        expect(scene.list.stdout).toMatchSnapshot();
      });
    });

    when('[t1] a vital is named', () => {
      then('the SAME belay answers, from the one shared check', () => {
        expect(scene.named.exitCode).toEqual(2);
        expect(scene.named.stdout).toEqual(scene.list.stdout);
      });
    });
  });

  given('[case4] argument constraints belay before any work is done', () => {
    const scene = useBeforeAll(async () => {
      const dir = setupRepo({
        slug: 'invoke-vital-args',
        vitals: [{ name: 'checkCoverage', body: CHILD_ECHO }],
      });
      return {
        noName: runInvoke({ args: '--env prep', cwd: dir }),
        noEnv: runInvoke({ args: '--name checkCoverage', cwd: dir }),
        badEnv: runInvoke({
          args: '--name checkCoverage --env camp',
          cwd: dir,
        }),
        noSuch: runInvoke({ args: '--name absentVital --env prep', cwd: dir }),
      };
    });

    when('[t0] --name is absent', () => {
      then('it is a constraint (exit 2) and matches snapshot', () => {
        expect(scene.noName.exitCode).toEqual(2);
        expect(scene.noName.stdout).toMatchSnapshot();
      });
    });

    when('[t1] --env is absent', () => {
      then('it is a constraint (exit 2) and matches snapshot', () => {
        expect(scene.noEnv.exitCode).toEqual(2);
        expect(scene.noEnv.stdout).toMatchSnapshot();
      });
    });

    when('[t2] --env names an env this skill does not serve', () => {
      then('it names the valid set and matches snapshot', () => {
        expect(scene.badEnv.exitCode).toEqual(2);
        expect(scene.badEnv.stdout).toMatchSnapshot();
      });
    });

    when('[t3] --name names a vital that does not exist', () => {
      then('it is a constraint (exit 2) and matches snapshot', () => {
        expect(scene.noSuch.exitCode).toEqual(2);
        expect(scene.noSuch.stdout).toMatchSnapshot();
      });
    });
  });

  given('[case5] a flag is passed with no value', () => {
    const scene = useBeforeAll(async () => {
      const dir = setupRepo({
        slug: 'invoke-vital-noval',
        vitals: [{ name: 'checkCoverage', body: CHILD_ECHO }],
      });
      return {
        env: runInvoke({ args: '--name checkCoverage --env', cwd: dir }),
        name: runInvoke({ args: '--name', cwd: dir }),
        swallow: runInvoke({ args: '--name --env prep', cwd: dir }),
      };
    });

    when('[t0] --env is the last token', () => {
      then('it belays with the valid set, never a set -u crash', () => {
        expect(scene.env.exitCode).toEqual(2);
        expect(scene.env.stdout).toMatchSnapshot();
      });
    });

    when('[t1] a free-form flag is the last token', () => {
      then('--name belays with no fabricated value set', () => {
        expect(scene.name.exitCode).toEqual(2);
        expect(scene.name.stdout).toMatchSnapshot();
      });
    });

    when('[t2] a flag is followed by ANOTHER flag', () => {
      /**
       * the second shape require_val guards, and the subtler one: absent this check
       * `--name` would take `--env` as its value and eat the flag whole, so the run would
       * belay about an absent `--env` — the WRONG flag — and send the human to fix one
       * that was never wrong.
       */
      then('the belay names the flag that was actually starved', () => {
        expect(scene.swallow.exitCode).toEqual(2);
        expect(scene.swallow.stdout).toContain('absent value for --name');
        expect(scene.swallow.stdout).not.toContain('--env');
      });
    });
  });

  given('[case6] the credential read finds no profile', () => {
    const scene = useBeforeAll(async () => {
      const dir = setupRepo({
        slug: 'invoke-vital-nocred',
        vitals: [{ name: 'checkCoverage', body: CHILD_ECHO }],
      });
      // no stub bin on this PATH, so `rhx` is absent and the read answers empty — the
      // path a human takes with a locked keyrack
      return runInvoke({ args: '--name checkCoverage --env prep', cwd: dir });
    });

    when('[t0] the keyrack answers empty', () => {
      then('it is a malfunction (exit 1) and matches snapshot', () => {
        expect(scene.exitCode).toEqual(1);
        expect(scene.stdout).toMatchSnapshot();
      });

      then('the belay names the fix', () => {
        expect(scene.stdout).toContain(
          'rhx keyrack unlock --owner ehmpath --env prep',
        );
      });
    });
  });

  given('[case7] the vital is invoked', () => {
    const scene = useBeforeAll(async () => {
      const okDir = setupRepo({
        slug: 'invoke-vital-run-ok',
        vitals: [{ name: 'checkCoverage', body: CHILD_ECHO }],
      });
      const badDir = setupRepo({
        slug: 'invoke-vital-run-bad',
        vitals: [{ name: 'checkCoverage', body: CHILD_FAILS }],
      });
      return {
        ok: runInvoke(
          { args: '--name checkCoverage --env prep --alert', cwd: okDir },
          { env: genInvokeReachEnv({ cwd: okDir }) },
        ),
        bad: runInvoke(
          { args: '--name checkCoverage --env prep', cwd: badDir },
          { env: genInvokeReachEnv({ cwd: badDir }) },
        ),
      };
    });

    when('[t0] the vital succeeds', () => {
      then('the FULL stdout matches snapshot (visual vibecheck)', () => {
        expect(scene.ok.exitCode).toEqual(0);
        expect(scene.ok.stdout).toMatchSnapshot();
      });

      then(
        'every line is a mascot, a header, a tree item, or the frame',
        () => {
          expectNoStrayLines({ out: scene.ok.stdout, artifact: ARTIFACT });
        },
      );

      /**
       * the dedicated control for defect 4. `exec` put the vital's render at column 0;
       * the positive proves it now sits behind the gutter, and the negative proves it is
       * not ALSO rendered at column 0 — a double-render satisfies the positive alone.
       */
      then('the vital render sits inside the bucket, never at column 0', () => {
        expect(scene.ok.stdout).toContain('      │  the child ran');
        expect(scene.ok.stdout).not.toMatch(/^the child ran$/m);
      });

      then('the bucket is framed, and is NOT hollow', () => {
        expect(scene.ok.stdout).toContain('      ├─\n');
        expect(scene.ok.stdout).toContain('      └─\n');
        expect(scene.ok.stdout).not.toMatch(/ {6}├─\n {6}│\n {6}│\n {6}└─/);
      });

      then('the passthrough args reached the vital', () => {
        expect(scene.ok.stdout).toContain('--alert');
      });

      /**
       * the dedicated control for defect 3. the tunnel arm used to print `   └─ warn: ...`
       * beneath a `   └─ env:` that had already closed the tree, so one run drew two
       * closes and a reader could not tell where the tree ended.
       */
      then('the header tree draws exactly ONE close per phase', () => {
        const closes = scene.ok.stdout
          .split('\n')
          .filter((line) => /^ {3}└─ /.test(line));
        expect(closes).toEqual([
          '   └─ invoke the vital...',
          '   └─ vital completed',
        ]);
      });

      then('the run ends on a verdict, never on a bare cat', () => {
        expect(scene.ok.stdout).toContain('🐈 smooth sailin!');
        expect(
          scene.ok.stdout.trimEnd().endsWith('   └─ vital completed'),
        ).toEqual(true);
      });

      then('the artifact header count equals the mascot phase count', () => {
        const headers = scene.ok.stdout
          .split('\n')
          .filter((line) => line.startsWith('🦺 invoke.vital'));
        expect(headers).toEqual([
          '🦺 invoke.vital --name checkCoverage --env prep',
          '🦺 invoke.vital --name checkCoverage --env prep',
        ]);
      });
    });

    when('[t1] the vital exits non-zero', () => {
      then('the run forwards the child code and matches snapshot', () => {
        expect(scene.bad.exitCode).toEqual(3);
        expect(scene.bad.stdout).toMatchSnapshot();
      });

      then('the belay names the code the child exited with', () => {
        expect(scene.bad.stdout).toContain('   ├─ the vital exited 3');
      });

      /**
       * `run_sub_bucket` reads the child as `2>&1`, because a gutter cannot interleave
       * two streams and keep their order. so a line the vital wrote to STDERR arrives on
       * the composer's STDOUT once framed — clamp that stream change explicitly rather
       * than let a later test drift onto whichever stream happens to carry it.
       */
      then("the child's stderr arrives inside the bucket, on stdout", () => {
        expect(scene.bad.stdout).toContain(
          '      │  the child could not finish',
        );
        expect(scene.bad.stderr).not.toContain('the child could not finish');
      });
    });
  });
});
