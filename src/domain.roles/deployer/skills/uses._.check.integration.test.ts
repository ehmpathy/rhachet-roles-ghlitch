import { genTempDir, given, then, useBeforeAll, when } from 'test-fns';

import { DEPLOYER_FIXTURE, runDeployerSkill } from './.test/runDeployerSkill';

/**
 * .what = direct render clamps for every decision `uses._.check.sh` can reach
 * .why  = this gate is the child every deployer composer buckets, so its renders were
 *         only ever observed THROUGH a composer's frame. that indirection hid a defect
 *         for the life of the skill: `allowed:local:infinite` exited 0 in SILENCE while
 *         its two sibling authorization paths reported, so a prod write was permitted
 *         with no line in the log to say why (rule.require.status-feedback). the empty
 *         sub.bucket a composer drew around that silence is what finally surfaced it.
 *
 *         a direct clamp on every arm is what stops the class from recurring: the
 *         negative control below walks the whole decision matrix and asserts that no
 *         authorization path reaches exit 0 without a word.
 *
 * .note = this gate writes its renders to STDERR by design, so a caller that captures
 *         stdout (to grep a forwarded schema payload) is never polluted. once bucketed
 *         by a composer, `run_sub_bucket` reads it as `2>&1` and the SAME text arrives on
 *         the composer's stdout. both directions are pinned — here on stderr, and in
 *         each composer suite on stdout — so the stream change is a stated contract
 *         rather than whichever stream a test happened to read.
 */

const setupRepo = (input: { slug: string; orgless?: boolean }): string =>
  genTempDir({
    slug: input.slug,
    git: true,
    symlink: [
      { at: 'node_modules', to: 'node_modules' },
      {
        at: '.agent/keyrack.yml',
        to: input.orgless
          ? `${DEPLOYER_FIXTURE}/keyrack.no-org.yml`
          : `${DEPLOYER_FIXTURE}/keyrack.yml`,
      },
      { at: 'package.json', to: `${DEPLOYER_FIXTURE}/package.json` },
    ],
  });

const runCheck = (
  input: { args: string; cwd: string },
  options?: { env?: Record<string, string> },
) =>
  runDeployerSkill(
    { skill: 'uses._.check.sh', args: input.args, cwd: input.cwd },
    options,
  );

const grant = (input: { meter: string; args: string; cwd: string }) =>
  runDeployerSkill({
    skill: `${input.meter}.sh`,
    args: input.args,
    cwd: input.cwd,
  });

describe('uses.check (gate decision renders)', () => {
  given(
    '[case1] a prod write is authorized by an unlimited local grant',
    () => {
      // THE path that used to be silent. clamped directly, on BOTH meters, because each
      // renders its own meter name in the header line.
      const scene = useBeforeAll(async () => {
        const dir = setupRepo({ slug: 'check-infinite' });
        grant({ meter: 'deploy.uses', args: 'allow --env prod', cwd: dir });
        grant({ meter: 'provision.uses', args: 'allow --env prod', cwd: dir });
        return {
          deploy: runCheck({
            args: '--meter deploy.uses --env prod',
            cwd: dir,
          }),
          provision: runCheck({
            args: '--meter provision.uses --env prod',
            cwd: dir,
          }),
        };
      });

      when('[t0] the gate is checked for deploy.uses', () => {
        then('it exits 0', () => {
          expect(scene.deploy.exitCode).toBe(0);
        });

        then('it SPEAKS — a prod write is never authorized in silence', () => {
          // the regression clamp. an exit 0 with empty output is the exact defect this
          // case exists to catch, and it is invisible to any assertion that only checks
          // the code.
          expect(scene.deploy.stderr.trim()).not.toEqual('');
        });

        then('the render matches snapshot on STDERR (visual vibecheck)', () => {
          expect(scene.deploy.stderr).toMatchSnapshot();
        });

        then(
          'stdout stays clean, so a forwarded payload is never polluted',
          () => {
            expect(scene.deploy.stdout).toEqual('');
          },
        );
      });

      when('[t1] the gate is checked for provision.uses', () => {
        then('it exits 0 and speaks with ITS own meter name', () => {
          expect(scene.provision.exitCode).toBe(0);
          expect(scene.provision.stderr).toContain(
            '🦺 provision.uses --env prod',
          );
        });

        then('the render matches snapshot on STDERR (visual vibecheck)', () => {
          expect(scene.provision.stderr).toMatchSnapshot();
        });
      });
    },
  );

  given('[case2] a prod write is authorized by a quota grant', () => {
    const scene = useBeforeAll(async () => {
      const dir = setupRepo({ slug: 'check-quota' });
      grant({
        meter: 'deploy.uses',
        args: 'set --quant 2 --env prod',
        cwd: dir,
      });
      const first = runCheck({
        args: '--meter deploy.uses --env prod',
        cwd: dir,
      });
      const second = runCheck({
        args: '--meter deploy.uses --env prod',
        cwd: dir,
      });
      const third = runCheck({
        args: '--meter deploy.uses --env prod',
        cwd: dir,
      });
      return { first, second, third };
    });

    when('[t0] the first use is consumed', () => {
      then('it exits 0 and reports what is left', () => {
        expect(scene.first.exitCode).toBe(0);
        expect(scene.first.stderr).toMatchSnapshot();
      });
    });

    when('[t1] the last use is consumed', () => {
      then('it exits 0 and reports the auto re-lock', () => {
        // the quota's own safety property: a grant that hits zero revokes itself, so a
        // human who granted one use cannot be spent twice.
        expect(scene.second.exitCode).toBe(0);
        expect(scene.second.stderr).toMatchSnapshot();
      });
    });

    when('[t2] a use is attempted after the grant is spent', () => {
      then('it is blocked (exit 2)', () => {
        expect(scene.third.exitCode).toBe(2);
      });

      then('the blocked render matches snapshot (visual vibecheck)', () => {
        expect(scene.third.stderr).toMatchSnapshot();
      });
    });
  });

  given('[case3] a prod write is blocked', () => {
    const scene = useBeforeAll(async () => {
      const unset = setupRepo({ slug: 'check-blocked-unset' });
      const frozen = setupRepo({ slug: 'check-blocked-global' });
      grant({ meter: 'deploy.uses', args: 'allow --env prod', cwd: frozen });
      grant({ meter: 'deploy.uses', args: 'block --global', cwd: frozen });
      return {
        unset: runCheck({
          args: '--meter deploy.uses --env prod',
          cwd: unset,
        }),
        frozen: runCheck({
          args: '--meter deploy.uses --env prod',
          cwd: frozen,
        }),
      };
    });

    when('[t0] no grant exists at all', () => {
      then('it is blocked by the safe default (exit 2)', () => {
        expect(scene.unset.exitCode).toBe(2);
      });

      then('the render names the grant command, not just the block', () => {
        // rule.require.errors-name-the-fix — a caller blocked at the gate needs the
        // exact command their human must run, not a note that they are blocked.
        expect(scene.unset.stderr).toMatchSnapshot();
      });
    });

    when('[t1] a global freeze overrides a live local grant', () => {
      then('the freeze wins (exit 2)', () => {
        // precedence, proven rather than assumed: the local grant is live and the freeze
        // still blocks. a global freeze that a local allow could out-vote would be a
        // freeze in name only.
        expect(scene.frozen.exitCode).toBe(2);
      });

      then(
        'the render names the freeze specifically, and how to lift it',
        () => {
          expect(scene.frozen.stderr).toMatchSnapshot();
        },
      );
    });
  });

  given('[case4] the cicd gate defers prod authorization to github', () => {
    const scene = useBeforeAll(async () => {
      const dir = setupRepo({ slug: 'check-cicd' });
      return {
        inCi: runCheck(
          {
            args: '--meter provision.uses --env prod --gate for-cicd',
            cwd: dir,
          },
          { env: { CI: 'true' } },
        ),
        outsideCi: runCheck(
          {
            args: '--meter provision.uses --env prod --gate for-cicd',
            cwd: dir,
          },
          { env: { CI: '' } },
        ),
      };
    });

    when('[t0] --gate for-cicd is used inside CI', () => {
      then('it exits 0 and says WHY prod was permitted', () => {
        expect(scene.inCi.exitCode).toBe(0);
        expect(scene.inCi.stderr).toMatchSnapshot();
      });

      then('the local meter is never consulted — no grant exists here', () => {
        // the CI runner has no ~/.rhachet storage, so the github environment is the sole
        // prod authority there. this repo holds no grant at all, and the run still
        // clears — which is the whole point of the flag.
        expect(scene.inCi.stderr).not.toContain('prod is locked');
      });
    });

    when('[t1] --gate for-cicd is used OUTSIDE CI', () => {
      then('it is blocked (exit 2) — the flag alone can never bypass', () => {
        // the flag is the opt-in; the ambient CI marker is the proof. a local shell that
        // passes it by mistake must not skip the meter.
        expect(scene.outsideCi.exitCode).toBe(2);
      });

      then('the belay render matches snapshot (visual vibecheck)', () => {
        expect(scene.outsideCi.stderr).toMatchSnapshot();
      });
    });
  });

  given('[case5] a non-prod env is never gated', () => {
    const scene = useBeforeAll(async () => {
      const dir = setupRepo({ slug: 'check-nonprod' });
      return {
        prep: runCheck({ args: '--meter deploy.uses --env prep', cwd: dir }),
        test: runCheck({ args: '--meter deploy.uses --env test', cwd: dir }),
      };
    });

    when('[t0] the gate is checked for a non-prod env', () => {
      then('it exits 0 with no grant of any kind', () => {
        expect(scene.prep.exitCode).toBe(0);
        expect(scene.test.exitCode).toBe(0);
      });

      then(
        'it is SILENT by design — and never bucketed, so no empty frame',
        () => {
          // the one authorization arm that legitimately says no word. it is not an
          // exception to rule.require.status-feedback: no composer calls this gate for a
          // non-prod env at all, so this silence can never render as an empty sub.bucket.
          // pinned explicitly so a future reader does not "fix" it into a line that would
          // then need a frame it never gets.
          expect(scene.prep.stdout + scene.prep.stderr).toEqual('');
          expect(scene.test.stdout + scene.test.stderr).toEqual('');
        },
      );
    });
  });

  given('[case6] argument constraints belay by NAME, never by symptom', () => {
    const scene = useBeforeAll(async () => {
      const dir = setupRepo({ slug: 'check-arg-constraints' });
      return {
        absentBoth: runCheck({ args: '', cwd: dir }),
        meterBare: runCheck({ args: '--meter', cwd: dir }),
        envBare: runCheck({ args: '--meter deploy.uses --env', cwd: dir }),
        gateBare: runCheck({
          args: '--meter deploy.uses --env prod --gate',
          cwd: dir,
        }),
        gateEatsFlag: runCheck({
          args: '--meter deploy.uses --gate --env prod',
          cwd: dir,
        }),
        gateInvalid: runCheck({
          args: '--meter deploy.uses --env prod --gate for-robots',
          cwd: dir,
        }),
        retiredAuth: runCheck({
          args: '--meter deploy.uses --env prod --auth as-cicd',
          cwd: dir,
        }),
        unknownFlag: runCheck({
          args: '--meter deploy.uses --env prod --grate for-cicd',
          cwd: dir,
        }),
      };
    });

    when('[t0] both required args are absent', () => {
      then('it is a constraint error (exit 2) and matches snapshot', () => {
        expect(scene.absentBoth.exitCode).toBe(2);
        expect(scene.absentBoth.stderr).toMatchSnapshot();
      });
    });

    when('[t1] --meter is the last token, with no value', () => {
      then('it belays by name, never a set -u crash', () => {
        expect(scene.meterBare.exitCode).toBe(2);
        expect(scene.meterBare.stderr).not.toContain('unbound variable');
        expect(scene.meterBare.stderr).toMatchSnapshot();
      });
    });

    when('[t2] --env is the last token, with no value', () => {
      then('it belays by name and matches snapshot', () => {
        expect(scene.envBare.exitCode).toBe(2);
        expect(scene.envBare.stderr).toMatchSnapshot();
      });
    });

    when('[t3] --gate is the last token, with no value', () => {
      then('it names the CAUSE and the valid set, not just the symptom', () => {
        // the belay it used to fall through to said `invalid gate: ` — a symptom with a
        // blank where the cause belonged.
        expect(scene.gateBare.exitCode).toBe(2);
        expect(scene.gateBare.stderr).toContain('absent value for --gate');
        expect(scene.gateBare.stderr).toMatchSnapshot();
      });
    });

    when('[t4] --gate EATS the next flag as its value', () => {
      then('it belays about --gate, never about the flag it ate', () => {
        expect(scene.gateEatsFlag.exitCode).toBe(2);
        expect(scene.gateEatsFlag.stderr).toContain('absent value for --gate');
        expect(scene.gateEatsFlag.stderr).toMatchSnapshot();
      });
    });

    when('[t5] --gate carries a value outside the set', () => {
      then('it is rejected loud, never ignored (exit 2)', () => {
        // an ignored gate value falls back to the local meter, which could read as an
        // opt into the cicd gate when it was not — a prod-write authorization decision
        // made by a typo.
        expect(scene.gateInvalid.exitCode).toBe(2);
        expect(scene.gateInvalid.stderr).toMatchSnapshot();
      });
    });

    when('[t6] the retired --auth flag is passed', () => {
      then('it is caught by NAME and given the migration', () => {
        // the `*)` arm would otherwise discard it silently, and the caller would read
        // "prod is locked" with no clue their flag was dropped (rule.forbid.failhide).
        expect(scene.retiredAuth.exitCode).toBe(2);
        expect(scene.retiredAuth.stderr).toMatchSnapshot();
      });
    });

    when('[t7] an unknown flag is passed', () => {
      then('the whole class is closed, not one flag at a time', () => {
        expect(scene.unknownFlag.exitCode).toBe(2);
        expect(scene.unknownFlag.stderr).toMatchSnapshot();
      });
    });
  });

  given('[case7] an org policy exists but the repo org cannot be read', () => {
    // a misread here would quietly bypass an org freeze. fail loud rather than guess.
    const scene = useBeforeAll(async () => {
      const seed = setupRepo({ slug: 'check-org-seed' });
      // write an org policy into the isolated HOME, then re-run the gate from a repo
      // whose keyrack manifest declares no org at all
      grant({
        meter: 'deploy.uses',
        args: 'block --org ehmpathy',
        cwd: seed,
      });
      const orgless = setupRepo({
        slug: 'check-org-unreadable',
        orgless: true,
      });
      return {
        orgFreeze: runCheck({
          args: '--meter deploy.uses --env prod',
          cwd: seed,
        }),
        // HOME is per-repo, so point the orgless repo at the seed's HOME to inherit its
        // org policy file while it keeps its own orgless manifest
        unreadable: runDeployerSkill(
          {
            skill: 'uses._.check.sh',
            args: '--meter deploy.uses --env prod',
            cwd: orgless,
          },
          { env: { HOME: seed } },
        ),
      };
    });

    when('[t0] an org freeze is in effect and the org IS readable', () => {
      then('it blocks (exit 2) and matches snapshot', () => {
        expect(scene.orgFreeze.exitCode).toBe(2);
        expect(scene.orgFreeze.stderr).toMatchSnapshot();
      });
    });

    when('[t1] the org policy is set but the repo org is unreadable', () => {
      then('it is a MALFUNCTION (exit 1), never a silent bypass', () => {
        // exit 1, not 2: the caller made no mistake, the system cannot answer. an exit 0
        // here would grant prod past an org freeze it could not read
        // (rule.require.exit-code-semantics, rule.forbid.failhide).
        expect(scene.unreadable.exitCode).toBe(1);
      });

      then('the render names what could not be read', () => {
        expect(scene.unreadable.stderr).toMatchSnapshot();
      });
    });
  });

  given('[case8] no authorization path reaches exit 0 in silence', () => {
    // the generalized form of the empty-bucket defect, asserted across the whole matrix
    // rather than one arm at a time. the non-prod bypass is the single sanctioned
    // silence, and it is excluded BY NAME so the exclusion stays visible.
    const scene = useBeforeAll(async () => {
      const dir = setupRepo({ slug: 'check-no-silent-grants' });
      grant({ meter: 'deploy.uses', args: 'allow --env prod', cwd: dir });
      grant({
        meter: 'provision.uses',
        args: 'set --quant 1 --env prod',
        cwd: dir,
      });
      const cicdDir = setupRepo({ slug: 'check-no-silent-cicd' });
      return {
        infinite: runCheck({
          args: '--meter deploy.uses --env prod',
          cwd: dir,
        }),
        quota: runCheck({
          args: '--meter provision.uses --env prod',
          cwd: dir,
        }),
        cicd: runCheck(
          {
            args: '--meter provision.uses --env prod --gate for-cicd',
            cwd: cicdDir,
          },
          { env: { CI: 'true' } },
        ),
      };
    });

    when('[t0] every prod-authorizing path is walked', () => {
      then('all three clear the gate', () => {
        expect(scene.infinite.exitCode).toBe(0);
        expect(scene.quota.exitCode).toBe(0);
        expect(scene.cicd.exitCode).toBe(0);
      });

      then('not one of them authorizes prod without a word', () => {
        // the asymmetry that hid the defect: two arms reported, one did not. a per-arm
        // assertion would have kept passing while the third stayed mute, so the
        // invariant is asserted over the SET.
        for (const out of [scene.infinite, scene.quota, scene.cicd])
          expect(out.stderr.trim()).not.toEqual('');
      });

      then('each states its own distinct reason, never a generic one', () => {
        // three different authorities cleared these three writes. a shared message would
        // leave an operator unable to tell a human grant from a github approval.
        expect(scene.infinite.stderr).toContain(
          'authorized via local unlimited grant',
        );
        expect(scene.quota.stderr).toContain('authorized via quota grant');
        expect(scene.cicd.stderr).toContain(
          'authorized via github-environment approval (CI)',
        );
      });

      then('each says it in the SAME SHAPE — a header, then one item', () => {
        // the prior clamp asked only that each arm say SOMETHING, so the quota arm
        // drifted to a bare `🐈 deploy.uses: prod use consumed (2 → 1 left)` — a mascot
        // with no tree, and no header to name the meter — while its two kin rendered a
        // proper artifact block. it passed every assertion above.
        //
        // five composers frame this gate in a sub.bucket, so an arm that breaks shape
        // breaks shape INSIDE that frame: one bucket holds a tree, the next holds a
        // sentence (rule.require.consistent-skill-contracts, at the render layer).
        for (const out of [scene.infinite, scene.quota, scene.cicd]) {
          const lines = out.stderr.split('\n').filter((line) => line !== '');
          expect(lines[0]).toMatch(/^🦺 (deploy|provision)\.uses --env prod/);
          expect(lines[1]).toMatch(/^ {3}└─ authorized via /);
          expect(lines).toHaveLength(2);
        }
      });

      then('not one of them renders a bare mascot', () => {
        for (const out of [scene.infinite, scene.quota, scene.cicd])
          expect(out.stderr).not.toContain('🐈');
      });
    });
  });
});
