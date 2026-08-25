import { genTempDir, given, then, useBeforeAll, when } from 'test-fns';

import { genStubBinPath, PATH_WITHOUT_RHX } from '../../.test/runRoleSkill';
import {
  DEPLOYER_FIXTURE,
  runDeployerSkill,
  sliceThroughGate,
} from './.test/runDeployerSkill';

/**
 * .what = render clamps for every critipath of the `deploy` contract
 * .why  = this skill had NO integration suite. its only two clamped renders lived in
 *         `uses.play` — the prod-gate frame, added when the gate was bucketed. its help,
 *         its four belays, and its non-prod header had never been observed by a test, so
 *         the header split this branch applied could have broken any of them unseen.
 */

const setupRepo = (input: { slug: string }): string =>
  genTempDir({
    slug: input.slug,
    git: true,
    symlink: [
      { at: 'node_modules', to: 'node_modules' },
      { at: '.agent/keyrack.yml', to: `${DEPLOYER_FIXTURE}/keyrack.yml` },
      { at: 'package.json', to: `${DEPLOYER_FIXTURE}/package.json` },
    ],
  });

const runDeploy = (input: { args: string; cwd: string }) =>
  runDeployerSkill(
    { skill: 'deploy.sh', args: input.args, cwd: input.cwd },
    { env: { PATH: PATH_WITHOUT_RHX } },
  );

/**
 * .what = assert a render that OPENS the header tree also CLOSES it
 * .why  = the gate now sits INSIDE the header tree, between the `├─ env` item and the
 *         `└─ eyes on target...` close. any exit taken between the two must close the
 *         tree on its way out, or it leaves items dangling under no close — the
 *         half-drawn shape `run_sub_bucket_or_belay` exists to prevent. a `toContain`
 *         cannot see an absent line, so the invariant is asserted directly.
 */
const expectHeaderTreeClosed = (out: string): void => {
  if (!out.includes('⛵ deploy --env')) return; // no tree opened
  expect(out).toMatch(/\n {3}└─ /);
};

describe('deploy (contract renders)', () => {
  given('[case1] help is requested', () => {
    const scene = useBeforeAll(async () => {
      const dir = setupRepo({ slug: 'deploy-help' });
      return {
        bare: runDeploy({ args: 'help', cwd: dir }),
        long: runDeploy({ args: '--help', cwd: dir }),
        short: runDeploy({ args: '-h', cwd: dir }),
        trailing: runDeploy({ args: '--env prep --help', cwd: dir }),
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

    when('[t1] the --help and -h aliases are used', () => {
      then('all three entrypoints render the identical help', () => {
        expect(scene.long.stdout).toEqual(scene.bare.stdout);
        expect(scene.short.stdout).toEqual(scene.bare.stdout);
      });
    });

    when('[t2] --help arrives AFTER other args', () => {
      then('the parse loop still reaches it and exits 0', () => {
        // rhx passes --skill/--repo/--role ahead of the caller's args, so a help flag
        // that is never first is the normal shape (rule.require.skill-help).
        expect(scene.trailing.exitCode).toBe(0);
        expect(scene.trailing.stdout).toEqual(scene.bare.stdout);
      });
    });
  });

  given('[case2] argument constraints belay before any work is done', () => {
    const scene = useBeforeAll(async () => {
      const dir = setupRepo({ slug: 'deploy-arg-constraints' });
      return {
        absentEnv: runDeploy({ args: '', cwd: dir }),
        invalidEnv: runDeploy({ args: '--env test', cwd: dir }),
        unknownArg: runDeploy({ args: '--env prep --turbo', cwd: dir }),
      };
    });

    when('[t0] --env is absent', () => {
      then('it is a constraint error (exit 2)', () => {
        expect(scene.absentEnv.exitCode).toBe(2);
      });

      then('the belay stdout matches snapshot (visual vibecheck)', () => {
        expect(scene.absentEnv.stdout).toMatchSnapshot();
      });
    });

    when('[t1] --env is outside the value set', () => {
      then('it is a constraint error (exit 2)', () => {
        // `test` is a real env elsewhere in this package but NOT here — deploy targets
        // prep and prod only. a near-miss value is the realistic caller mistake.
        expect(scene.invalidEnv.exitCode).toBe(2);
      });

      then('the belay stdout matches snapshot (visual vibecheck)', () => {
        expect(scene.invalidEnv.stdout).toMatchSnapshot();
      });
    });

    when('[t2] an unknown flag is passed', () => {
      then('it is a constraint error (exit 2)', () => {
        expect(scene.unknownArg.exitCode).toBe(2);
      });

      then('the belay stdout matches snapshot (visual vibecheck)', () => {
        expect(scene.unknownArg.stdout).toMatchSnapshot();
      });
    });
  });

  given('[case3] a valued flag is handed no usable value', () => {
    // set -u would trip a raw `$2: unbound variable` crash here — a render that names
    // neither the cause nor the fix. the kin `require_val` guard is what turns it into a
    // belay, and it must read the SAME on every deployer skill
    // (rule.require.consistent-skill-contracts).
    const scene = useBeforeAll(async () => {
      const dir = setupRepo({ slug: 'deploy-value-reads' });
      return {
        lastToken: runDeploy({ args: '--env', cwd: dir }),
        eatsFlag: runDeploy({ args: '--env --skill deploy', cwd: dir }),
      };
    });

    when('[t0] --env is the last token, with no value', () => {
      then('it is a constraint error (exit 2), never a bash crash', () => {
        expect(scene.lastToken.exitCode).toBe(2);
        expect(scene.lastToken.stderr).not.toContain('unbound variable');
      });

      then('the belay names the valid set, not just the symptom', () => {
        // rule.require.errors-name-the-fix: rejecting a value without a note of the
        // valid ones is the difference between one keystroke and a trip to `help`.
        expect(scene.lastToken.stdout).toContain('fix: pass one of prep,prod');
        expect(scene.lastToken.stdout).toMatchSnapshot();
      });
    });

    when('[t1] --env is handed the NEXT FLAG as its value', () => {
      then('it belays about --env, never about the flag it ate', () => {
        // the subtle half: without the guard, ENV='--skill' and the run belays about an
        // invalid env named `--skill` — a wrong-but-specific hint that points the caller
        // at the wrong flag entirely (rule.forbid.surprises).
        expect(scene.eatsFlag.exitCode).toBe(2);
        expect(scene.eatsFlag.stdout).toContain('absent value for --env');
        expect(scene.eatsFlag.stdout).toMatchSnapshot();
      });
    });
  });

  given('[case4] a non-prod deploy skips the gate entirely', () => {
    const scene = useBeforeAll(async () => {
      const dir = setupRepo({ slug: 'deploy-prep' });
      return { prep: runDeploy({ args: '--env prep', cwd: dir }) };
    });

    when('[t0] --env prep is run', () => {
      then('the gate branch is never entered', () => {
        expect(scene.prep.stdout).not.toContain('check the gate...');
        expect(scene.prep.stdout).not.toContain('prod is locked');
      });

      then('the header tree still closes properly', () => {
        // the negative control on the header split: with the gate skipped, the `env`
        // item and the `eyes on target...` close must still compose into ONE well-formed
        // tree — no orphan `├─`, no absent `└─`.
        expectHeaderTreeClosed(scene.prep.stdout);
      });

      then('the FULL stdout matches snapshot (visual vibecheck)', () => {
        // header through the absent-credential belay, which proves the wet-paws block is
        // SELF-CONTAINED — its own mascot, seamed off the header tree, rather than bare
        // leaves that inherit `chartin course...` and read as a clean start.
        expect(scene.prep.stdout).toMatchSnapshot();
      });
    });
  });

  given('[case5] the prod gate decides whether a prod deploy proceeds', () => {
    const scene = useBeforeAll(async () => {
      const blocked = setupRepo({ slug: 'deploy-gate-blocked' });
      const cleared = setupRepo({ slug: 'deploy-gate-cleared' });
      runDeployerSkill({
        skill: 'deploy.uses.sh',
        args: 'allow --env prod',
        cwd: cleared,
      });
      return {
        blocked: runDeploy({ args: '--env prod', cwd: blocked }),
        cleared: runDeploy({ args: '--env prod', cwd: cleared }),
      };
    });

    when('[t0] a prod deploy runs with no grant', () => {
      then('it is a constraint error (exit 2)', () => {
        expect(scene.blocked.exitCode).toBe(2);
      });

      then('the blocked frame CLOSES the parent tree at column 0', () => {
        expectHeaderTreeClosed(scene.blocked.stdout);
        expect(scene.blocked.stdout).toContain('   └─ blocked at the gate');
        // the belay mascot takes an ARTIFACT BLOCK, as every kin render's does. it used
        // to end on the bare cat, so a blocked run's final word was a mascot and the
        // outcome was stated only inside the tree the reader had just been told to skip.
        expect(scene.blocked.stdout).toMatch(
          /\n🐈 belay that\.\.\.\n\n⛵ deploy\n {3}└─ blocked at the gate\n?$/,
        );
      });

      then('the credential work below the gate is NEVER reached', () => {
        // the safety order the header split had to preserve: a blocked prod write must
        // exit before any credential is read.
        expect(scene.blocked.stdout).not.toContain('eyes on target');
        expect(scene.blocked.stdout).not.toContain('export credentials from');
      });

      then(
        'the FULL blocked stdout matches snapshot (visual vibecheck)',
        () => {
          expect(scene.blocked.stdout).toMatchSnapshot();
        },
      );
    });

    when('[t1] a prod deploy runs with an unlimited grant', () => {
      then('the gate is cleared and the bucket is NOT empty', () => {
        expect(scene.cleared.stdout).toContain(
          '   │  │     └─ authorized via local unlimited grant',
        );
        expect(scene.cleared.stdout).not.toContain(
          '   │  ├─\n   │  │\n   │  │\n   │  └─',
        );
      });

      then('the child never renders at column 0', () => {
        expect(scene.cleared.stdout).not.toMatch(/^🦺 /m);
      });

      then('the run proceeds PAST the gate to the credential work', () => {
        // this case has no keyrack, so the proof of "past the gate" is that the run
        // reached the CREDENTIAL read and belayed there — not at the gate. it used to
        // assert `└─ eyes on target...`, which the run never reaches without creds; that
        // held only because `eyes on target` was then printed unconditionally, right
        // after the gate, as the header's close. now it is the deploy bucket's label and
        // sits past the credential read, so the credential belay is the honest marker.
        expect(scene.cleared.stdout).toContain(
          '   └─ halted: absent credentials',
        );
        expect(scene.cleared.stdout).toContain(
          '   ├─ absent AWS_PROFILE from keyrack for env=prod',
        );
        // and it is NOT a gate belay — the gate cleared, which is the whole point
        expect(scene.cleared.stdout).not.toContain('blocked at the gate');
      });

      then(
        'the cleared frame matches snapshot (sliced at the bucket close)',
        () => {
          expect(sliceThroughGate(scene.cleared.stdout)).toMatchSnapshot();
        },
      );
    });
  });

  given('[case6] the serverless deploy is FRAMED in a bucket', () => {
    // this case once asserted the OPPOSITE — that serverless output reaches column 0
    // verbatim under the forward-contract exemption. the exemption was claimed in a
    // comment and never checked, and the check found no caller: not one workflow or
    // command in this repo pipes `rhx deploy` and parses its stdout. an exemption with
    // no consumer protects a contract that does not exist, so the frame went back on
    // (rule.require.nest-subskill-output-in-buckets, `.verify the contract`).
    //
    // it stayed un-observed because every OTHER case here belays at the credential
    // read, so no test had seen one line of the passthrough. the stub bin makes it
    // reachable.
    //
    // it also clamps the env→command branch, which had NO coverage at all — prod must
    // route to deploy:prod and non-prod to deploy:dev, and the two were only ever read,
    // never run.
    const scene = useBeforeAll(async () => {
      const prep = setupRepo({ slug: 'deploy-payload-prep' });
      const prod = setupRepo({ slug: 'deploy-payload-prod' });
      runDeployerSkill({
        skill: 'deploy.uses.sh',
        args: 'allow --env prod',
        cwd: prod,
      });
      return {
        prep: runDeployerSkill(
          { skill: 'deploy.sh', args: '--env prep', cwd: prep },
          { env: { PATH: genStubBinPath({ cwd: prep }) } },
        ),
        prod: runDeployerSkill(
          { skill: 'deploy.sh', args: '--env prod', cwd: prod },
          { env: { PATH: genStubBinPath({ cwd: prod }) } },
        ),
      };
    });

    when('[t0] a non-prod deploy reaches the payload', () => {
      then('the run reaches the tool at all (exit 0)', () => {
        // asserted as a PAIR so a failure names its own cause. `expect(exitCode).toBe(0)`
        // alone reports "expected 0, received 127" and leaves the reader to guess which
        // command was absent; the stderr beside it says so outright
        // (rule.require.errors-name-the-fix, applied to the test's own output).
        expect({
          exitCode: scene.prep.exitCode,
          stderr: scene.prep.stderr,
        }).toEqual({ exitCode: 0, stderr: '' });
        expect(scene.prep.stdout).toContain('npm-run:');
      });

      then('non-prod routes to the dev command', () => {
        expect(scene.prep.stdout).toContain('npm-run: deploy:dev');
      });

      then('every payload line sits BEHIND the bucket gutter', () => {
        // the positive: the payload carries the frame's `      │  ` prefix.
        expect(scene.prep.stdout).toContain(
          '      │  serverless: deploy underway',
        );

        // the negative control: and it does NOT survive at column 0. without this, a
        // double-render would satisfy the positive above and still be wrong.
        expect(scene.prep.stdout).not.toMatch(/^serverless: deploy underway$/m);
      });

      then('the frame is drawn, and it is NOT empty', () => {
        // an empty frame — open, blank, blank, close — promises work that never
        // happened. assert the open and close exist AND that content sits between.
        expect(scene.prep.stdout).toContain('   └─ eyes on target...');
        expect(scene.prep.stdout).toContain('      ├─\n');
        expect(scene.prep.stdout).toContain('      └─\n');
        expect(scene.prep.stdout).not.toMatch(/ {6}├─\n {6}│\n {6}│\n {6}└─/);
      });

      then('the FULL stdout matches snapshot (visual vibecheck)', () => {
        expect(scene.prep.stdout).toMatchSnapshot();
      });
    });

    when('[t1] a prod deploy clears the gate and reaches the payload', () => {
      then('prod routes to the prod command', () => {
        expect(scene.prod.exitCode).toBe(0);
        expect(scene.prod.stdout).toContain('npm-run: deploy:prod');
      });

      then('BOTH children are bucketed, each in its own frame', () => {
        // one run holds two children, and neither is exempt: the ghlitch gate (own 🦺
        // vibes) and the third-party serverless run each get their own frame. the two
        // sit at DIFFERENT depths — the gate under a `├─` item at `   │  `, the deploy
        // under the tree's `└─` at `      ` — which is what proves they are separate
        // frames rather than one merged bucket.
        expect(scene.prod.stdout).toContain(
          '   │  │     └─ authorized via local unlimited grant',
        );
        expect(scene.prod.stdout).toContain(
          '      │  serverless: deploy underway',
        );
        expect(scene.prod.stdout).not.toMatch(/^serverless: deploy underway$/m);
      });

      then('the FULL stdout matches snapshot (visual vibecheck)', () => {
        expect(scene.prod.stdout).toMatchSnapshot();
      });
    });
  });
});
