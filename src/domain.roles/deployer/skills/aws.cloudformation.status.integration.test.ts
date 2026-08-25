import { genTempDir, given, then, useBeforeAll, when } from 'test-fns';

import { expectNoStrayLines } from '../../.test/expectNoStrayLines';
import { genStubBinPath, PATH_WITHOUT_RHX } from '../../.test/runRoleSkill';
import { DEPLOYER_FIXTURE, runDeployerSkill } from './.test/runDeployerSkill';

/**
 * .what = render clamps for every critipath of the `aws.cloudformation.status` contract
 * .why  = this skill had NO integration suite at all — not one render of it had ever been
 *         observed by a test. it is also the skill every kin belay points a human at
 *         (`hint: rhx aws.cloudformation.status --stack ...`), so its render is the one a
 *         human reads at the worst moment, and it was the least clamped in the role.
 *
 *         what the absence hid, all found by a structural sweep rather than by a failure:
 *           1. `   status` and `   failed events` wore NO branch glyph — neither blank,
 *              nor mascot, nor header, nor tree item
 *           2. the header closed on its FIRST item (`└─ stack:`), so every later block
 *              printed beneath a tree that had already ended
 *           3. the two credential belays exited 1 with the tree open and no `└─` close
 *           4. the terminal `🐈 smooth sailin!` carried no artifact block, so the run
 *              ended on a cat with no verdict
 *           5. `--env` / `--stack` took `$2` with no guard, so a flag in last position
 *              tripped a cryptic `set -u` crash rather than a belay
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

const runStatus = (input: {
  args: string;
  cwd: string;
}): { stdout: string; stderr: string; exitCode: number } =>
  runDeployerSkill(
    {
      skill: 'aws.cloudformation.status.sh',
      args: input.args,
      cwd: input.cwd,
    },
    { env: { PATH: PATH_WITHOUT_RHX } },
  );

/**
 * .what = assert a render that OPENS the header tree also CLOSES it
 * .why  = the credential read sits INSIDE the header tree, between `├─ stack` and the
 *         `└─ failed events` close. an exit taken between the two must close the tree, or
 *         it leaves items under no close — the half-drawn shape a `toContain` cannot see
 *         (rule.require.nest-subskill-output-in-buckets).
 */
const expectHeaderTreeClosed = (out: string): void => {
  if (!out.includes('⛵ aws.cloudformation.status --stack')) return;
  expect(out).toMatch(/\n {3}└─ /);
};

describe('aws.cloudformation.status (contract renders)', () => {
  given('[case1] help is requested', () => {
    const scene = useBeforeAll(async () => {
      const dir = setupRepo({ slug: 'cfn-status-help' });
      return {
        bare: runStatus({ args: 'help', cwd: dir }),
        long: runStatus({ args: '--help', cwd: dir }),
        short: runStatus({ args: '-h', cwd: dir }),
        helpLate: runStatus({ args: '--env prep --help', cwd: dir }),
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

    when('[t1] help arrives as a flag, in either form', () => {
      then('--help and -h render identically to the bare form', () => {
        expect(scene.long.stdout).toEqual(scene.bare.stdout);
        expect(scene.short.stdout).toEqual(scene.bare.stdout);
        expect(scene.long.exitCode).toBe(0);
        expect(scene.short.exitCode).toBe(0);
      });
    });

    when('[t2] help arrives AFTER another flag', () => {
      // the in-loop help arm, a separate copy of the text from the pre-loop one. two
      // copies means they can drift, so clamp that they agree rather than trust it.
      then('it still renders the same help and exits 0', () => {
        expect(scene.helpLate.exitCode).toBe(0);
        expect(scene.helpLate.stdout).toEqual(scene.bare.stdout);
      });
    });
  });

  given('[case2] argument constraints belay before any work is done', () => {
    const scene = useBeforeAll(async () => {
      const dir = setupRepo({ slug: 'cfn-status-args' });
      return {
        absent: runStatus({ args: '', cwd: dir }),
        // `test` is a real env on kin skills but not on this one — the transposition a
        // human actually makes, not a nonsense token
        badEnv: runStatus({ args: '--env test', cwd: dir }),
        unknown: runStatus({ args: '--stak svc-test-dev', cwd: dir }),
      };
    });

    when('[t0] neither --env nor --stack is passed', () => {
      then('it is a constraint (exit 2) and matches snapshot', () => {
        expect(scene.absent.exitCode).toBe(2);
        expect(scene.absent.stdout).toMatchSnapshot();
      });
    });

    when('[t1] --env names an env this skill does not serve', () => {
      then('it names the valid set and matches snapshot', () => {
        expect(scene.badEnv.exitCode).toBe(2);
        expect(scene.badEnv.stdout).toMatchSnapshot();
      });
    });

    when('[t2] an unknown flag is passed', () => {
      then('it is a constraint (exit 2) and matches snapshot', () => {
        expect(scene.unknown.exitCode).toBe(2);
        expect(scene.unknown.stdout).toMatchSnapshot();
      });
    });
  });

  given('[case3] a flag is passed with no value', () => {
    // before require_val, `$2` was read unguarded under `set -u`. a flag in last position
    // tripped `unbound variable` — a crash, not a belay — and `--env --stack x` silently
    // set ENV='--stack' and ate the next flag whole.
    const scene = useBeforeAll(async () => {
      const dir = setupRepo({ slug: 'cfn-status-absent-value' });
      return {
        envLast: runStatus({ args: '--env', cwd: dir }),
        stackLast: runStatus({ args: '--stack', cwd: dir }),
        envSwallows: runStatus({
          args: '--env --stack svc-test-dev',
          cwd: dir,
        }),
      };
    });

    when('[t0] --env is the last token', () => {
      then('it belays with the valid set, never a set -u crash', () => {
        expect(scene.envLast.exitCode).toBe(2);
        expect(scene.envLast.stdout).toMatchSnapshot();
      });

      // the negative control. a `set -u` crash also exits non-zero, so the exit code alone
      // cannot tell a belay from the crash this guard exists to prevent.
      then('it does NOT crash on an unbound variable', () => {
        expect(scene.envLast.stderr).not.toContain('unbound variable');
      });
    });

    when('[t1] --stack is the last token', () => {
      then('it belays with no fabricated value set', () => {
        expect(scene.stackLast.exitCode).toBe(2);
        expect(scene.stackLast.stdout).toMatchSnapshot();
      });
    });

    when('[t2] --env would swallow the flag that follows it', () => {
      then('it belays about --env, not about --stack', () => {
        expect(scene.envSwallows.exitCode).toBe(2);
        expect(scene.envSwallows.stdout).toContain('absent value for --env');
        expect(scene.envSwallows.stdout).not.toContain('--stack');
      });
    });
  });

  given('[case4] the credential read finds no profile', () => {
    // rhx is off PATH, so `rhx keyrack get ... || echo ""` yields empty and the skill takes
    // its absent-credential path — the one a human hits with a locked keyrack. this exit
    // happens with the header tree OPEN, so it is the case that clamps the `halted:` close.
    const scene = useBeforeAll(async () => {
      const dir = setupRepo({ slug: 'cfn-status-no-creds' });
      return {
        byEnv: runStatus({ args: '--env prep', cwd: dir }),
        byStack: runStatus({ args: '--stack custom-stack', cwd: dir }),
      };
    });

    when('[t0] the run reaches the credential read', () => {
      then('it is a malfunction (exit 1)', () => {
        expect(scene.byEnv.exitCode).toBe(1);
      });

      then('the FULL stdout matches snapshot (visual vibecheck)', () => {
        expect(scene.byEnv.stdout).toMatchSnapshot();
      });

      then('the open tree is closed before the belay', () => {
        expectHeaderTreeClosed(scene.byEnv.stdout);
      });

      // the close-line word is keyed to the exit code: `halted:` for 1, `blocked:` for 2
      // (rule.require.consistent-skill-contracts). the negative control is what has teeth
      // — the wrong word would still contain the right one's neighbours.
      then('the close names the outcome with the exit-1 word', () => {
        expect(scene.byEnv.stdout).toContain(
          '   └─ halted: absent credentials',
        );
        expect(scene.byEnv.stdout).not.toContain('   └─ blocked:');
      });

      then('no line falls outside the tree vocabulary', () => {
        expectNoStrayLines({ out: scene.byEnv.stdout, artifact: '⛵' });
      });
    });

    when('[t1] --stack overrides --env', () => {
      then('the header carries the explicit stack name', () => {
        expect(scene.byStack.exitCode).toBe(1);
        expect(scene.byStack.stdout).toContain(
          '⛵ aws.cloudformation.status --stack custom-stack',
        );
        expect(scene.byStack.stdout).toMatchSnapshot();
      });
    });
  });

  given('[case5] the status runs to completion with no failed events', () => {
    // the happy path, and the coverage this suite most lacked: every case above belays at
    // or before the credential read, so the whole tail — the status block, the event
    // block, the terminal artifact block — had never been rendered by a test. the stub bin
    // answers the credential export and both cloudformation calls, so the branch is
    // reachable with no aws account (rule.require.hermetic-tests).
    const scene = useBeforeAll(async () => {
      const dir = setupRepo({ slug: 'cfn-status-clean' });
      return runDeployerSkill(
        {
          skill: 'aws.cloudformation.status.sh',
          args: '--env prep',
          cwd: dir,
        },
        {
          env: {
            PATH: genStubBinPath({ cwd: dir }),
            STUB_CFN_STATUS: 'UPDATE_COMPLETE',
            STUB_CFN_REASON: '',
          },
        },
      );
    });

    when('[t0] the stack is healthy', () => {
      // the guard on this whole case. if a belay ever creeps back in ahead of the status
      // read, this reddens instead of the tree controls below quietly held over a render
      // that never happened.
      then('the run REACHES the status read (exit 0)', () => {
        expect(scene.exitCode).toBe(0);
      });

      then('the FULL stdout matches snapshot (visual vibecheck)', () => {
        expect(scene.stdout).toMatchSnapshot();
      });

      then('no line falls outside the tree vocabulary', () => {
        expectNoStrayLines({ out: scene.stdout, artifact: '⛵' });
      });

      // the two strays, each with its glyph-less form as the negative control. that form
      // is exactly what the defect emitted, so it is the assertion with teeth.
      then('the status fields are tree items, never a glyph-less block', () => {
        expect(scene.stdout).toContain('   ├─ status: UPDATE_COMPLETE');
        expect(scene.stdout).not.toContain('   status\n');
      });

      then(
        'the event block is the tree close, never a glyph-less block',
        () => {
          expect(scene.stdout).toContain('   └─ failed events');
          expect(scene.stdout).not.toContain('   failed events\n');
        },
      );

      // the OTHER arm of the reason branch, which case6 covers in its populated form.
      // this arm was skipped on the first pass: the stub read STUB_CFN_REASON with `:-`,
      // so an explicit empty value fell through to the default and a healthy stack
      // rendered a failure reason. the snapshot showed it; no assertion would have.
      then('an absent stack reason renders as (none)', () => {
        expect(scene.stdout).toContain('   ├─ reason: (none)');
        expect(scene.stdout).not.toContain('   ├─ reason: update failed');
      });

      // a `└─` item hosts its children at 6 spaces — no gutter, because no item follows
      // (rule.require.nest-subskill-output-in-buckets, the indent rule). at 3 spaces the
      // `(none)` would read as a sibling of `failed events`, not as its child.
      then('the empty event list nests under the item that opened it', () => {
        expect(scene.stdout).toContain('      └─ (none)');
        expect(scene.stdout).not.toMatch(/^ {3}└─ \(none\)$/m);
      });

      then('one artifact header per mascot phase', () => {
        const headers = scene.stdout
          .split('\n')
          .filter((line) => line.startsWith('⛵ aws.cloudformation.status'));
        expect(headers).toEqual([
          '⛵ aws.cloudformation.status --stack svc-test-dev',
          '⛵ aws.cloudformation.status --stack svc-test-dev',
        ]);
      });

      // the terminal mascot used to stand alone, so the run ended on a cat and no verdict.
      then('the terminal mascot carries an artifact block', () => {
        expect(scene.stdout).toContain(
          '🐈 smooth sailin!\n\n⛵ aws.cloudformation.status --stack svc-test-dev\n   └─ status: UPDATE_COMPLETE',
        );
      });
    });
  });

  given('[case6] the stack holds failed events', () => {
    // the OTHER arm of the event block — the jq that draws the nested list. under the
    // default stub no event carries a FAILED status, so that jq would never run and the
    // `(none)` arm alone would stand for both. two events, so both the `├─` and the `└─`
    // arm of the jq are observed in one render.
    const scene = useBeforeAll(async () => {
      const dir = setupRepo({ slug: 'cfn-status-failed' });
      return runDeployerSkill(
        {
          skill: 'aws.cloudformation.status.sh',
          args: '--env prod',
          cwd: dir,
        },
        {
          env: {
            PATH: genStubBinPath({ cwd: dir }),
            STUB_CFN_STATUS: 'UPDATE_ROLLBACK_FAILED',
            STUB_CFN_EVENTS: 'failed',
          },
        },
      );
    });

    when('[t0] the event list is rendered', () => {
      then('the run REACHES the event read (exit 0)', () => {
        expect(scene.exitCode).toBe(0);
      });

      then('the FULL stdout matches snapshot (visual vibecheck)', () => {
        expect(scene.stdout).toMatchSnapshot();
      });

      then('no line falls outside the tree vocabulary', () => {
        expectNoStrayLines({ out: scene.stdout, artifact: '⛵' });
      });

      // each event nests under `└─ failed events` at 6 spaces, and each event's reason
      // nests under IT. the depths are the whole claim here — a flat list at 3 spaces
      // would read as siblings of the tree's own items, which is what it used to render.
      //
      // the order is the api's own, newest first — this skill does NOT reverse, where its
      // kin aws.cloudformation.rollback does. the snapshot records that divergence rather
      // than let it pass unseen.
      then('the events nest under the item that opened them', () => {
        expect(scene.stdout).toMatch(/^ {6}├─ .* TheStackItself /m);
        expect(scene.stdout).toMatch(
          /^ {6}│ {2}└─ resource did not stabilize$/m,
        );
        expect(scene.stdout).toMatch(/^ {6}└─ .* ApiHandlerLambdaFunction /m);
        expect(scene.stdout).toMatch(/^ {9}└─ handler\.zip absent /m);
      });

      then('no event renders at the tree own depth', () => {
        expect(scene.stdout).not.toMatch(/^ {3}├─ .* UPDATE_FAILED/m);
      });

      // the reason carried by the stack itself, distinct from the per-event reasons.
      then('the stack reason is a tree item', () => {
        expect(scene.stdout).toContain('   ├─ reason: update failed on');
      });
    });
  });
});
