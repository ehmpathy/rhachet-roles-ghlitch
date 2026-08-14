import { given, then, useBeforeAll, when } from 'test-fns';

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { asEnvHermetic } from '../../.test/runRoleSkill';

/**
 * .what = contract clamps for the `_.nest.sh` bucket operations, in isolation
 * .why  = `run_sub_bucket` and `run_sub_bucket_or_belay` are generic — ANY composer that
 *         frames a child needs them, not only the prod gate — yet every render they
 *         produce was only ever observed entangled with a composer's own header. their
 *         contract could not be seen on its own, so a defect in the frame read as a
 *         defect in whichever composer happened to surface it.
 *
 *         these cases drive both against synthetic children, so each property they
 *         guarantee — the gutter, the stderr merge, the blank-line spacer, the exit code,
 *         the parent-tree close — is clamped by itself.
 */

const NEST = join(__dirname, '_.nest.sh');

/**
 * .what = source `_.nest.sh` and run one bash body against it
 * .why  = these are shell functions, so the only honest way to exercise them is a real
 *         shell that has sourced the real file — no mocks
 *         (rule.forbid.integration.mocks).
 * .note = `set -euo pipefail` mirrors every real caller, because their exit-code handling
 *         is written specifically to survive it.
 */
const runNest = (body: string): { stdout: string; exitCode: number } => {
  // the host's shell rc must not load into a run — an rc-defined FUNCTION or ALIAS beats
  // PATH outright, and these cases assert on the exact bytes a child emits, so any rc that
  // redefines `echo` or a child command would rewrite the frame under test. BASH_ENV is the
  // vector that carries one into a NON-interactive bash (rule.require.hermetic-tests).
  const env = asEnvHermetic();

  const result = spawnSync(
    'bash',
    [
      '--noprofile',
      '--norc',
      '-c',
      `set -euo pipefail\nsource "${NEST}"\n${body}`,
    ],
    { encoding: 'utf-8', env },
  );
  if (result.status === null)
    throw new Error(
      `nest driver did not exit normally: ${result.error?.message ?? 'killed by signal'}`,
    );
  return { stdout: result.stdout ?? '', exitCode: result.status };
};

describe('_.nest.sh (bucket frame contract)', () => {
  given('[case1] run_sub_bucket frames a child that succeeds', () => {
    const scene = useBeforeAll(async () => ({
      onStdout: runNest(
        `run_sub_bucket "   " bash -c 'echo "🦺 child --env prod"; echo "   └─ did the thing"' || exit $?`,
      ),
      onStderr: runNest(
        `run_sub_bucket "   " bash -c 'echo "🦺 child --env prod" >&2; echo "   └─ did the thing" >&2' || exit $?`,
      ),
    }));

    when('[t0] the child writes to stdout', () => {
      then('it exits 0', () => {
        expect(scene.onStdout.exitCode).toBe(0);
      });

      then('the frame + gutter matches snapshot (visual vibecheck)', () => {
        expect(scene.onStdout.stdout).toMatchSnapshot();
      });
    });

    when('[t1] the child writes to STDERR instead', () => {
      then('the child output still lands on the PARENT stdout', () => {
        // `run_sub_bucket` reads the child as `2>&1`, because a gutter cannot interleave
        // two streams and preserve their order. so a child that spoke on stderr when
        // invoked directly arrives on the composer's stdout once bucketed. that stream
        // change is a real contract shift, pinned here rather than left to whichever
        // stream a test happens to read
        // (rule.require.nest-subskill-output-in-buckets).
        expect(scene.onStderr.exitCode).toBe(0);
        expect(scene.onStderr.stdout).toContain('🦺 child --env prod');
      });

      then('the render is IDENTICAL to the stdout child', () => {
        expect(scene.onStderr.stdout).toEqual(scene.onStdout.stdout);
      });
    });
  });

  given('[case2] the child prints a blank line of its own', () => {
    const scene = useBeforeAll(async () => ({
      withBlank: runNest(
        `run_sub_bucket "   " bash -c 'echo "🐈 wet paws..."; echo ""; echo "🦺 child"' || exit $?`,
      ),
    }));

    when('[t0] a blank line sits between two content lines', () => {
      then('it renders as a BARE gutter, with no whitespace tail', () => {
        // `│  ` on an empty line would leave two trailing spaces — invisible on screen,
        // loud in a diff, and a formatter would strip them right back out.
        expect(scene.withBlank.stdout).toContain('\n   │\n');
        expect(scene.withBlank.stdout).not.toMatch(/│ +$/m);
      });

      then('the frame matches snapshot (visual vibecheck)', () => {
        expect(scene.withBlank.stdout).toMatchSnapshot();
      });
    });
  });

  given('[case2b] the child frames ITSELF with a blank at each edge', () => {
    // the shape a THIRD-PARTY child arrives in. kin ghlitch children emit no seam of
    // their own by convention (see the note atop uses._.check.sh), but `rhx keyrack
    // unlock` and `npx declastruct` both wrap themselves in a blank line — and the frame
    // already supplies exactly one spacer per side, so un-collapsed they render `│` twice
    // at each edge.
    const scene = useBeforeAll(async () => ({
      selfFramed: runNest(
        `run_sub_bucket "   " bash -c 'echo ""; echo "🔓 child"; echo ""; echo "🌊 more"; echo ""' || exit $?`,
      ),
    }));

    when('[t0] the child supplies its own edge blanks', () => {
      then('the doubled gutter is collapsed at BOTH edges', () => {
        // the blemish, stated as the exact bytes it produced: `├─` followed by two bare
        // gutters, and two more ahead of `└─`.
        expect(scene.selfFramed.stdout).not.toContain('   ├─\n   │\n   │\n');
        expect(scene.selfFramed.stdout).not.toContain('\n   │\n   │\n   └─');
      });

      then('exactly ONE spacer sits inside each edge', () => {
        expect(scene.selfFramed.stdout).toContain(
          '   ├─\n   │\n   │  🔓 child',
        );
        expect(scene.selfFramed.stdout).toContain('   │  🌊 more\n   │\n   └─');
      });

      then('the INTERIOR blank still renders as a bare gutter', () => {
        // only the edges collapse. a blank between two content lines is the child's own
        // paragraph break and must survive, or the fix would flatten real structure.
        expect(scene.selfFramed.stdout).toContain(
          '   │  🔓 child\n   │\n   │  🌊 more',
        );
      });

      then('the frame matches snapshot (visual vibecheck)', () => {
        expect(scene.selfFramed.stdout).toMatchSnapshot();
      });
    });
  });

  given('[case3] the child prints no output at all', () => {
    // the EMPTY BUCKET. clamped as the known-bad shape on purpose: it is the positive
    // reference every composer's negative control points at, and a reference asserted
    // nowhere is a reference that drifts.
    const scene = useBeforeAll(async () => ({
      silent: runNest(`run_sub_bucket "   " bash -c 'exit 0' || exit $?`),
    }));

    when('[t0] a silent child is bucketed', () => {
      then('the frame is emitted around not one line of output', () => {
        expect(scene.silent.exitCode).toBe(0);
        expect(scene.silent.stdout).toEqual('   ├─\n   │\n   │\n   └─\n');
      });

      then('the empty shape matches snapshot (the known-bad reference)', () => {
        // a labeled item promises a reader that a child did work here. five lines of
        // scaffold that wrap not one line of output breaks that promise, and it is worse
        // than the un-bucketed shape it replaced. the fix belongs in the CHILD — a
        // sub-skill that takes a real action must say so
        // (rule.require.status-feedback) — never in a conditional frame at the call
        // site, which is why the frame renders it faithfully rather than suppress it.
        expect(scene.silent.stdout).toMatchSnapshot();
      });

      then(
        'it is the exact string every composer asserts it never emits',
        () => {
          // the negative control in each composer suite greps for this literal. pinning it
          // here keeps the two in step: if the frame ever changes shape, this case reddens
          // and the controls get updated with it, rather than quietly matching no line.
          expect(scene.silent.stdout).toContain('   ├─\n   │\n   │\n   └─');
        },
      );
    });
  });

  given('[case4] run_sub_bucket forwards a failed child exit code', () => {
    const scene = useBeforeAll(async () => ({
      exit2: runNest(
        `run_sub_bucket "   " bash -c 'echo "🦺 child"; exit 2' || exit $?`,
      ),
      exit1: runNest(`run_sub_bucket "   " bash -c 'exit 1' || exit $?`),
    }));

    when('[t0] the child exits 2 (a constraint)', () => {
      then('the code is forwarded, never flattened to 1', () => {
        // the child runs in a PIPE to the gutter formatter, and set -e does not
        // fail-fast on a pipe member on its own. the code comes from PIPESTATUS[0],
        // which is the whole reason this is written the way it is.
        expect(scene.exit2.exitCode).toBe(2);
      });

      then('the bucket still CLOSES before the run halts', () => {
        expect(scene.exit2.stdout).toContain('   └─');
        expect(scene.exit2.stdout).toMatchSnapshot();
      });
    });

    when('[t1] the child exits 1 (a malfunction)', () => {
      then('1 is forwarded distinctly from 2', () => {
        // exit-code semantics carry meaning: 2 says the caller must fix something, 1
        // says the system did. a frame that collapsed them would make every bucketed
        // failure look like a caller error (rule.require.exit-code-semantics).
        expect(scene.exit1.exitCode).toBe(1);
      });
    });
  });

  given(
    '[case5] run_sub_bucket_or_belay closes the PARENT tree on failure',
    () => {
      // the property that distinguishes the two, and the one a bare `|| exit $?` silently
      // loses.
      const parent = [
        `echo "🐈 chartin course..."`,
        `echo ""`,
        `echo "⛵ demo --env prod"`,
        `echo "   ├─ env: prod"`,
        `echo "   ├─ check the gate..."`,
      ].join('\n');

      const belay = `run_sub_bucket_or_belay "   │  " "⛵ demo" "blocked at the gate"`;

      const scene = useBeforeAll(async () => ({
        cleared: runNest(
          `${parent}\n${belay} bash -c 'echo "🦺 gate --env prod"; echo "   └─ authorized"'\necho "   └─ eyes on target..."`,
        ),
        blocked: runNest(
          `${parent}\n${belay} bash -c 'echo "🦺 gate --env prod"; echo "   └─ prod is locked"; exit 2'\necho "   └─ eyes on target..."`,
        ),
        blockedOne: runNest(`${parent}\n${belay} bash -c 'exit 1'`),
      }));

      when('[t0] the child succeeds', () => {
        then('it returns 0 and the parent continues to its own close', () => {
          expect(scene.cleared.exitCode).toBe(0);
          expect(scene.cleared.stdout).toContain('   └─ eyes on target...');
        });

        then(
          'the render is the plain bucket — no belay, no early close',
          () => {
            expect(scene.cleared.stdout).not.toContain('belay that');
            expect(scene.cleared.stdout).not.toContain('blocked at the gate');
            expect(scene.cleared.stdout).toMatchSnapshot();
          },
        );
      });

      when('[t1] the child fails with a constraint (exit 2)', () => {
        then('the parent tree is CLOSED with the outcome item', () => {
          expect(scene.blocked.stdout).toContain('   └─ blocked at the gate');
        });

        then('the verdict is stated at COLUMN 0, not at gutter depth', () => {
          // buried three gutters deep, under a mascot that already said the run was fine,
          // a verdict is not a verdict. this is the half of the contract a snapshot can
          // see and a `toContain` cannot.
          //
          // .note = a BARE mascot is not a verdict either. this used to end
          //         `🐈 belay that...\n` with no block beneath it — a cat, and the reader
          //         still had to go back into the tree to learn the outcome. the mascot
          //         takes an artifact block, as every kin render's does.
          expect(scene.blocked.stdout).toMatch(
            /\n🐈 belay that\.\.\.\n\n⛵ demo\n {3}└─ blocked at the gate\n$/,
          );
        });

        then('the run halts — the parent NEVER reaches its own close', () => {
          expect(scene.blocked.stdout).not.toContain('eyes on target');
          expect(scene.blocked.exitCode).toBe(2);
        });

        then(
          'the FULL blocked render matches snapshot (visual vibecheck)',
          () => {
            expect(scene.blocked.stdout).toMatchSnapshot();
          },
        );
      });

      when('[t2] the child fails with a malfunction (exit 1)', () => {
        then('1 is forwarded, distinct from a constraint', () => {
          expect(scene.blockedOne.exitCode).toBe(1);
        });

        then('the close + belay SHAPE is the same as the exit-2 path', () => {
          // one shape for every failure — a per-code variant in the STRUCTURE would be
          // the dialect rule.require.consistent-skill-contracts forbids, at the render
          // layer.
          expect(scene.blockedOne.stdout).toContain(
            '   └─ blocked at the gate',
          );
          expect(scene.blockedOne.stdout).toMatch(
            /\n\n⛵ demo\n {3}└─ blocked at the gate\n$/,
          );
        });

        then('but the MASCOT follows the exit code, never a fixed word', () => {
          // the shape is fixed; the cat is not. `belay that...` is the constraint cat and
          // `wet paws...` is the malfunction cat, so the render and the exit code can
          // never disagree (rule.require.exit-code-semantics).
          //
          // this arm was hardcoded to `belay that...`, so a malfunction — a broken run,
          // no fault of the caller's — told the caller to go fix their input.
          expect(scene.blockedOne.stdout).toContain('🐈 wet paws...');
          expect(scene.blockedOne.stdout).not.toContain('belay that');
          expect(scene.blocked.stdout).toContain('🐈 belay that...');
          expect(scene.blocked.stdout).not.toContain('wet paws');
        });

        then('the FULL malfunction render matches snapshot', () => {
          // .note = the bucket in this snapshot is EMPTY, and that is the fixture, not a
          //         sanctioned shape. the child here is `bash -c 'exit 1'`, chosen to be
          //         silent so the exit-code path is isolated from any render of its own.
          //         in a real composer an empty bucket is a blocker — the fix belongs in
          //         the silent child, never in a conditional frame
          //         (rule.require.nest-subskill-output-in-buckets).
          expect(scene.blockedOne.stdout).toMatchSnapshot();
        });
      });
    },
  );

  given('[case6] the gutter scales with the indent it is handed', () => {
    const scene = useBeforeAll(async () => ({
      shallow: runNest(
        `run_sub_bucket "   " bash -c 'echo "🦺 child"' || exit $?`,
      ),
      deep: runNest(
        `run_sub_bucket "      │  " bash -c 'echo "🦺 child"' || exit $?`,
      ),
    }));

    when('[t0] the same child is framed at two nesting depths', () => {
      then('the frame is drawn at the column it was handed', () => {
        // the nest mirrors the CALL hierarchy, so a grandchild sits a gutter deeper than
        // a child. an indent that was ignored would flatten that hierarchy back into the
        // wall the rule exists to retire.
        expect(scene.shallow.stdout).toContain('   ├─');
        expect(scene.deep.stdout).toContain('      │  ├─');
      });

      then('both depths match snapshot (visual vibecheck)', () => {
        expect({
          shallow: scene.shallow.stdout,
          deep: scene.deep.stdout,
        }).toMatchSnapshot();
      });
    });
  });
});
