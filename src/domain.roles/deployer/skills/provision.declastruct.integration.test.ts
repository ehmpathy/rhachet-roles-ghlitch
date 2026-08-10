import { genTempDir, given, then, useBeforeAll, when } from 'test-fns';

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
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
 *         deliberately out of scope here. every case that reaches past validation
 *         declares `--auth via-ambient`, so the skill never touches keyrack and no case
 *         prompts sso. that declaration is now the caller's OWN, which is the point of
 *         the wish: the suite reads like a real caller instead of a lean on an ambient
 *         AWS_ACCESS_KEY_ID to trip a sniff that no longer exists.
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
 * .what = the skill's OWN last line before it hands off to `npx declastruct`
 * .why = this is the seam between output we own and output we forward. it is OUR string,
 *        printed by the skill at provision.declastruct.sh:570 / :577, so it is stable in
 *        a way the child's output is not.
 */
const HANDOFF_MARKERS = [
  '   └─ plan infra changes...',
  '   └─ apply reviewed plan...',
];

/**
 * .what = keep only the skill's OWN header block; drop declastruct's forwarded payload
 * .why = the success-path cases run on past validation into `npx declastruct`, whose
 *        output varies by host, network, and credential state — so their FULL stdout is
 *        not snapable. the header above it is ours and fully deterministic, and it is
 *        exactly the surface this route changed (the `auth:` branch + `identity` block).
 * .note = the cut is made at OUR OWN handoff line, never at the child's `🌊` header.
 *         an earlier version split on `🌊` — declastruct's marker — which held only when
 *         declastruct actually STARTED. when the child dies before it prints one line
 *         (e.g. a temp cwd that is no pnpm workspace, so the runner itself errors first),
 *         there is no `🌊` to split on, and the whole forwarded error landed in the
 *         snapshot: raw ANSI escapes, and a message whose text depends on which runner
 *         resolved. that is host-dependent by exactly the argument the apply-hint mask
 *         below already makes — the same run picks `pnpm dlx` locally and a bare binary
 *         under CI — so those snapshots would drift red at the runner. a seam we own
 *         cannot be moved by the child's failure mode.
 */
const withHeaderOnly = (input: { stdout: string }): string => {
  const marker = HANDOFF_MARKERS.find((each) => input.stdout.includes(each));
  if (marker)
    return input.stdout.slice(0, input.stdout.indexOf(marker) + marker.length);
  // no handoff line at all — the run belayed BEFORE the handoff, so every line is ours
  // and there is naught to drop. returned whole rather than silently emptied.
  return input.stdout.trimEnd();
};

/**
 * .what = run provision.declastruct.sh with the given args from a temp cwd
 * .why = exercises the real skill's arg parse + validation exactly as a caller would
 * .note = the ambient env is SCRUBBED of credential variables, then given exactly one
 *         stub. two reasons: (a) the identity block reports whatever credentials are in
 *         play, so a developer's own AWS_PROFILE would leak into a snapshot and make it
 *         host-dependent; (b) a hermetic env proves the skill reads only what the caller
 *         declared. cases that reach past validation pass `--auth via-ambient`, so
 *         keyrack is never touched.
 */
/**
 * .what = the skill's OWN credential-noun scan pattern, read out of the skill file
 * .why = this pattern has to match `get_all_cred_vars_from_shell` EXACTLY. a scrub
 *        narrower than the report leaves a host credential the skill will print, which
 *        makes every snapshot host-dependent; a scrub wider than the report strips a
 *        variable a case meant to exercise. so the two must never drift.
 * .note = it is read rather than hand-copied because the hand-copy ALREADY drifted once.
 *         a comment that said "must stay IDENTICAL" sat directly above a literal that had
 *         gone out of sync with the skill — a documented invariant is still a BROKEN
 *         invariant, and the comment bought no protection at all. now a skill-side edit
 *         propagates on its own, and a pattern that cannot be read fails the suite loud
 *         instead of degrading its coverage in silence (rule.forbid.failhide).
 * .note = the bash side is an ERE and every construct it uses (`_`, `(a|b)`, `$`) carries
 *         the same sense in a js RegExp, so the literal transfers verbatim. a future skill
 *         pattern that reached for an ERE-only construct would surface here as a RegExp
 *         parse throw — loud, at suite start, which is the outcome we want.
 */
const getOneCredVarPatternFromSkill = (): RegExp => {
  const source = readFileSync(SKILL, 'utf-8');
  const matched = source.match(/grep -E '(_\([^']*\)\$)'/);
  if (!matched?.[1])
    throw new Error(
      `could not read the credential-noun pattern out of ${SKILL} — ` +
        `expected a line of the form: grep -E '_(A|B)$'. ` +
        `if the skill's scan was reshaped, update this reader to match it.`,
    );
  return new RegExp(matched[1]);
};

const CRED_VAR_PATTERN = getOneCredVarPatternFromSkill();

// the one credential every case wants in the scrubbed env: enough that the identity block
// prints a line, and deterministic so a developer's own AWS_PROFILE never lands in a snapshot.
const CRED_STUB: Record<string, string> = { AWS_PROFILE: 'test-stub-profile' };

const run = (
  input: {
    args: string;
    cwd: string;
  },
  // `options`, not `input` — it configures HOW the run is staged rather than WHAT is run,
  // which is the one place an optional is sanctioned (rule.require.input-options-pattern,
  // and rule.forbid.undefined-inputs exempts options).
  options?: {
    // credentials to leave in the scrubbed env. defaults to CRED_STUB; pass `{}` to reach
    // the ZERO-credential path, which is the only way the identity block's `(none detected)`
    // arm is reachable — the stub otherwise guarantees at least one line.
    creds: Record<string, string>;
  },
): { stdout: string; stderr: string; exitCode: number } => {
  const envScrubbed = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !CRED_VAR_PATTERN.test(name),
    ),
  ) as Record<string, string>;
  const env: Record<string, string> = {
    ...envScrubbed,
    ...(options?.creds ?? CRED_STUB),
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
    when('[t0] --env is not test/prep/prod/camp', () => {
      const result = useBeforeAll(async () =>
        run({
          args: `--wish ${scene.wish} --env qa --mode plan`,
          cwd: scene.dir,
        }),
      );

      then('it belays with exit 2 and names the invalid env', () => {
        expect(result.exitCode).toBe(2);
        expect(result.stdout).toContain('invalid env: qa');
        // the valid set widened to carry camp — an operator who runs --env camp must
        // reach the credential path rather than belay before it, and the belay must
        // list the set it actually accepts (rule.require.discoverability).
        expect(result.stdout).toContain('must be: test, prep, prod, or camp');
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

    when('[t2] --auth is outside the value set', () => {
      const result = useBeforeAll(async () =>
        run({
          args: `--wish ${scene.wish} --env test --mode plan --auth as-human`,
          cwd: scene.dir,
        }),
      );

      then('it belays with exit 2 naming the invalid auth', () => {
        expect(result.exitCode).toBe(2);
        expect(result.stdout).toContain('invalid auth: as-human');
        expect(result.stdout).toContain('via-keyrack or via-ambient');
      });

      then('the belay stdout matches snapshot (visual vibecheck)', () => {
        expect(
          withStablePaths({ stdout: result.stdout, ...scene }),
        ).toMatchSnapshot();
      });
    });

    // the retired value gets its OWN belay, not the generic invalid-auth one: a caller
    // on the old spelling needs the migration, and "must be: via-keyrack or via-ambient"
    // names the valid set without naming the replacement for THEIR case.
    when('[t3] --auth is the retired as-cicd', () => {
      const result = useBeforeAll(async () =>
        run({
          args: `--wish ${scene.wish} --env test --mode plan --auth as-cicd`,
          cwd: scene.dir,
        }),
      );

      then('it belays with exit 2 naming the exact replacement', () => {
        expect(result.exitCode).toBe(2);
        expect(result.stdout).toContain('retired flag value: --auth as-cicd');
        expect(result.stdout).toContain('--auth via-ambient --gate for-cicd');
      });

      then('the belay stdout matches snapshot (visual vibecheck)', () => {
        expect(
          withStablePaths({ stdout: result.stdout, ...scene }),
        ).toMatchSnapshot();
      });
    });

    when('[t4] --gate is outside the value set', () => {
      const result = useBeforeAll(async () =>
        run({
          args: `--wish ${scene.wish} --env test --mode plan --gate by-human`,
          cwd: scene.dir,
        }),
      );

      then('it belays with exit 2 naming the invalid gate', () => {
        expect(result.exitCode).toBe(2);
        expect(result.stdout).toContain('invalid gate: by-human');
        expect(result.stdout).toContain('for-ehmpath or for-cicd');
      });

      then('the belay stdout matches snapshot (visual vibecheck)', () => {
        expect(
          withStablePaths({ stdout: result.stdout, ...scene }),
        ).toMatchSnapshot();
      });
    });

    // camp is the env the reported incident actually used. it must reach the credential
    // path rather than belay at the enum — a belay here would mean the operator's exact
    // reproduction never gets to the defect this wish repairs.
    when('[t5] --env camp (the env from the reported incident)', () => {
      const result = useBeforeAll(async () =>
        run({
          args: `--wish ${scene.wish} --env camp --mode apply --auth via-ambient`,
          cwd: scene.dir,
        }),
      );

      then('camp is accepted — it never belays as an invalid env', () => {
        expect(result.stdout).not.toContain('invalid env');
      });

      // the vision claims camp adds "no new authorization surface": the prod gate reads
      // `env != prod`, so a camp APPLY must never consult the local meter. this run is a
      // write path (--mode apply), so it is exactly where a widened enum could have
      // leaked one — assert the gate stayed silent rather than trust the read.
      then(
        'the prod gate never fires — camp opens no authorization surface',
        () => {
          const output = `${result.stdout}${result.stderr}`;
          expect(output).not.toContain('prod is locked');
          expect(output).not.toContain('🦺');
        },
      );

      // this run belays at `plan not found` — an APPLY with no prior plan file. that is the
      // POINT: the belay it reaches is proof of how far it got. the enum guard (:325) and the
      // prod gate (:404) both sit ABOVE the plan check (:424), so a run that surfaces
      // `plan not found` has provably cleared both. read the snapshot as a position marker.
      then('the belay stdout matches snapshot (visual vibecheck)', () => {
        expect(
          withHeaderOnly({
            stdout: withStablePaths({ stdout: result.stdout, ...scene }),
          }),
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

    // --gate joins its kin here rather than sit uncovered: it is one of this route's two
    // NEW valued flags, and it routes through the same require_val guard as the five
    // above. an uncovered new flag is the one most likely to drift, since no other case
    // in this suite would notice if its guard were dropped.
    when('[t5] --gate is the last token', () => {
      const result = useBeforeAll(async () =>
        run({
          args: `--wish ${scene.wish} --env test --mode plan --gate`,
          cwd: scene.dir,
        }),
      );

      then('it belays with exit 2 for an absent --gate value', () => {
        expect(result.exitCode).toBe(2);
        expect(result.stdout).toContain('absent value for --gate');
      });

      then('the belay stdout matches snapshot (visual vibecheck)', () => {
        expect(
          withStablePaths({ stdout: result.stdout, ...scene }),
        ).toMatchSnapshot();
      });
    });
  });

  // the kin hazard to [case5]: there, the flag was the LAST token, so `${2:-}` was empty.
  // here a flag token sits where the value belongs, so `$2` is non-empty and the emptiness
  // test alone would pass it through — WISH would become '--env', the next flag would be
  // eaten whole, and the run would belay about a flag the caller did supply. that is a
  // wrong-but-specific hint, which costs more than a right-but-general one.
  given('[case5b] a valued flag is handed another flag as its value', () => {
    when('[t0] --wish is handed --env', () => {
      const result = useBeforeAll(async () =>
        run({ args: '--wish --env test --mode plan', cwd: scene.dir }),
      );

      then('it belays and names --wish, NOT the eaten --env', () => {
        expect(result.exitCode).toBe(2);
        expect(result.stdout).toContain('absent value for --wish');
      });

      // the positive control: without it, the assert above could pass merely because the
      // run failed for some other reason. this pins that the WRONG flag is never named.
      then('it never misattributes the belay to --env', () => {
        expect(result.stdout).not.toContain('absent value for --env');
        expect(result.stdout).not.toContain('absent required arg: --env');
      });

      then('the belay stdout matches snapshot (visual vibecheck)', () => {
        expect(
          withStablePaths({ stdout: result.stdout, ...scene }),
        ).toMatchSnapshot();
      });
    });

    when('[t1] --auth is handed --mode', () => {
      const result = useBeforeAll(async () =>
        run({
          args: `--wish ${scene.wish} --env test --auth --mode plan`,
          cwd: scene.dir,
        }),
      );

      then('it belays and names --auth, NOT the eaten --mode', () => {
        expect(result.exitCode).toBe(2);
        expect(result.stdout).toContain('absent value for --auth');
        expect(result.stdout).not.toContain('absent value for --mode');
      });

      then('the belay stdout matches snapshot (visual vibecheck)', () => {
        expect(
          withStablePaths({ stdout: result.stdout, ...scene }),
        ).toMatchSnapshot();
      });
    });

    // the other four valued flags, so EVERY require_val caller is proven rather than two
    // of six. a per-flag test matters more than it looks: the guard is shared, but the
    // flag NAME each case passes is not — a copy-paste slip that guarded `--env` under the
    // label `--mode` would still belay, still exit 2, and still hand the caller the wrong
    // flag. only a per-flag assert catches that.
    //
    // the bare (last-token) shape is covered for these in [case5]; this closes the
    // flag-token-as-value shape, which is the one an emptiness-only guard lets through.
    when('[t2] --env is handed --mode', () => {
      const result = useBeforeAll(async () =>
        run({
          args: `--wish ${scene.wish} --env --mode plan`,
          cwd: scene.dir,
        }),
      );

      then('it belays and names --env, NOT the eaten --mode', () => {
        expect(result.exitCode).toBe(2);
        expect(result.stdout).toContain('absent value for --env');
        // pre-guard, ENV would have become '--mode' and this run would have died on the
        // enum instead — a belay about a value the caller never typed.
        expect(result.stdout).not.toContain('invalid env');
        expect(result.stdout).not.toContain('absent required arg: --mode');
      });

      then('the belay stdout matches snapshot (visual vibecheck)', () => {
        expect(
          withStablePaths({ stdout: result.stdout, ...scene }),
        ).toMatchSnapshot();
      });
    });

    when('[t3] --mode is handed --auth', () => {
      const result = useBeforeAll(async () =>
        run({
          args: `--wish ${scene.wish} --env test --mode --auth via-ambient`,
          cwd: scene.dir,
        }),
      );

      then('it belays and names --mode, NOT the eaten --auth', () => {
        expect(result.exitCode).toBe(2);
        expect(result.stdout).toContain('absent value for --mode');
        expect(result.stdout).not.toContain('invalid mode');
        expect(result.stdout).not.toContain('absent value for --auth');
      });

      then('the belay stdout matches snapshot (visual vibecheck)', () => {
        expect(
          withStablePaths({ stdout: result.stdout, ...scene }),
        ).toMatchSnapshot();
      });
    });

    when('[t4] --gate is handed --mode', () => {
      const result = useBeforeAll(async () =>
        run({
          args: `--wish ${scene.wish} --env test --gate --mode plan`,
          cwd: scene.dir,
        }),
      );

      then('it belays and names --gate, NOT the eaten --mode', () => {
        expect(result.exitCode).toBe(2);
        expect(result.stdout).toContain('absent value for --gate');
        // GATE carries a DEFAULT, so a silent adoption of '--mode' would NOT belay at the
        // enum for every caller — it would corrupt a prod-write authorization decision
        // while the run continued. this flag is the one where the guard matters most.
        expect(result.stdout).not.toContain('invalid gate');
      });

      then('the belay stdout matches snapshot (visual vibecheck)', () => {
        expect(
          withStablePaths({ stdout: result.stdout, ...scene }),
        ).toMatchSnapshot();
      });
    });

    when('[t5] --plan is handed --mode', () => {
      const result = useBeforeAll(async () =>
        run({
          args: `--wish ${scene.wish} --env test --plan --mode plan`,
          cwd: scene.dir,
        }),
      );

      then('it belays and names --plan, NOT the eaten --mode', () => {
        expect(result.exitCode).toBe(2);
        expect(result.stdout).toContain('absent value for --plan');
        expect(result.stdout).not.toContain('absent required arg: --mode');
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

  // the vision's edge-case table declares this path outright: "ambient session absent,
  // --auth via-ambient | PROCEEDS — the declaration is the assertion. the identity block
  // renders empty, so the operator sees the gap". every other case injects one credential
  // stub, so the `(none detected)` arm had NO coverage — a declared behavior, and a live
  // branch, that no test reached. `creds: {}` is the only way in.
  given(
    '[case8] via-ambient is declared but the shell holds no credentials',
    () => {
      when('[t0] the env is scrubbed of every credential variable', () => {
        const result = useBeforeAll(async () =>
          run(
            {
              args: `--wish ${scene.wish} --env test --mode plan --auth via-ambient`,
              cwd: scene.dir,
            },
            { creds: {} },
          ),
        );

        then(
          'the identity block reports the gap rather than an empty nest',
          () => {
            expect(result.stdout).toContain('identity');
            expect(result.stdout).toContain('(none detected)');
          },
        );

        then('it does NOT belay — the declaration is the assertion', () => {
          // via-ambient asserts naught: any presence check here would re-import the
          // provider sniff this wish exists to remove
          // (rule.forbid.declastruct-provider-assumptions). the run proceeds to
          // declastruct, which fails on its own provider's terms, never ours.
          expect(result.stdout).not.toContain('belay that');
          expect(result.stdout).not.toContain('absent credentials');
        });

        // the `(none detected)` line is a NEW caller-faced state this route introduces,
        // and an operator reads it at exactly the moment their run is about to fail. it
        // earns a visual vibecheck like every other output in this suite.
        then('the header block matches snapshot (visual vibecheck)', () => {
          expect(
            withHeaderOnly({
              stdout: withStablePaths({ stdout: result.stdout, ...scene }),
            }),
          ).toMatchSnapshot();
        });
      });
    },
  );

  given(
    '[case9] the shell holds the standard aws static-credential triple',
    () => {
      // the case every other case in this suite skipped, and the gap carried real weight.
      // each prior case supplies only the AWS_PROFILE stub, so THREE behaviors of the
      // identity block went unexercised:
      //   1. the SECRET-MASK arm — a non-*_PROFILE var must render `(set)`, never a value.
      //      A3 in the vision justifies a snapshot of the block on the ground that no secret
      //      leaks; that ground had zero test behind it
      //   2. the MULTI-LINE nest — with one entry the loop always closes on the first pass,
      //      so the ├─/└─ branch logic never ran with a real ├─ in it
      //   3. the SCAN PATTERN itself — `AWS_ACCESS_KEY_ID` ends in `_ID`, not `_KEY`, so it
      //      was silently dropped by a `_KEY$` match. a shell with the usual triple reported
      //      two of three: a PARTIAL identity, in the exact case (a CI prod apply on OIDC
      //      creds) the wish targets. this case is the clamp on that repair
      when(
        '[t0] via-ambient is declared with all three aws static keys',
        () => {
          const result = useBeforeAll(async () =>
            run(
              {
                args: `--wish ${scene.wish} --env test --mode plan --auth via-ambient`,
                cwd: scene.dir,
              },
              {
                creds: {
                  AWS_ACCESS_KEY_ID: 'AKIAEXAMPLEKEYID000',
                  AWS_SECRET_ACCESS_KEY: 'super-secret-value-never-print-me',
                  AWS_SESSION_TOKEN: 'session-token-value-never-print-me',
                },
              },
            ),
          );

          then('ALL THREE are reported — never a partial identity', () => {
            // the regression clamp on the `_KEY_ID` repair: under the prior `_KEY$` pattern
            // AWS_ACCESS_KEY_ID was absent here, so this assertion goes red if it returns.
            expect(result.stdout).toContain('AWS_ACCESS_KEY_ID');
            expect(result.stdout).toContain('AWS_SECRET_ACCESS_KEY');
            expect(result.stdout).toContain('AWS_SESSION_TOKEN');
          });

          then(
            'every one is masked as (set) — no secret VALUE reaches stdout',
            () => {
              // the guarantee A3 rests on, finally under test. none of these is a *_PROFILE,
              // so all three take the mask arm.
              expect(result.stdout).not.toContain('AKIAEXAMPLEKEYID000');
              expect(result.stdout).not.toContain(
                'super-secret-value-never-print-me',
              );
              expect(result.stdout).not.toContain(
                'session-token-value-never-print-me',
              );
              expect(result.stdout).toContain('AWS_ACCESS_KEY_ID = (set)');
            },
          );

          then('the nest opens with ├─ and closes with └─', () => {
            // with 3 entries the branch logic finally runs both arms: the first two are ├─
            // and only the last is └─. a nest that never closes reads as truncated output
            // (rule.require.treestruct-output).
            expect(result.stdout).toContain('│  ├─ AWS_ACCESS_KEY_ID');
            expect(result.stdout).toContain('│  └─ AWS_SESSION_TOKEN');
            // sorted, so SECRET_ACCESS_KEY is the middle one — a ├─, never the closer
            expect(result.stdout).toContain('│  ├─ AWS_SECRET_ACCESS_KEY');
          });

          then('the header block matches snapshot (visual vibecheck)', () => {
            expect(
              withHeaderOnly({
                stdout: withStablePaths({ stdout: result.stdout, ...scene }),
              }),
            ).toMatchSnapshot();
          });
        },
      );
    },
  );
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
 * .note = the run DECLARES `--auth via-ambient`, so the skill never touches keyrack. that
 *         declaration is the caller's own — it is not a sniff on an ambient variable, and
 *         it is exactly how a CI caller on OIDC creds now spells its intent. the env is
 *         also scrubbed of credential variables and given one stub, so the identity block
 *         is deterministic across hosts (a developer's own AWS_PROFILE would otherwise
 *         land in the snapshot). the empty wish declares no providers, so no credential
 *         is exercised regardless.
 */
describe('provision.declastruct (live plan forward-contract)', () => {
  // the repo root — `npx declastruct` resolves its pinned local binary from here, so the
  // skill runs from this cwd (the wish itself lives at an absolute temp path, so its
  // <wish>.plan.json lands in the temp dir, not the repo).
  const REPO_ROOT = join(__dirname, '../../../..');

  // mask the non-deterministic bits so a FULL success stdout is snapable (mirrors
  // provision.database.integration.test.ts). the per-run temp dir name carries a
  // timestamp + hash, and it appears in THREE forms: the skill echoes the absolute
  // path the test passed; declastruct (run from REPO_ROOT) echoes the SAME dir
  // repo-relative (`.temp/genTempDir.symlink/<ts>.<hash>/…`); and a symlinked tmp may
  // point at a realpath. mask all three (wish before dir, so `<WISH>` wins over
  // `<DIR>/resources.ts`), plus any spinner cursor-control codes. all else — the
  // 🐈/⛵ frame + the forwarded declastruct body — is deterministic for a
  // provider-less, resource-less wish.
  //
  // shared by the plan and the apply scenes, so the a/b/c snapshots differ only where
  // the RUNS differ, never where two hand-rolled masks drifted apart.
  const maskLiveRunStdout = (input: {
    stdout: string;
    dir: string;
  }): string => {
    const { stdout, dir } = input;
    const realDir = realpathSync(dir);
    const relDir = dir.startsWith(`${REPO_ROOT}/`)
      ? dir.slice(REPO_ROOT.length + 1)
      : dir;
    return (
      [dir, realDir, relDir]
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
        // is deterministic across environments — the skill's own frame (all we own) is
        // unchanged; only this pass-through line varies by host.
        .replace(
          /(?:pnpm dlx|npx|yarn dlx) declastruct apply/g,
          'declastruct apply',
        )
    );
  };

  // one run, parameterized by env, so every env variant is proven by the SAME path rather
  // than by a second hand-rolled fixture that could drift from this one.
  const getOneLivePlanScene = async (input: {
    env: string;
    slug: string;
  }): Promise<{
    dir: string;
    wish: string;
    planFile: string;
    stdout: string;
    stdoutMasked: string;
    stderr: string;
    exitCode: number | null;
  }> => {
    // an empty wish at an absolute temp path: no providers, no resources → declastruct
    // has naught to reconcile, so plan runs to completion with no aws call and writes an
    // empty plan file beside the temp wish.
    const dir = genTempDir({ slug: input.slug });
    const wish = join(dir, 'resources.ts');
    writeFileSync(
      wish,
      [
        'export const getProviders = async () => [];',
        'export const getResources = async () => [];',
        '',
      ].join('\n'),
    );

    // scrub every credential variable, then supply exactly one stub, so the identity
    // block the skill prints is identical on a laptop and a runner. `--auth via-ambient`
    // below declares this shell as the source, so keyrack is never touched (no sso
    // prompt); the empty wish declares no providers, so no credential is exercised.
    const envScrubbed = Object.fromEntries(
      Object.entries(process.env).filter(
        ([name]) => !CRED_VAR_PATTERN.test(name),
      ),
    ) as Record<string, string>;
    const env: Record<string, string> = {
      ...envScrubbed,
      AWS_PROFILE: 'test-stub-profile',
    };
    const skill = `${__dirname}/provision.declastruct.sh`;
    const result = spawnSync(
      'bash',
      [
        '-c',
        `bash "${skill}" --wish "${wish}" --env ${input.env} --mode plan --auth via-ambient`,
      ],
      { encoding: 'utf-8', cwd: REPO_ROOT, env },
    );
    const stdout = result.stdout ?? '';
    const stdoutMasked = maskLiveRunStdout({ stdout, dir });
    return {
      dir,
      wish,
      planFile: `${wish}.plan.json`,
      stdout,
      stdoutMasked,
      stderr: result.stderr ?? '',
      exitCode: result.status,
    };
  };

  // the apply half of the round trip. it deliberately reuses a scene the plan operation
  // already built, because that is the ONLY honest way to reach a positive apply: apply
  // reads the `<wish>.plan.json` a prior plan wrote, so an apply proven against a
  // hand-placed fixture file would prove the read, never the handoff between the two modes.
  const getOneLiveApplyScene = async (input: {
    scene: { dir: string; wish: string };
  }): Promise<{
    stdout: string;
    stdoutMasked: string;
    exitCode: number | null;
  }> => {
    const { dir, wish } = input.scene;
    const envScrubbed = Object.fromEntries(
      Object.entries(process.env).filter(
        ([name]) => !CRED_VAR_PATTERN.test(name),
      ),
    ) as Record<string, string>;
    const env: Record<string, string> = {
      ...envScrubbed,
      AWS_PROFILE: 'test-stub-profile',
    };
    const skill = `${__dirname}/provision.declastruct.sh`;
    const result = spawnSync(
      'bash',
      [
        '-c',
        `bash "${skill}" --wish "${wish}" --env test --mode apply --auth via-ambient`,
      ],
      { encoding: 'utf-8', cwd: REPO_ROOT, env },
    );
    const stdout = result.stdout ?? '';
    return {
      stdout,
      stdoutMasked: maskLiveRunStdout({ stdout, dir }),
      exitCode: result.status,
    };
  };

  const scene = useBeforeAll(async () =>
    getOneLivePlanScene({
      env: 'test',
      slug: 'provision-declastruct-live-plan',
    }),
  );

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

  // camp is the env the reported incident used, and the env this route ADDED to the enum.
  // every other camp clamp in this repo is a NEGATIVE one — the boundary suite proves camp
  // never belays as an invalid env, and proves the prod gate stays silent. neither shows a
  // camp caller what a SUCCESS looks like, so the widened enum shipped with no positive
  // render at all: a regression that broke camp alone (a bad STAGE export, a mangled
  // header) would leave every extant clamp green.
  //
  // it runs the SAME parameterized path as [case1], so the pair is a true a/b: the only
  // input that differs is --env, and the snapshots can be diffed against each other.
  given('[case1b] the same plan runs with --env camp', () => {
    const sceneCamp = useBeforeAll(async () =>
      getOneLivePlanScene({
        env: 'camp',
        slug: 'provision-declastruct-live-plan-camp',
      }),
    );

    when('[t0] --mode plan is invoked with the widened env', () => {
      then('it completes (exit 0), exactly as --env test does', () => {
        expect(sceneCamp.exitCode).toBe(0);
      });

      then('the header names camp as the env it ran under', () => {
        // the value-assert that gives the snapshot below its teeth: a resnap can never
        // launder a camp run that silently reported some other env.
        expect(sceneCamp.stdout).toContain('env: camp');
      });

      then(
        'the FULL plan-success stdout matches snapshot (temp paths masked)',
        () => {
          // the positive camp render the reviewer found absent. guarded the same way
          // [case1] is — the forwarded marker and the footer must be present in the masked
          // text before it is snapped, so the snapshot can never stand alone.
          expect(sceneCamp.stdoutMasked).toContain('in sync');
          expect(sceneCamp.stdoutMasked).toContain(
            'planned → <WISH>.plan.json',
          );
          expect(sceneCamp.stdoutMasked).toMatchSnapshot();
        },
      );
    });
  });

  // the OTHER half of the --mode enum. every apply clamp in this repo was a negative one
  // ([case7]: apply with no prior plan → `plan not found`), so a caller who runs the mode
  // this skill exists to perform had no render of what success looks like — and a
  // regression in the apply footer, the forwarded declastruct body, or the plan handoff
  // would have left every extant clamp green.
  //
  // it runs against [case1]'s OWN dir, after [case1] planned into it, so what is proven is
  // the round trip: plan writes `<wish>.plan.json`, apply reads that exact file back. an
  // apply against a hand-placed plan file would have proven strictly less.
  given('[case1c] the plan [case1] wrote is then applied', () => {
    const sceneApply = useBeforeAll(async () =>
      getOneLiveApplyScene({ scene }),
    );

    when('[t0] --mode apply is invoked against the extant plan', () => {
      then('it completes (exit 0) — a real declastruct apply ran', () => {
        expect(sceneApply.exitCode).toBe(0);
      });

      then(
        'the skill frames the run with its ⛵ APPLY header, not plan',
        () => {
          // the value-assert that gives the snapshot teeth: an apply that silently ran the
          // plan path would still exit 0 and still look plausible in a resnap.
          expect(sceneApply.stdout).toContain('mode: apply');
          expect(sceneApply.stdout).toContain('apply reviewed plan...');
          expect(sceneApply.stdout).not.toContain('plan infra changes...');
        },
      );

      then(
        'the FULL apply-success stdout matches snapshot (temp paths masked)',
        () => {
          // guarded the same way [case1] and [case1b] are — a marker must be present in
          // the masked text before it is snapped, so the snapshot never stands alone.
          expect(sceneApply.stdoutMasked).toContain('mode: apply');
          expect(sceneApply.stdoutMasked).toMatchSnapshot();
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

      // scrubbed + stubbed exactly like [case1], and `--auth via-ambient` declared on the
      // invocation. this case USED to carry `AWS_ACCESS_KEY_ID: 'test-skip-keyrack'` and no
      // --auth at all — a leftover of the RETIRED sniff, whose whole premise was that an
      // ambient static key made the skill skip keyrack. that premise died with this route:
      // the skill no longer reads AWS_ACCESS_KEY_ID to decide a thing, so the stale var
      // bought naught and the case silently took the DEFAULT via-keyrack path — a real
      // `rhx keyrack unlock` on every run, which happened to pass locally (the jest env
      // pre-sources creds) and would behave differently under CI. that is the exact hidden
      // environment-coupled shape this suite was rebuilt to retire, alive in the one case
      // the rewrite missed.
      const envScrubbed = Object.fromEntries(
        Object.entries(process.env).filter(
          ([name]) => !CRED_VAR_PATTERN.test(name),
        ),
      ) as Record<string, string>;
      const env: Record<string, string> = { ...envScrubbed, ...CRED_STUB };
      const skill = `${__dirname}/provision.declastruct.sh`;
      const result = spawnSync(
        'bash',
        [
          '-c',
          `bash "${skill}" --wish "${wish}" --env test --mode plan --plan "${planCustom}" --auth via-ambient`,
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

/**
 * .what = proof for the --auth via-keyrack credential path — the DEFAULT path
 * .why = via-keyrack is what a caller gets when they pass no --auth at all, and it holds
 *        the whole repair this route exists for: the `source`+`eval` that finally lands
 *        keyrack's keys in THIS process, the unset of a rival ambient credential, and the
 *        absent-credentials belay. every other case in this file declares via-ambient
 *        precisely so it never prompts sso — which left the default path unproven.
 *
 * .mock = the `rhx keyrack` cli, via a PATH shim
 * .why  = `rhx keyrack unlock` drives an aws sso handshake that opens a BROWSER and waits
 *         on a human. there is no non-interactive sandbox for it, and a ci runner holds no
 *         `~/.rhachet` at all — so a real unlock cannot run here under any credential. this
 *         is the `no sandbox available` exception rule.forbid.integration.mocks names, and
 *         it is scoped as narrowly as the boundary allows: only the `rhx` binary is shimmed,
 *         only for these two cases. the skill itself, bash, and the arg parse are all real.
 * .real = the live keyrack path is exercised for real by 5.3.verification, which drives a
 *         no-self-source wish at `--env test` after `rhx keyrack unlock --owner ehmpath
 *         --env test`. that run is the credential proof; these cases are the LOGIC proof —
 *         what the skill does with whatever keyrack hands back.
 */
describe('provision.declastruct (via-keyrack credential supply)', () => {
  /**
   * .what = run the skill with `rhx` shimmed to hand back the given export block
   * .why  = lets each case declare exactly what keyrack yields — a real block, or the
   *         empty block that `--lenient` produces for an env with no keys — and then
   *         assert what the skill does with it.
   */
  const runViaKeyrack = (input: {
    args: string;
    cwd: string;
    keyrackExports: string;
    ambient: Record<string, string>;
  }): { stdout: string; stderr: string; exitCode: number } => {
    // the shim: answers `unlock` with a clean exit and `source` with the declared block.
    // any other keyrack verb fails loud, so a future call site cannot pass unnoticed.
    // .note = `set -e`, deliberately NOT `set -eu`. bare $1/$2 (rather than "${1:-}")
    //         keeps every line free of a `${…}` that biome would read as a stray js
    //         template placeholder; with -u dropped, an argless call expands them empty
    //         and lands on the loud branch below, which is the same outcome.
    const shimDir = genTempDir({ slug: 'provision-declastruct-keyrack-shim' });
    const shim = join(shimDir, 'rhx');
    writeFileSync(
      shim,
      [
        '#!/usr/bin/env bash',
        'set -eo pipefail',
        '[[ "$1" == "keyrack" ]] || { echo "shim: unexpected rhx call: $*" >&2; exit 1; }',
        'case "$2" in',
        '  unlock) exit 0 ;;',
        "  source) cat <<'KEYRACK_SHIM_EOF'",
        input.keyrackExports,
        'KEYRACK_SHIM_EOF',
        '    exit 0 ;;',
        '  *) echo "shim: unexpected keyrack verb: $2" >&2; exit 1 ;;',
        'esac',
        '',
      ].join('\n'),
      { mode: 0o755 },
    );

    // scrub every credential variable, then supply exactly the ambient set this case
    // declares — so a developer's own AWS_PROFILE can never satisfy (or pollute) the run.
    const envScrubbed = Object.fromEntries(
      Object.entries(process.env).filter(
        ([name]) => !CRED_VAR_PATTERN.test(name),
      ),
    ) as Record<string, string>;
    const env: Record<string, string> = {
      ...envScrubbed,
      ...input.ambient,
      PATH: `${shimDir}:${process.env.PATH}`,
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

  const scene = useBeforeAll(async () => {
    const dir = genTempDir({ slug: 'provision-declastruct-keyrack' });
    const wish = join(dir, 'resources.ts');
    writeFileSync(wish, 'export const resources = [];\n');
    return { dir, wish };
  });

  given('[case1] keyrack holds keys for the env', () => {
    // the incident's exact shape, inverted: a rival ambient static key is present, and
    // keyrack supplies a profile. before this route the unlock ran in a subprocess and
    // its export died with the child, so the rival won. now keyrack's block is sourced
    // into THIS process and the rival is cleared first.
    when('[t0] --auth is omitted, so via-keyrack is the default', () => {
      const result = useBeforeAll(async () =>
        runViaKeyrack({
          args: `--wish ${scene.wish} --env test --mode plan`,
          cwd: scene.dir,
          keyrackExports: "export AWS_PROFILE='keyrack-supplied-profile'",
          ambient: { AWS_ACCESS_KEY_ID: 'rival-ambient-key' },
        }),
      );

      then('the header reports via-keyrack though no --auth was passed', () => {
        expect(result.stdout).toContain('auth: via-keyrack');
      });

      then('keyrack’s own profile reached this process', () => {
        // the whole repair in one assertion: the VALUE is keyrack's, which is only
        // possible if the source block was evaled into the skill's own shell.
        expect(result.stdout).toContain(
          'AWS_PROFILE = keyrack-supplied-profile',
        );
      });

      then('the rival ambient static key was cleared, not reported', () => {
        // if the unset were dropped (or ordered after the eval), this line would appear
        // and the run would carry two rival aws credential channels.
        //
        // .note = this assertion was VACUOUS until the `_KEY_ID` scan repair. under the
        //         prior `_KEY$` pattern AWS_ACCESS_KEY_ID could never appear in the
        //         identity block at all, so the check passed whether or not the unset
        //         ran — a failhide in the very clamp meant to guard it
        //         (rule.forbid.failhide). `[case9]` is the positive control that keeps it
        //         honest: it proves the scan DOES report AWS_ACCESS_KEY_ID when present,
        //         so its absence here is real evidence rather than an artifact.
        expect(result.stdout).not.toContain('AWS_ACCESS_KEY_ID');
      });

      then('it does NOT belay — the declaration was honored', () => {
        expect(result.stdout).not.toContain('absent credentials');
      });

      then('the header block matches snapshot (visual vibecheck)', () => {
        expect(
          withHeaderOnly({
            stdout: withStablePaths({ stdout: result.stdout, ...scene }),
          }),
        ).toMatchSnapshot();
      });
    });
  });

  given('[case2] keyrack holds no keys for the env', () => {
    // `--lenient` makes an env with no keys a SILENT no-op, so the count of what arrived
    // is the only real guard. this is the friction point an operator hits first.
    when('[t0] the source block comes back empty', () => {
      const result = useBeforeAll(async () =>
        runViaKeyrack({
          args: `--wish ${scene.wish} --env test --mode plan`,
          cwd: scene.dir,
          keyrackExports: '',
          ambient: {},
        }),
      );

      then('it belays with exit 2 that names the absent credentials', () => {
        expect(result.exitCode).toBe(2);
        expect(result.stderr).toContain('absent credentials');
        expect(result.stderr).toContain('env=test');
      });

      then('the belay names BOTH fixes, not just the symptom', () => {
        expect(result.stderr).toContain('rhx keyrack fill');
        expect(result.stderr).toContain('--auth via-ambient');
      });

      then('it belays BEFORE the handoff — no header, no declastruct', () => {
        // a pre-header belay, so the ⛵ tree is never left half-drawn, and no provider
        // call is made under a credential the caller never got.
        expect(result.stdout).not.toContain('chartin course');
        expect(result.stdout).not.toContain('plan infra changes');
      });

      then('the belay stderr matches snapshot (visual vibecheck)', () => {
        expect(
          withStablePaths({ stdout: result.stderr, ...scene }),
        ).toMatchSnapshot();
      });
    });
  });
});
