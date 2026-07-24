import { genTempDir, given, then, useBeforeAll, when } from 'test-fns';

import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * .what = argument-boundary proof for provision.declastruct
 * .why = every validation branch (absent/invalid --wish, --env, --mode, --auth,
 *        a flag with no value, apply-with-no-plan, and help) exits before the skill
 *        touches keyrack or declastruct. so the whole belay/help surface a human sees
 *        is provable hermetically — no aws creds, no live declastruct. this pins the
 *        exact class of defect the `--` passthrough slip was (an arg-parse boundary
 *        bug) and snapshots the belay/help stdout for a human vibecheck.
 * .note = the live plan/apply forward-contract path (npx declastruct against a real
 *         wish) needs real declastruct + creds and is owned by 5.3.verification; it is
 *         deliberately out of scope here. AWS_ACCESS_KEY_ID is set so the one case that
 *         reaches past validation (apply-with-no-plan) takes the ci/oidc path and skips
 *         keyrack, hitting its belay before any i/o.
 */

const SKILL = `${__dirname}/provision.declastruct.sh`;

/**
 * .what = replace per-run temp paths in stdout with stable placeholders
 * .why = the apply-no-plan belay echoes the temp wish + plan-file paths, which vary per
 *        run. swap them for <WISH>/<DIR> so the belay's full stdout is snapable. for the
 *        belays that echo only static literals this is a no-op, so it is safe to apply
 *        uniformly before every belay snapshot.
 */
const withStablePaths = (input: {
  stdout: string;
  dir: string;
  wish: string;
}): string =>
  input.stdout.split(input.wish).join('<WISH>').split(input.dir).join('<DIR>');

/**
 * .what = run provision.declastruct.sh with the given args from a temp cwd
 * .why = exercises the real skill's arg parse + validation exactly as a caller would
 * .note = AWS_ACCESS_KEY_ID set → the skill's keyrack-skip guard fires, so no case in
 *         this suite ever prompts sso or needs a credential.
 */
const run = (input: {
  args: string;
  cwd: string;
}): { stdout: string; stderr: string; exitCode: number } => {
  const env: Record<string, string> = {
    ...process.env,
    AWS_ACCESS_KEY_ID: 'test-skip-keyrack',
    AWS_SECRET_ACCESS_KEY: 'test-skip-keyrack',
  };
  const result = spawnSync('bash', ['-c', `bash "${SKILL}" ${input.args}`], {
    encoding: 'utf-8',
    cwd: input.cwd,
    env,
  });
  if (result.status === null)
    throw new Error(
      `skill did not exit normally: ${result.error?.message ?? 'killed by signal'}`,
    );
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    exitCode: result.status,
  };
};

describe('provision.declastruct (argument boundary)', () => {
  const scene = useBeforeAll(async () => {
    // a temp cwd with a real wish file, so the "wish exists" gate passes for the
    // apply-with-no-plan case (which must reach its plan-not-found belay).
    const dir = genTempDir({ slug: 'provision-declastruct-argbound' });
    const wish = join(dir, 'resources.ts');
    writeFileSync(wish, 'export const resources = [];\n');
    return { dir, wish };
  });

  given('[case1] help is requested', () => {
    when('[t0] help is passed', () => {
      const result = useBeforeAll(async () =>
        run({ args: 'help', cwd: scene.dir }),
      );

      then('it exits 0 (help is not an error)', () => {
        expect(result.exitCode).toBe(0);
      });

      then('it prints the ghlitch help header + every option', () => {
        expect(result.stdout).toContain('heres the deal');
        expect(result.stdout).toContain('⛵ provision.declastruct');
        expect(result.stdout).toContain('--wish');
        expect(result.stdout).toContain('--env');
        expect(result.stdout).toContain('--mode');
        expect(result.stdout).toContain('--auth');
        // the -- hard stop and --env export contract are on the help surface
        expect(result.stdout).toContain('hard stop');
        expect(result.stdout).toContain('STAGE/ACCESS');
      });

      then('the full help stdout matches snapshot (visual vibecheck)', () => {
        // help output is fully static (no temp paths / timestamps), so the raw
        // stdout is snapable — a reviewer sees the exact help a user sees.
        expect(result.stdout).toMatchSnapshot();
      });
    });
  });

  given('[case2] required args are absent', () => {
    when('[t0] --wish is absent', () => {
      const result = useBeforeAll(async () =>
        run({ args: '--env test --mode plan', cwd: scene.dir }),
      );

      then('it belays with exit 2 naming --wish', () => {
        expect(result.exitCode).toBe(2);
        expect(result.stdout).toContain('belay that');
        expect(result.stdout).toContain('absent required arg: --wish');
      });

      then('the belay stdout matches snapshot (visual vibecheck)', () => {
        expect(
          withStablePaths({ stdout: result.stdout, ...scene }),
        ).toMatchSnapshot();
      });
    });

    when('[t1] --env is absent', () => {
      const result = useBeforeAll(async () =>
        run({ args: `--wish ${scene.wish} --mode plan`, cwd: scene.dir }),
      );

      then('it belays with exit 2 naming --env', () => {
        expect(result.exitCode).toBe(2);
        expect(result.stdout).toContain('absent required arg: --env');
      });

      then('the belay stdout matches snapshot (visual vibecheck)', () => {
        expect(
          withStablePaths({ stdout: result.stdout, ...scene }),
        ).toMatchSnapshot();
      });
    });

    when('[t2] --mode is absent', () => {
      const result = useBeforeAll(async () =>
        run({ args: `--wish ${scene.wish} --env test`, cwd: scene.dir }),
      );

      then('it belays with exit 2 naming --mode', () => {
        expect(result.exitCode).toBe(2);
        expect(result.stdout).toContain('absent required arg: --mode');
      });

      then('the belay stdout matches snapshot (visual vibecheck)', () => {
        expect(
          withStablePaths({ stdout: result.stdout, ...scene }),
        ).toMatchSnapshot();
      });
    });
  });

  given('[case3] the wish path does not exist', () => {
    when('[t0] --wish points at an absent file', () => {
      const result = useBeforeAll(async () =>
        run({
          args: '--wish ./does-not-exist.ts --env test --mode plan',
          cwd: scene.dir,
        }),
      );

      then('it belays with exit 2 naming the absent wish', () => {
        expect(result.exitCode).toBe(2);
        expect(result.stdout).toContain('wish not found');
      });

      then('the belay stdout matches snapshot (visual vibecheck)', () => {
        expect(
          withStablePaths({ stdout: result.stdout, ...scene }),
        ).toMatchSnapshot();
      });
    });
  });

  given('[case4] enum args carry an invalid value', () => {
    when('[t0] --env is not test/prep/prod', () => {
      const result = useBeforeAll(async () =>
        run({
          args: `--wish ${scene.wish} --env qa --mode plan`,
          cwd: scene.dir,
        }),
      );

      then('it belays with exit 2 naming the invalid env', () => {
        expect(result.exitCode).toBe(2);
        expect(result.stdout).toContain('invalid env: qa');
        expect(result.stdout).toContain('must be: test, prep, or prod');
      });

      then('the belay stdout matches snapshot (visual vibecheck)', () => {
        expect(
          withStablePaths({ stdout: result.stdout, ...scene }),
        ).toMatchSnapshot();
      });
    });

    when('[t1] --mode is not plan/apply', () => {
      const result = useBeforeAll(async () =>
        run({
          args: `--wish ${scene.wish} --env test --mode sync`,
          cwd: scene.dir,
        }),
      );

      then('it belays with exit 2 naming the invalid mode', () => {
        expect(result.exitCode).toBe(2);
        expect(result.stdout).toContain('invalid mode: sync');
        expect(result.stdout).toContain('must be: plan or apply');
      });

      then('the belay stdout matches snapshot (visual vibecheck)', () => {
        expect(
          withStablePaths({ stdout: result.stdout, ...scene }),
        ).toMatchSnapshot();
      });
    });

    when('[t2] --auth is not as-cicd', () => {
      const result = useBeforeAll(async () =>
        run({
          args: `--wish ${scene.wish} --env test --mode plan --auth as-human`,
          cwd: scene.dir,
        }),
      );

      then('it belays with exit 2 naming the invalid auth', () => {
        expect(result.exitCode).toBe(2);
        expect(result.stdout).toContain('invalid auth: as-human');
      });

      then('the belay stdout matches snapshot (visual vibecheck)', () => {
        expect(
          withStablePaths({ stdout: result.stdout, ...scene }),
        ).toMatchSnapshot();
      });
    });
  });

  given('[case5] a valued flag is passed with no value', () => {
    when('[t0] --wish is the last token', () => {
      const result = useBeforeAll(async () =>
        run({ args: '--env test --mode plan --wish', cwd: scene.dir }),
      );

      then('it belays with exit 2 (not a set -u crash)', () => {
        expect(result.exitCode).toBe(2);
        expect(result.stdout).toContain('absent value for --wish');
      });

      then('the belay stdout matches snapshot (visual vibecheck)', () => {
        expect(
          withStablePaths({ stdout: result.stdout, ...scene }),
        ).toMatchSnapshot();
      });
    });

    when('[t1] --auth is the last token', () => {
      const result = useBeforeAll(async () =>
        run({
          args: `--wish ${scene.wish} --env test --mode plan --auth`,
          cwd: scene.dir,
        }),
      );

      then(
        'it belays with exit 2 for an absent --auth value (require_val)',
        () => {
          expect(result.exitCode).toBe(2);
          expect(result.stdout).toContain('absent value for --auth');
        },
      );

      then('the belay stdout matches snapshot (visual vibecheck)', () => {
        expect(
          withStablePaths({ stdout: result.stdout, ...scene }),
        ).toMatchSnapshot();
      });
    });

    when('[t2] --env is the last token', () => {
      const result = useBeforeAll(async () =>
        run({ args: `--wish ${scene.wish} --mode plan --env`, cwd: scene.dir }),
      );

      then('it belays with exit 2 for an absent --env value', () => {
        expect(result.exitCode).toBe(2);
        expect(result.stdout).toContain('absent value for --env');
      });

      then('the belay stdout matches snapshot (visual vibecheck)', () => {
        expect(
          withStablePaths({ stdout: result.stdout, ...scene }),
        ).toMatchSnapshot();
      });
    });

    when('[t3] --mode is the last token', () => {
      const result = useBeforeAll(async () =>
        run({ args: `--wish ${scene.wish} --env test --mode`, cwd: scene.dir }),
      );

      then('it belays with exit 2 for an absent --mode value', () => {
        expect(result.exitCode).toBe(2);
        expect(result.stdout).toContain('absent value for --mode');
      });

      then('the belay stdout matches snapshot (visual vibecheck)', () => {
        expect(
          withStablePaths({ stdout: result.stdout, ...scene }),
        ).toMatchSnapshot();
      });
    });

    when('[t4] --plan is the last token', () => {
      const result = useBeforeAll(async () =>
        run({
          args: `--wish ${scene.wish} --env test --mode plan --plan`,
          cwd: scene.dir,
        }),
      );

      then('it belays with exit 2 for an absent --plan value', () => {
        expect(result.exitCode).toBe(2);
        expect(result.stdout).toContain('absent value for --plan');
      });

      then('the belay stdout matches snapshot (visual vibecheck)', () => {
        expect(
          withStablePaths({ stdout: result.stdout, ...scene }),
        ).toMatchSnapshot();
      });
    });
  });

  given('[case6] the -- hard stop drains subsequent tokens', () => {
    // proves the -- hard stop hermetically, no live declastruct needed: a flag placed
    // AFTER -- must be drained verbatim to declastruct, NOT read as this skill's own
    // flag. so `--wish X --env test -- --mode plan` leaves MODE unset (the --mode plan
    // after -- is drained) and the skill belays for an absent --mode. if -- were broken
    // (consumed + later tokens still read as flags), --mode plan would set MODE and the
    // belay would not fire — so this case pins the hard-stop behavior of the -- bug fix.
    when('[t0] a --mode plan token sits after --', () => {
      const result = useBeforeAll(async () =>
        run({
          args: `--wish ${scene.wish} --env test -- --mode plan`,
          cwd: scene.dir,
        }),
      );

      then(
        'the post-- --mode is drained, so MODE stays absent → exit 2',
        () => {
          expect(result.exitCode).toBe(2);
          expect(result.stdout).toContain('absent required arg: --mode');
        },
      );

      then('the belay stdout matches snapshot (visual vibecheck)', () => {
        expect(
          withStablePaths({ stdout: result.stdout, ...scene }),
        ).toMatchSnapshot();
      });
    });
  });

  given('[case7] apply is requested with no prior plan file', () => {
    when('[t0] --mode apply and no <wish>.plan.json exists', () => {
      const result = useBeforeAll(async () =>
        run({
          args: `--wish ${scene.wish} --env test --mode apply`,
          cwd: scene.dir,
        }),
      );

      then('it belays with exit 2 asking to run --mode plan first', () => {
        expect(result.exitCode).toBe(2);
        expect(result.stdout).toContain('plan not found');
        expect(result.stdout).toContain('run --mode plan first');
      });

      then(
        'the belay stdout matches snapshot — temp paths normalized (visual vibecheck)',
        () => {
          // this belay echoes the temp wish + plan-file paths in its header and body;
          // withStablePaths swaps them for <WISH>/<DIR> so the full block is snapable.
          expect(
            withStablePaths({ stdout: result.stdout, ...scene }),
          ).toMatchSnapshot();
        },
      );
    });
  });
});

/**
 * .what = live forward-contract proof: real `npx declastruct plan` end-to-end
 * .why = the skill's core promise is that declastruct's plan/apply stdout flows through
 *        UNMODIFIED (a forward contract CI greps). the arg-boundary suite above stops at
 *        validation; this suite drives the real `npx declastruct` on a hermetic
 *        empty-resources wish (no providers, no resources → naught to reconcile → exit 0,
 *        plan file written). that proves, without any aws call, that: the skill reaches
 *        the declastruct invocation, forwards its stdout, writes <wish>.plan.json at the
 *        CI-convention path, and frames it with the ⛵ headers.
 * .note = AWS_ACCESS_KEY_ID is set so the skill takes the ci/oidc keyrack-skip path; the
 *         empty wish declares no providers, so no credential is exercised regardless.
 */
describe('provision.declastruct (live plan forward-contract)', () => {
  // the repo root — `npx declastruct` resolves its pinned local binary from here, so the
  // skill runs from this cwd (the wish itself lives at an absolute temp path, so its
  // <wish>.plan.json lands in the temp dir, not the repo).
  const REPO_ROOT = join(__dirname, '../../../..');

  const scene = useBeforeAll(async () => {
    // an empty wish at an absolute temp path: no providers, no resources → declastruct
    // has naught to reconcile, so plan runs to completion with no aws call and writes an
    // empty plan file beside the temp wish.
    const dir = genTempDir({ slug: 'provision-declastruct-live-plan' });
    const wish = join(dir, 'resources.ts');
    writeFileSync(
      wish,
      [
        'export const getProviders = async () => [];',
        'export const getResources = async () => [];',
        '',
      ].join('\n'),
    );

    // AWS_ACCESS_KEY_ID set → the skill's ci/oidc keyrack-skip path fires (no sso
    // prompt); the empty wish declares no providers, so no credential is exercised.
    const env: Record<string, string> = {
      ...process.env,
      AWS_ACCESS_KEY_ID: 'test-skip-keyrack',
      AWS_SECRET_ACCESS_KEY: 'test-skip-keyrack',
    };
    const skill = `${__dirname}/provision.declastruct.sh`;
    const result = spawnSync(
      'bash',
      ['-c', `bash "${skill}" --wish "${wish}" --env test --mode plan`],
      { encoding: 'utf-8', cwd: REPO_ROOT, env },
    );
    const stdout = result.stdout ?? '';
    // mask the non-deterministic bits so the FULL success stdout is snapable (mirrors
    // provision.database.integration.test.ts). the per-run temp dir name carries a
    // timestamp + hash, and it appears in THREE forms: the skill echoes the absolute
    // path the test passed; declastruct (run from REPO_ROOT) echoes the SAME dir
    // repo-relative (`.temp/genTempDir.symlink/<ts>.<hash>/…`); and a symlinked tmp may
    // point at a realpath. mask all three (wish before dir, so `<WISH>` wins over
    // `<DIR>/resources.ts`), plus any spinner cursor-control codes. all else — the
    // 🐈/⛵ frame + the forwarded in-sync marker — is deterministic for a
    // provider-less, resource-less wish.
    const realDir = realpathSync(dir);
    const relDir = dir.startsWith(`${REPO_ROOT}/`)
      ? dir.slice(REPO_ROOT.length + 1)
      : dir;
    const stdoutMasked = [dir, realDir, relDir]
      .reduce(
        (acc, form) => acc.split(`${form}/resources.ts`).join('<WISH>'),
        stdout,
      )
      .split(dir)
      .join('<DIR>')
      .split(realDir)
      .join('<DIR>')
      .split(relDir)
      .join('<DIR>')
      // strip ansi + cursor-move control sequences (spinner frames), if any. build the
      // esc (0x1b) at runtime, not as a source literal, so biome's
      // noControlCharactersInRegex stays happy.
      .replace(
        new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, 'g'),
        '',
      )
      .replace(/\[A\[K/g, '')
      // mask declastruct's own apply-hint invocation prefix. declastruct derives it
      // (`pnpm dlx` / `npx` / `yarn dlx` / bare) from its resolved binary path, so the
      // same run prints `pnpm dlx declastruct apply` under a local pnpm store but bare
      // `declastruct apply` under CI's resolver. strip the prefix so the forwarded hint
      // is deterministic across environments — the skill's own framing (all we own) is
      // unchanged; only this pass-through line varies by host.
      .replace(
        /(?:pnpm dlx|npx|yarn dlx) declastruct apply/g,
        'declastruct apply',
      );
    return {
      dir,
      wish,
      planFile: `${wish}.plan.json`,
      stdout,
      stdoutMasked,
      stderr: result.stderr ?? '',
      exitCode: result.status,
    };
  });

  given('[case1] a plan runs against a hermetic empty wish', () => {
    when('[t0] --mode plan is invoked', () => {
      then(
        'it completes (exit 0) — real declastruct plan ran end-to-end',
        () => {
          expect(scene.exitCode).toBe(0);
        },
      );

      then('the skill frames the run with its ⛵ plan headers', () => {
        expect(scene.stdout).toContain('chartin course');
        expect(scene.stdout).toContain('plan infra changes');
        expect(scene.stdout).toContain('smooth sailin');
      });

      then(
        'it writes the plan file at the CI-convention <wish>.plan.json path',
        () => {
          // apply mode reads this exact path back — its presence proves declastruct ran
          // to completion and the skill pointed --into at the CI-convention location.
          expect(existsSync(scene.planFile)).toBe(true);
        },
      );

      then('the success footer reports the planned path', () => {
        expect(scene.stdout).toContain('planned →');
      });

      then(
        'the FULL plan-success stdout matches snapshot (temp paths masked)',
        () => {
          // the positive-path snapshot: the whole success stdout — 🐈/⛵ frame, the
          // forwarded declastruct plan body, and the `planned →` footer — with only the
          // per-run temp paths masked. mirrors provision.database's masked plan snapshot
          // so a reviewer sees the real success output a user gets, and drift surfaces in
          // the diff. guard against a failhide: the forwarded in-sync marker + the footer
          // must actually be present in the masked text before it is snapped.
          expect(scene.stdoutMasked).toContain('in sync');
          expect(scene.stdoutMasked).toContain('planned → <WISH>.plan.json');
          expect(scene.stdoutMasked).toMatchSnapshot();
        },
      );
    });
  });

  given('[case2] an explicit --plan overrides the derived plan path', () => {
    // proves the first-class --plan input: plan mode writes to the given path, NOT the
    // derived <wish>.plan.json default. this is declastruct's --wish/--plan backbone
    // surfaced through the skill — a caller controls the plan location, and the default
    // stays the pit of success for callers who omit it.
    const override = useBeforeAll(async () => {
      const dir = genTempDir({ slug: 'provision-declastruct-plan-override' });
      const wish = join(dir, 'resources.ts');
      writeFileSync(
        wish,
        [
          'export const getProviders = async () => [];',
          'export const getResources = async () => [];',
          '',
        ].join('\n'),
      );
      // a plan path deliberately NOT beside the wish, so the override is unambiguous.
      const planCustom = join(dir, 'custom.plan.json');
      const planDefault = `${wish}.plan.json`;

      const env: Record<string, string> = {
        ...process.env,
        AWS_ACCESS_KEY_ID: 'test-skip-keyrack',
        AWS_SECRET_ACCESS_KEY: 'test-skip-keyrack',
      };
      const skill = `${__dirname}/provision.declastruct.sh`;
      const result = spawnSync(
        'bash',
        [
          '-c',
          `bash "${skill}" --wish "${wish}" --env test --mode plan --plan "${planCustom}"`,
        ],
        { encoding: 'utf-8', cwd: REPO_ROOT, env },
      );
      return {
        planCustom,
        planDefault,
        stdout: result.stdout ?? '',
        exitCode: result.status,
      };
    });

    when('[t0] --mode plan --plan <custom> is invoked', () => {
      then('it completes (exit 0)', () => {
        expect(override.exitCode).toBe(0);
      });

      then('it writes the plan at the explicit --plan path', () => {
        expect(existsSync(override.planCustom)).toBe(true);
      });

      then('it does NOT write the derived <wish>.plan.json default', () => {
        expect(existsSync(override.planDefault)).toBe(false);
      });

      then('the success footer reports the explicit plan path', () => {
        expect(override.stdout).toContain('custom.plan.json');
      });
    });
  });
});
