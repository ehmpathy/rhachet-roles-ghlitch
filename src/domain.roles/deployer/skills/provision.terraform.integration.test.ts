import { genTempDir, given, then, useBeforeAll, when } from 'test-fns';

import { genStubBinPath, PATH_WITHOUT_RHX } from '../../.test/runRoleSkill';
import {
  DEPLOYER_FIXTURE,
  runDeployerSkill,
  sliceThroughGate,
} from './.test/runDeployerSkill';

/**
 * .what = render clamps for every critipath of the `provision.terraform` contract
 * .why  = this skill had NO integration suite. its only two clamped renders lived in
 *         `uses.play` — the prod-gate frame, added when the gate was bucketed. every
 *         other render it emits had never been observed by a test.
 *
 *         that gap is not theoretical here. the same change that bucketed the gate also
 *         split this skill's header (`env` and `cmd` above the gate, `dir` below) and
 *         re-seamed its three directory belays so they no longer inherit the header's
 *         `chartin course...` success mascot. three renders were edited, and zero of
 *         them had a clamp. a `toContain` cannot see a mascot that leaked or a tree left
 *         half-drawn — only a snapshot can
 *         (rule.require.nest-subskill-output-in-buckets, `.clamp the frame with a
 *         SNAPSHOT`).
 */

/**
 * .what = a temp git repo, optionally carrying terraform environment directories
 * .why  = the skill looks its directory up under `<gitroot>/provision/aws/environments`,
 *         so directory PRESENCE is the variable that drives its three belays. each case
 *         symlinks the one `tf.env` fixture in under whichever env names it needs, which
 *         keeps presence test-controlled and adhoc-mkdir free
 *         (rule.forbid.adhoc-gentempdir-reimpl).
 */
const setupRepo = (input: { slug: string; envDirs: string[] }): string =>
  genTempDir({
    slug: input.slug,
    git: true,
    symlink: [
      { at: 'node_modules', to: 'node_modules' },
      { at: '.agent/keyrack.yml', to: `${DEPLOYER_FIXTURE}/keyrack.yml` },
      { at: 'package.json', to: `${DEPLOYER_FIXTURE}/package.json` },
      ...input.envDirs.map((name) => ({
        at: `provision/aws/environments/${name}`,
        to: `${DEPLOYER_FIXTURE}/tf.env`,
      })),
    ],
  });

const runTf = (input: { args: string; cwd: string }) =>
  runDeployerSkill(
    { skill: 'provision.terraform.sh', args: input.args, cwd: input.cwd },
    { env: { PATH: PATH_WITHOUT_RHX } },
  );

/**
 * .what = assert a render that OPENS the header tree also CLOSES it
 * .why  = the header split put `env` and `cmd` above the gate and left `dir` as the
 *         tree's only `└─`. every belay that fires between the two must therefore close
 *         the tree on its way out, or it leaves items dangling under no close — the same
 *         half-drawn shape `run_sub_bucket_or_belay` exists to prevent at the gate.
 *
 *         the three directory belays did exactly that when this suite first ran. a
 *         `toContain` could not see it: every line it would have looked for was present,
 *         and the missing thing was a line that was not there. so the invariant is
 *         asserted directly, on every render, rather than trusted to the snapshots alone.
 */
const expectHeaderTreeClosed = (out: string): void => {
  if (!out.includes('⛵ provision.terraform --env')) return; // no tree opened
  expect(out).toMatch(/\n {3}└─ /);
};

describe('provision.terraform (contract renders)', () => {
  given('[case1] help is requested', () => {
    const scene = useBeforeAll(async () => {
      const dir = setupRepo({ slug: 'tf-help', envDirs: [] });
      return {
        bare: runTf({ args: 'help', cwd: dir }),
        long: runTf({ args: '--help', cwd: dir }),
        short: runTf({ args: '-h', cwd: dir }),
        trailing: runTf({ args: 'plan --env prep --help', cwd: dir }),
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
        // rule.require.skill-help demands all three forms; a divergence between them is
        // the drift this clamps.
        expect(scene.long.stdout).toEqual(scene.bare.stdout);
        expect(scene.short.stdout).toEqual(scene.bare.stdout);
      });
    });

    when('[t2] --help arrives AFTER other args', () => {
      then('the parse loop still reaches it and exits 0', () => {
        // the pre-loop `$1` check cannot see a trailing --help; only the case statement
        // can. rhx passes --skill/--repo/--role ahead of the caller's args, so a
        // help-flag that is never first is the normal shape, not the edge one.
        expect(scene.trailing.exitCode).toBe(0);
        expect(scene.trailing.stdout).toEqual(scene.bare.stdout);
      });
    });
  });

  given('[case2] argument constraints belay before any work is done', () => {
    const scene = useBeforeAll(async () => {
      const dir = setupRepo({ slug: 'tf-arg-constraints', envDirs: ['prep'] });
      return {
        absentEnv: runTf({ args: 'plan', cwd: dir }),
        legacyDev: runTf({ args: 'plan --env dev', cwd: dir }),
        invalidEnv: runTf({ args: 'plan --env sandbox', cwd: dir }),
        absentCmd: runTf({ args: '--env prep', cwd: dir }),
        rawAutoApprove: runTf({
          args: 'apply --env prep -auto-approve',
          cwd: dir,
        }),
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

    when('[t1] --env is the retired dev alias', () => {
      then('it is a constraint error (exit 2)', () => {
        expect(scene.legacyDev.exitCode).toBe(2);
      });

      then('the belay names the replacement, not just the symptom', () => {
        // rule.require.errors-name-the-fix: a caller who typed the OLD word needs the
        // migration, and the dev/ directory backcompat note is the part that saves them
        // a second guess.
        expect(scene.legacyDev.stdout).toMatchSnapshot();
      });
    });

    when('[t2] --env is outside the value set', () => {
      then('it is a constraint error (exit 2)', () => {
        expect(scene.invalidEnv.exitCode).toBe(2);
      });

      then('the belay stdout matches snapshot (visual vibecheck)', () => {
        expect(scene.invalidEnv.stdout).toMatchSnapshot();
      });
    });

    when('[t3] no terraform subcommand is passed', () => {
      then('it is a constraint error (exit 2)', () => {
        expect(scene.absentCmd.exitCode).toBe(2);
      });

      then('the belay stdout matches snapshot (visual vibecheck)', () => {
        expect(scene.absentCmd.stdout).toMatchSnapshot();
      });
    });

    when(
      "[t4] terraform's own -auto-approve is passed instead of --approve",
      () => {
        then('it is a constraint error (exit 2)', () => {
          expect(scene.rawAutoApprove.exitCode).toBe(2);
        });

        then('the belay stdout matches snapshot (visual vibecheck)', () => {
          expect(scene.rawAutoApprove.stdout).toMatchSnapshot();
        });
      },
    );
  });

  given('[case3] the prep environment directory has two accepted names', () => {
    // prep accepts either `prep/` or the legacy `dev/`. that is three renders — one per
    // arm, plus the ambiguity belay when BOTH are present — and none had ever been seen.
    const scene = useBeforeAll(async () => {
      const onlyPrep = setupRepo({ slug: 'tf-dir-prep', envDirs: ['prep'] });
      const onlyDev = setupRepo({ slug: 'tf-dir-dev', envDirs: ['dev'] });
      const both = setupRepo({
        slug: 'tf-dir-both',
        envDirs: ['prep', 'dev'],
      });
      const neither = setupRepo({ slug: 'tf-dir-neither', envDirs: [] });
      return {
        onlyPrep: runTf({ args: 'plan --env prep', cwd: onlyPrep }),
        onlyDev: runTf({ args: 'plan --env prep', cwd: onlyDev }),
        both: runTf({ args: 'plan --env prep', cwd: both }),
        neither: runTf({ args: 'plan --env prep', cwd: neither }),
      };
    });

    when('[t0] only prep/ exists', () => {
      then('the header renders with dir: prep', () => {
        // a `├─`, NOT the tree's close. the credential export and the terraform bucket
        // are real steps that follow, so the tree stays open through them; whatever
        // ends the run must close it on the way out.
        expect(scene.onlyPrep.stdout).toContain('   ├─ dir: prep');
      });

      then('the FULL stdout matches snapshot (visual vibecheck)', () => {
        // the whole render, header through the absent-credential belay. it proves three
        // things at once: `env`/`cmd` land ABOVE where the gate would sit, `dir` lands
        // BELOW the directory lookup that settles it, and the wet-paws belay that
        // follows is SELF-CONTAINED — its own mascot, seamed off the header tree, with
        // the tree closed by a `└─ halted:` line before the seam.
        expect(scene.onlyPrep.stdout).toMatchSnapshot();
      });
    });

    when('[t1] only the legacy dev/ exists', () => {
      then('the header renders with dir: dev', () => {
        expect(scene.onlyDev.stdout).toContain('   ├─ dir: dev');
      });

      then('the FULL stdout matches snapshot (visual vibecheck)', () => {
        expect(scene.onlyDev.stdout).toMatchSnapshot();
      });
    });

    when('[t2] BOTH prep/ and dev/ exist', () => {
      then('it is a constraint error (exit 2)', () => {
        expect(scene.both.exitCode).toBe(2);
      });

      then('the header tree is CLOSED before the belay', () => {
        expectHeaderTreeClosed(scene.both.stdout);
        expect(scene.both.stdout).toContain(
          '   └─ blocked: ambiguous environment directory',
        );
      });

      then('the ambiguity belay is SELF-CONTAINED, never in-tree', () => {
        // the defect this guards: a post-header belay rendered as bare leaves inherits
        // `chartin course...` and reads as a run that started fine, with the exit code
        // as the only clue it failed
        // (rule.require.nest-subskill-output-in-buckets, `.the two costs a split
        // imposes`). so it must carry its own mascot AND its own artifact header.
        expect(scene.both.stdout).toContain('🐈 belay that...');
        expect(scene.both.stdout).toMatch(
          /\n\n🐈 belay that\.\.\.\n\n⛵ provision\.terraform\n/,
        );
      });

      then('the FULL stdout matches snapshot (visual vibecheck)', () => {
        expect(scene.both.stdout).toMatchSnapshot();
      });
    });

    when('[t3] NEITHER prep/ nor dev/ exists', () => {
      then('it is a constraint error (exit 2)', () => {
        expect(scene.neither.exitCode).toBe(2);
      });

      then('the header tree is CLOSED before the belay', () => {
        expectHeaderTreeClosed(scene.neither.stdout);
        expect(scene.neither.stdout).toContain(
          '   └─ blocked: absent environment directory',
        );
      });

      then(
        'the absent-directory belay is SELF-CONTAINED, never in-tree',
        () => {
          expect(scene.neither.stdout).toMatch(
            /\n\n🐈 belay that\.\.\.\n\n⛵ provision\.terraform\n/,
          );
        },
      );

      then('the FULL stdout matches snapshot (temp path masked)', () => {
        // the belay names the absolute path it looked for, so the temp dir is masked —
        // an unmasked absolute path is a hermeticity leak that reddens on every host
        // (rule.require.hermetic-tests).
        expect(
          scene.neither.stdout.replace(
            /directory not found: \S+/,
            'directory not found: <DIR>',
          ),
        ).toMatchSnapshot();
      });
    });
  });

  given('[case4] a non-prep environment directory is absent', () => {
    // test/ and prod/ take the single-name arm, which belays through a DIFFERENT branch
    // than prep's two-name arm above. same message, different code path — and the third
    // of the three belays this branch re-seamed.
    const scene = useBeforeAll(async () => {
      const dir = setupRepo({ slug: 'tf-dir-absent-test', envDirs: [] });
      return { absent: runTf({ args: 'plan --env test', cwd: dir }) };
    });

    when('[t0] --env test is run with no test/ directory', () => {
      then('it is a constraint error (exit 2)', () => {
        expect(scene.absent.exitCode).toBe(2);
      });

      then('the header tree is CLOSED before the belay', () => {
        expectHeaderTreeClosed(scene.absent.stdout);
        expect(scene.absent.stdout).toContain(
          '   └─ blocked: absent environment directory',
        );
      });

      then('the belay is SELF-CONTAINED, never in-tree', () => {
        expect(scene.absent.stdout).toMatch(
          /\n\n🐈 belay that\.\.\.\n\n⛵ provision\.terraform\n/,
        );
      });

      then('the FULL stdout matches snapshot (temp path masked)', () => {
        expect(
          scene.absent.stdout.replace(
            /directory not found: \S+/,
            'directory not found: <DIR>',
          ),
        ).toMatchSnapshot();
      });
    });
  });

  given('[case5] the prod gate decides whether a prod write proceeds', () => {
    const scene = useBeforeAll(async () => {
      const blocked = setupRepo({ slug: 'tf-gate-blocked', envDirs: ['prod'] });
      const cleared = setupRepo({ slug: 'tf-gate-cleared', envDirs: ['prod'] });
      runDeployerSkill({
        skill: 'provision.uses.sh',
        args: 'allow --env prod',
        cwd: cleared,
      });
      return {
        blocked: runTf({ args: 'apply --env prod', cwd: blocked }),
        cleared: runTf({ args: 'apply --env prod', cwd: cleared }),
        readonly: runTf({ args: 'plan --env prod', cwd: blocked }),
      };
    });

    when('[t0] a prod write runs with no grant', () => {
      then('it is a constraint error (exit 2)', () => {
        expect(scene.blocked.exitCode).toBe(2);
      });

      then('the blocked frame CLOSES the parent tree at column 0', () => {
        expectHeaderTreeClosed(scene.blocked.stdout);
        // the property `run_sub_bucket_or_belay` exists to hold. a bare `|| exit $?`
        // would leave the ⛵ tree half-drawn — no `└─`, the verdict buried three gutters
        // deep, under a mascot that already said the run was fine.
        expect(scene.blocked.stdout).toContain('   └─ blocked at the gate');
        // and the belay mascot takes an ARTIFACT BLOCK, as every kin render's does — a
        // bare cat is a phase opened and never answered.
        expect(scene.blocked.stdout).toMatch(
          /\n🐈 belay that\.\.\.\n\n⛵ provision\.terraform\n {3}└─ blocked at the gate\n?$/,
        );
      });

      then(
        'the FULL blocked stdout matches snapshot (visual vibecheck)',
        () => {
          expect(scene.blocked.stdout).toMatchSnapshot();
        },
      );
    });

    when('[t1] a prod write runs with an unlimited grant', () => {
      then('the gate is cleared and the bucket is NOT empty', () => {
        expect(scene.cleared.stdout).toContain(
          '   │  │     └─ authorized via local unlimited grant',
        );
        // a frame around no output is worse than the un-bucketed shape it replaced
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

    when('[t2] a READ-ONLY prod subcommand runs with no grant', () => {
      then('the gate is skipped entirely — reads stay open', () => {
        expect(scene.readonly.stdout).not.toContain('check the gate...');
        expect(scene.readonly.stdout).not.toContain('prod is locked');
      });

      then('the header still closes properly, past its dir line', () => {
        // the negative control on the header split: with the gate branch skipped, the
        // `env`/`cmd` half and the `dir` half must still compose into ONE well-formed
        // tree — no orphan `├─`, no absent `└─`.
        //
        // `dir` is an `├─` here, not the close. this run belays at the credential read,
        // so the `└─` is the `halted:` line that belay prints on its way out — which is
        // exactly the property this control exists to catch: a belay that skips the
        // close would leave the tree half-drawn, and expectHeaderTreeClosed reddens.
        expectHeaderTreeClosed(scene.readonly.stdout);
        expect(scene.readonly.stdout).toContain('   ├─ dir: prod');
        expect(scene.readonly.stdout).toContain(
          '   └─ halted: absent credentials',
        );
      });

      then('the FULL stdout matches snapshot (visual vibecheck)', () => {
        expect(scene.readonly.stdout).toMatchSnapshot();
      });
    });
  });

  given(
    '[case6] a writer subcommand is unknown to the read-only allowlist',
    () => {
      // fail-closed: the allowlist names the reads, and EVERYTHING else is treated as a
      // write. a new terraform mutation verb must not be able to slip past ungated, so the
      // clamp is on a verb the allowlist has never heard of.
      const scene = useBeforeAll(async () => {
        const dir = setupRepo({
          slug: 'tf-gate-failclosed',
          envDirs: ['prod'],
        });
        return { unknown: runTf({ args: 'taint --env prod', cwd: dir }) };
      });

      when(
        '[t0] an unlisted subcommand runs against prod with no grant',
        () => {
          then('it is gated, not waved through (exit 2)', () => {
            expect(scene.unknown.exitCode).toBe(2);
            expect(scene.unknown.stdout).toContain('   ├─ check the gate...');
            expectHeaderTreeClosed(scene.unknown.stdout);
          });

          then('the FULL stdout matches snapshot (visual vibecheck)', () => {
            expect(scene.unknown.stdout).toMatchSnapshot();
          });
        },
      );
    },
  );

  given('[case7] the terraform run is FRAMED in a bucket', () => {
    // this case once asserted the OPPOSITE — that terraform's output reaches column 0
    // verbatim under the forward-contract exemption. the exemption was claimed in a
    // comment and never checked, and the check found no caller: not one workflow or
    // command in this repo pipes `rhx provision.terraform` and parses its stdout. an
    // exemption with no consumer protects a contract that does not exist, so the frame
    // went back on (rule.require.nest-subskill-output-in-buckets, `.verify the contract`).
    //
    // it stayed un-observed for as long as it did because every OTHER case in this suite
    // belays before the credential read, so no test had ever seen one line of the
    // passthrough. the stub bin makes the tool reachable; the controls pin the frame.
    const scene = useBeforeAll(async () => {
      const dir = setupRepo({ slug: 'tf-passthrough', envDirs: ['prep'] });
      return {
        result: runDeployerSkill(
          {
            skill: 'provision.terraform.sh',
            args: 'plan --env prep',
            cwd: dir,
          },
          { env: { PATH: genStubBinPath({ cwd: dir }) } },
        ),
      };
    });

    when('[t0] the terraform payload reaches the caller', () => {
      then('the run reaches the tool at all (exit 0)', () => {
        // the guard on this whole case. if the credential read ever belays again, this
        // reddens instead of the controls below quietly held over a render that was
        // never produced.
        expect(scene.result.exitCode).toBe(0);
        expect(scene.result.stdout).toContain('terraform-argv:');
      });

      then('every payload line sits BEHIND the bucket gutter', () => {
        // the positive: each line carries the frame's `      │  ` prefix.
        for (const line of [
          'Plan: 0 to add, 0 to change, 0 to destroy.',
          'terraform-argv:',
        ])
          expect(scene.result.stdout).toContain(`      │  ${line}`);

        // the negative control: and NOT one of them survives at column 0. without this,
        // a double-render would satisfy the positive above and still be wrong.
        expect(scene.result.stdout).not.toMatch(
          /^Plan: 0 to add, 0 to change, 0 to destroy\.$/m,
        );
      });

      then('the frame is drawn, and it is NOT empty', () => {
        // an empty frame — open, blank, blank, close — passes every `toContain` above's
        // kin and still promises work that never happened. assert the open and close
        // exist AND that a content line sits between them.
        expect(scene.result.stdout).toContain('   └─ run terraform...');
        expect(scene.result.stdout).toContain('      ├─\n');
        expect(scene.result.stdout).toContain('      └─\n');
        expect(scene.result.stdout).not.toMatch(/ {6}├─\n {6}│\n {6}│\n {6}└─/);
      });

      then('the FULL stdout matches snapshot (visual vibecheck)', () => {
        expect(scene.result.stdout).toMatchSnapshot();
      });
    });
  });
});
