import { genTempDir, given, then, useBeforeAll, when } from 'test-fns';

import { genStubBinPath, PATH_WITHOUT_RHX } from '../../.test/runRoleSkill';
import {
  DEPLOYER_FIXTURE,
  runDeployerSkill,
  sliceThroughGate,
} from './.test/runDeployerSkill';

/**
 * .what = render clamps for every critipath of the `aws.cloudformation.rollback` contract
 * .why  = this skill had NO integration suite. its only two clamped renders lived in
 *         `uses.play` — the prod-gate frame, added when the gate was bucketed. its help,
 *         its four belays, its --stack override and its non-prod header had never been
 *         observed by a test.
 */

const setupRepo = (input: { slug: string }): string =>
  genTempDir({
    slug: input.slug,
    git: true,
    symlink: [
      { at: 'node_modules', to: 'node_modules' },
      { at: '.agent/keyrack.yml', to: `${DEPLOYER_FIXTURE}/keyrack.yml` },
      // the skill derives its stack name from package.json#name — `svc-test` in the
      // fixture, so every stack name below reads `svc-test-<env>`
      { at: 'package.json', to: `${DEPLOYER_FIXTURE}/package.json` },
    ],
  });

const runRollback = (input: { args: string; cwd: string }) =>
  runDeployerSkill(
    {
      skill: 'aws.cloudformation.rollback.sh',
      args: input.args,
      cwd: input.cwd,
    },
    { env: { PATH: PATH_WITHOUT_RHX } },
  );

/**
 * .what = assert a render that OPENS the header tree also CLOSES it
 * .why  = the gate sits INSIDE the header tree, between the `├─ stack` item and the
 *         `└─ eyes on target...` close. an exit taken between the two must close the
 *         tree, or it leaves items with no close — the half-drawn shape
 *         `run_sub_bucket_or_belay` exists to prevent, which a `toContain` cannot see.
 */
const expectHeaderTreeClosed = (out: string): void => {
  if (!out.includes('⛵ aws.cloudformation.rollback --stack')) return;
  expect(out).toMatch(/\n {3}└─ /);
};

describe('aws.cloudformation.rollback (contract renders)', () => {
  given('[case1] help is requested', () => {
    const scene = useBeforeAll(async () => {
      const dir = setupRepo({ slug: 'rollback-help' });
      return {
        bare: runRollback({ args: 'help', cwd: dir }),
        long: runRollback({ args: '--help', cwd: dir }),
        short: runRollback({ args: '-h', cwd: dir }),
        helpLate: runRollback({ args: '--env prep --help', cwd: dir }),
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
        expect(scene.helpLate.exitCode).toBe(0);
        expect(scene.helpLate.stdout).toEqual(scene.bare.stdout);
      });
    });
  });

  given('[case2] argument constraints belay before any work is done', () => {
    const scene = useBeforeAll(async () => {
      const dir = setupRepo({ slug: 'rollback-arg-constraints' });
      return {
        absentBoth: runRollback({ args: '', cwd: dir }),
        invalidEnv: runRollback({ args: '--env test', cwd: dir }),
        unknownArg: runRollback({ args: '--env prep --force', cwd: dir }),
      };
    });

    when('[t0] neither --env nor --stack is passed', () => {
      then('it is a constraint error (exit 2)', () => {
        // this skill accepts EITHER selector, so the belay must name both — one that
        // named only --env would send a --stack caller down the wrong path
        // (rule.require.errors-name-the-fix).
        expect(scene.absentBoth.exitCode).toBe(2);
      });

      then('the belay stdout matches snapshot (visual vibecheck)', () => {
        expect(scene.absentBoth.stdout).toMatchSnapshot();
      });
    });

    when('[t1] --env is outside the value set', () => {
      then('it is a constraint error (exit 2)', () => {
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
    // set -u would trip a raw `$2: unbound variable` crash here. the kin `require_val`
    // guard turns it into a belay that reads the SAME on every deployer skill
    // (rule.require.consistent-skill-contracts).
    const scene = useBeforeAll(async () => {
      const dir = setupRepo({ slug: 'rollback-value-reads' });
      return {
        envLast: runRollback({ args: '--env', cwd: dir }),
        stackLast: runRollback({ args: '--stack', cwd: dir }),
        envEatsFlag: runRollback({ args: '--env --stack x', cwd: dir }),
      };
    });

    when('[t0] --env is the last token, with no value', () => {
      then('it is a constraint error (exit 2), never a bash crash', () => {
        expect(scene.envLast.exitCode).toBe(2);
        expect(scene.envLast.stderr).not.toContain('unbound variable');
      });

      then('the belay names the valid set and matches snapshot', () => {
        expect(scene.envLast.stdout).toContain('fix: pass one of prep,prod');
        expect(scene.envLast.stdout).toMatchSnapshot();
      });
    });

    when('[t1] --stack is the last token, with no value', () => {
      then('it is a constraint error (exit 2), never a bash crash', () => {
        expect(scene.stackLast.exitCode).toBe(2);
        expect(scene.stackLast.stderr).not.toContain('unbound variable');
      });

      then('the belay names NO value set — a stack name is free-form', () => {
        // the helper takes its value set as an OPTIONAL third arg precisely so a
        // free-form flag does not advertise a fabricated set the caller would then be
        // held to.
        expect(scene.stackLast.stdout).not.toContain('fix: pass one of');
        expect(scene.stackLast.stdout).toMatchSnapshot();
      });
    });

    when('[t2] --env is handed the NEXT FLAG as its value', () => {
      then('it belays about --env, never about the flag it ate', () => {
        expect(scene.envEatsFlag.exitCode).toBe(2);
        expect(scene.envEatsFlag.stdout).toContain('absent value for --env');
        expect(scene.envEatsFlag.stdout).toMatchSnapshot();
      });
    });
  });

  given('[case4] the selector decides the stack name and the gate', () => {
    const scene = useBeforeAll(async () => {
      const dir = setupRepo({ slug: 'rollback-selectors' });
      return {
        byPrep: runRollback({ args: '--env prep', cwd: dir }),
        byStack: runRollback({ args: '--stack legacy-stack-name', cwd: dir }),
      };
    });

    when('[t0] --env prep selects the stack by convention', () => {
      then('the stack name is derived from package.json#name', () => {
        expect(scene.byPrep.stdout).toContain('   ├─ stack: svc-test-dev');
      });

      then('the gate branch is never entered', () => {
        expect(scene.byPrep.stdout).not.toContain('check the gate...');
      });

      then('the header tree closes properly', () => {
        expectHeaderTreeClosed(scene.byPrep.stdout);
      });

      then('the FULL stdout matches snapshot (visual vibecheck)', () => {
        expect(scene.byPrep.stdout).toMatchSnapshot();
      });
    });

    when('[t1] --stack names the stack explicitly', () => {
      then('the explicit name is used verbatim, no convention applied', () => {
        expect(scene.byStack.stdout).toContain(
          '   ├─ stack: legacy-stack-name',
        );
      });

      then(
        'the gate is skipped — an explicit stack implies no prod env',
        () => {
          // the gate keys on $ENV, which --stack leaves empty. worth a clamp BECAUSE it is
          // a gap a reader would want stated plainly: a prod stack named explicitly does
          // not trip the prod gate.
          expect(scene.byStack.stdout).not.toContain('check the gate...');
        },
      );

      then('the FULL stdout matches snapshot (visual vibecheck)', () => {
        expect(scene.byStack.stdout).toMatchSnapshot();
      });
    });
  });

  given(
    '[case5] the prod gate decides whether a prod rollback proceeds',
    () => {
      const scene = useBeforeAll(async () => {
        const blocked = setupRepo({ slug: 'rollback-gate-blocked' });
        const cleared = setupRepo({ slug: 'rollback-gate-cleared' });
        runDeployerSkill({
          skill: 'deploy.uses.sh',
          args: 'allow --env prod',
          cwd: cleared,
        });
        return {
          blocked: runRollback({ args: '--env prod', cwd: blocked }),
          cleared: runRollback({ args: '--env prod', cwd: cleared }),
        };
      });

      when('[t0] a prod rollback runs with no grant', () => {
        then('it is a constraint error (exit 2)', () => {
          expect(scene.blocked.exitCode).toBe(2);
        });

        then('the blocked frame CLOSES the parent tree at column 0', () => {
          expectHeaderTreeClosed(scene.blocked.stdout);
          expect(scene.blocked.stdout).toContain('   └─ blocked at the gate');
          // and the belay mascot takes an ARTIFACT BLOCK, as every kin render's does — a
          // bare cat is a phase opened and never answered.
          expect(scene.blocked.stdout).toMatch(
            /\n🐈 belay that\.\.\.\n\n⛵ aws\.cloudformation\.rollback\n {3}└─ blocked at the gate\n?$/,
          );
        });

        then('the credential work below the gate is NEVER reached', () => {
          expect(scene.blocked.stdout).not.toContain('eyes on target');
        });

        then(
          'the FULL blocked stdout matches snapshot (visual vibecheck)',
          () => {
            expect(scene.blocked.stdout).toMatchSnapshot();
          },
        );
      });

      when('[t1] a prod rollback runs with an unlimited grant', () => {
        then(
          'it gates on deploy.uses, the same meter deploy itself gates on',
          () => {
            // a rollback mutates what a deploy produced, so the two share one meter. a
            // divergence here would let a human grant a deploy and get a rollback free.
            expect(scene.cleared.stdout).toContain(
              '   │  │  🦺 deploy.uses --env prod',
            );
          },
        );

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

        then(
          'the cleared frame matches snapshot (sliced at the bucket close)',
          () => {
            expect(sliceThroughGate(scene.cleared.stdout)).toMatchSnapshot();
          },
        );
      });
    },
  );

  given('[case6] the rollback runs to completion', () => {
    // the coverage this suite lacked. every other case belays at the credential read, so
    // the whole tail past `eyes on target...` had never been rendered by a test — and
    // that tail held three defects no assertion could see:
    //   1. `eyes on target...` was a `└─`, so it CLOSED the tree, and four more blocks
    //      printed beneath a tree that had already ended
    //   2. `   continue rollback...` and `   events` had NO branch glyph at all
    //   3. `aws cloudformation continue-update-rollback` streamed un-framed; on failure
    //      its stderr landed at column 0 beside a `set -e` exit that left the ⛵ tree
    //      open with no close
    // the stub bin answers the credential export and all three cloudformation calls, so
    // the branch is reachable with no aws account (rule.require.hermetic-tests).
    const scene = useBeforeAll(async () => {
      const dir = setupRepo({ slug: 'rollback-complete' });
      return runDeployerSkill(
        {
          skill: 'aws.cloudformation.rollback.sh',
          args: '--env prep',
          cwd: dir,
        },
        { env: { PATH: genStubBinPath({ cwd: dir }) } },
      );
    });

    when('[t0] the stack reaches a terminal status', () => {
      then('the run REACHES the rollback (exit 0)', () => {
        // the guard on this whole case. if a belay ever creeps back in ahead of the
        // rollback, this reddens instead of the tree controls below quietly held over a
        // render that was never produced.
        expect({ exitCode: scene.exitCode, stderr: scene.stderr }).toEqual({
          exitCode: 0,
          stderr: '',
        });
        expect(scene.stdout).toContain('rollback continued');
      });

      then('EVERY line below the header carries a branch glyph', () => {
        // the direct clamp on defect 2. any line that is neither blank, nor a mascot,
        // nor an artifact header, must be a tree item.
        const strays = scene.stdout
          .split('\n')
          .filter((line) => line.length > 0)
          .filter((line) => !line.startsWith('🐈 '))
          .filter((line) => !line.startsWith('⛵ '))
          .filter((line) => !/^ {3}[├└]─ /.test(line));
        expect(strays).toEqual([]);
      });

      then('the tree opens ONCE and closes ONCE', () => {
        // defect 1. `eyes on target...` must be a continuation now, and exactly one
        // `└─` may exist per artifact header.
        expect(scene.stdout).toContain('   ├─ eyes on target...');
        expect(scene.stdout).not.toContain('   └─ eyes on target...');
        const closes = scene.stdout
          .split('\n')
          .filter((line) => line.startsWith('   └─ '));
        const headers = scene.stdout
          .split('\n')
          .filter((line) => line.startsWith('⛵ '));
        expect(closes.length).toBe(headers.length);
      });

      then('the silent aws child is NOT framed as an empty bucket', () => {
        // `continue-update-rollback` answers with no output, so a bucket around it would
        // frame a hollow shape — the defect the rule names under `.a bucket must never
        // frame an empty child`. the honest treatment is to capture and speak for it,
        // which is what `├─ rollback continued` is.
        expect(scene.stdout).not.toMatch(/ {6}├─\n {6}│\n {6}│\n {6}└─/);
        expect(scene.stdout).toContain('   ├─ rollback continued');
      });

      then('the FULL stdout matches snapshot (visual vibecheck)', () => {
        expect(scene.stdout).toMatchSnapshot();
      });
    });
  });

  given('[case7] the stack lands in a FAILED status', () => {
    // the other tail branch, equally un-rendered before. it closed the tree with the bare
    // stack status — which reads as one more event item, not as the end of the run — and
    // its belay named a symptom (`rollback failed`) with no next move at all
    // (rule.require.errors-name-the-fix).
    const scene = useBeforeAll(async () => {
      const dir = setupRepo({ slug: 'rollback-failed' });
      return runDeployerSkill(
        {
          skill: 'aws.cloudformation.rollback.sh',
          args: '--env prep',
          cwd: dir,
        },
        {
          env: {
            PATH: genStubBinPath({ cwd: dir }),
            STUB_CFN_STATUS: 'UPDATE_ROLLBACK_FAILED',
          },
        },
      );
    });

    when('[t0] the poll reads a FAILED status', () => {
      then('it is a malfunction (exit 1)', () => {
        expect(scene.exitCode).toBe(1);
      });

      then('the close-line word matches the exit code', () => {
        // `halted:` = exit 1 = the run broke, not the caller
        // (rule.require.consistent-skill-contracts, the close-line vocabulary).
        expect(scene.stdout).toContain('   └─ halted: UPDATE_ROLLBACK_FAILED');
        expect(scene.stdout).not.toContain('   └─ UPDATE_ROLLBACK_FAILED');
        expect(scene.stdout).not.toContain('blocked:');
      });

      then('the belay names a FIX, not just the symptom', () => {
        expect(scene.stdout).toContain(
          '   └─ hint: rhx aws.cloudformation.status --stack svc-test-dev',
        );
        expect(scene.stdout).not.toContain('   └─ rollback failed');
      });

      then('EVERY line below the header carries a branch glyph', () => {
        const strays = scene.stdout
          .split('\n')
          .filter((line) => line.length > 0)
          .filter((line) => !line.startsWith('🐈 '))
          .filter((line) => !line.startsWith('⛵ '))
          .filter((line) => !/^ {3}[├└]─ /.test(line));
        expect(strays).toEqual([]);
      });

      then('the FULL stdout matches snapshot (visual vibecheck)', () => {
        expect(scene.stdout).toMatchSnapshot();
      });
    });
  });
});
