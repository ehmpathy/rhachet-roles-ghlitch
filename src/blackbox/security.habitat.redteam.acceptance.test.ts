import { MalfunctionError } from 'helpful-errors';
import { genTempDir, given, then, useBeforeAll, when } from 'test-fns';

import { execSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * .what = acceptance journey for the guardian's security.habitat.redteam skill, through the
 *         built package: rhachet init, then each command a human or a stone runs via `rhx`
 * .why  = the integration suite drives the skill from src against stub peers; this proves the
 *         published role links it, and that every user-faced command (help, plan, init, apply,
 *         the three ward-loop gates, and their belays) renders and exits the same through the
 *         contract a consumer installs
 * .note = the bhrain driver role installs beside the guardian, so apply's bind and the bind
 *         read-back run against the real `rhx route.bind.*` contract: refused on main (a
 *         protected branch), taken on a feature branch. the rewind gate runs the real
 *         `rhx route.stone.set` rewind on a bound route. no network and no peer spend: plan
 *         stops before the spend, and dispatch-lesson runs only on its scan refusal, which
 *         halts before the push
 */

/**
 * .what = run `npx rhx <args>` in a dir; capture both streams and the exit code
 * .why  = a render that moved to stderr, or a run that hangs on a prompt, must fail loud
 */
const runRhx = (input: {
  dir: string;
  args: string[];
  stdin?: string;
}): { exitCode: number; stdout: string; stderr: string } => {
  const run = spawnSync('npx', ['rhx', ...input.args], {
    cwd: input.dir,
    encoding: 'utf8',
    input: input.stdin ?? '',
    timeout: 120_000,
  });

  // a spawn that never ran or a run the timeout killed names its cause, never a null read
  if (run.error || run.status === null)
    throw new MalfunctionError('npx rhx did not exit on its own', {
      args: input.args,
      error: run.error?.message ?? null,
      signal: run.signal,
      hint: 'a timeout (120s) kills the run; check for a prompt that waits on a terminal',
    });
  return {
    exitCode: run.status,
    stdout: run.stdout ?? '',
    stderr: run.stderr ?? '',
  };
};

/**
 * .what = a render as the skill wrote it: rhx's run banner (and the blank around it) dropped,
 *         then the run-specific values masked: the route date and any 12-char sha
 * .why  = the banner is rhx's chrome, not the skill's contract; the snapshot opens on the
 *         skill's own first line
 */
const asRenderMasked = (input: { stdout: string }): string =>
  input.stdout
    .replace(/^\n?🪨 run solid skill [^\n]*\n(?: +└─ [^\n]*\n)?\n?/u, '')
    .replace(/v\d{4}_\d{2}_\d{2}/g, 'v<date>')
    .replace(/\b[0-9a-f]{12}\b/g, '<sha12>');

/**
 * .what = the stderr of a refused run, color codes dropped and ends trimmed
 * .why  = on exit 2, rhx writes its own refusal banner to stderr; the skill writes naught there,
 *         so stderr must equal that banner exactly — any skill render that drifted there reddens
 */
const ANSI_COLOR_CODE: RegExp = new RegExp(
  `${String.fromCharCode(27)}\\[[0-9;]*m`,
  'g',
);
const asStderrPlain = (input: { stderr: string }): string =>
  input.stderr.replace(ANSI_COLOR_CODE, '').trim();
const RHX_REFUSAL_BANNER: string = [
  `🪨 run solid skill repo=ghlitch/role=guardian/skill=security.habitat.redteam`,
  '   └─ ✋ blocked by constraints',
].join('\n');

/**
 * .what = a git habitat with the guardian and the bhrain driver installed, all committed
 * .why  = each given starts from the state a consumer meets after install: a clean tree
 * .note = the base branch is pinned to main whatever the host's default; branch null stays on
 *         main; a branch name checks out that feature branch, where a
 *         real route bind is permitted (rhx route.bind.set refuses a protected branch)
 */
const genInstalledHabitat = (input: {
  slug: string;
  branch: string | null;
}): { dir: string; initOutput: string } => {
  const dir = genTempDir({
    slug: input.slug,
    git: true,
    symlink: [
      { at: 'node_modules', to: 'node_modules' },
      { at: 'package.json', to: 'package.json' },
    ],
  });
  writeFileSync(join(dir, 'seed.txt'), 'seed\n');
  const initOutput = execSync(
    'npx rhachet init --roles ghlitch/guardian bhrain/driver',
    { cwd: dir, encoding: 'utf8', stdio: 'pipe' },
  );
  execSync(
    'git add -A && git -c user.name=Test -c user.email=human@example.com commit -q -m init',
    { cwd: dir },
  );

  // pin the base branch to main: a host's init.defaultBranch (master on some ci runners) must not leak into a render
  execSync('git branch -M main', { cwd: dir });
  if (input.branch)
    execSync(`git checkout -q -b ${input.branch}`, { cwd: dir });
  return { dir, initOutput };
};

/**
 * .what = the one redteam route dir under .behavior/, relative to the habitat
 */
const getRouteDir = (input: { dir: string }): string => {
  const routes = readdirSync(join(input.dir, '.behavior')).filter((name) =>
    name.includes('guardian-redteam'),
  );
  if (routes.length !== 1)
    throw new MalfunctionError('expected one redteam route under .behavior/', {
      routes,
    });
  return `.behavior/${routes[0]}`;
};

/**
 * .what = the backup refs the gate has taken in a habitat, one per line
 * .why  = a refused gate must take no ref; a before/after read proves it
 */
const getBackupRefs = (input: { dir: string }): string =>
  execSync(`git for-each-ref '--format=%(refname)' refs/redteam-backup/`, {
    cwd: input.dir,
    encoding: 'utf8',
  });

const SKILL = 'security.habitat.redteam';

describe('security.habitat.redteam', () => {
  given('[case1] the guardian role installed via rhachet init', () => {
    const scene = useBeforeAll(async () =>
      genInstalledHabitat({
        slug: 'redteam-acceptance-installed',
        branch: null,
      }),
    );

    when('[t0] the human reads what rhachet init linked', () => {
      then('the skill lands in the role dir', () => {
        expect(scene.initOutput).toContain('ghlitch');
        expect(
          existsSync(
            join(
              scene.dir,
              `.agent/repo=ghlitch/role=guardian/skills/${SKILL}.sh`,
            ),
          ),
        ).toBe(true);
      });
    });

    when('[t1] the human asks for help', () => {
      const help = useBeforeAll(async () =>
        runRhx({ dir: scene.dir, args: [SKILL, '--help'] }),
      );
      then('it names every command and grain (exit 0)', () => {
        expect(help.exitCode).toBe(0);
        expect(help.stderr).toEqual('');
        expect(help.stdout).toContain(`rhx ${SKILL} init`);
        expect(help.stdout).toContain(`rhx ${SKILL} backup-before-rewrite`);
        expect(help.stdout).toContain(`${SKILL} dispatch-lesson`);
        expect(help.stdout).toContain(`rhx ${SKILL} rewind-detect`);
        expect(help.stdout).toContain('infil | exfil | leak | all');
        expect(asRenderMasked({ stdout: help.stdout })).toMatchSnapshot();
      });
    });

    when('[t2] the human plans a sweep', () => {
      const plan = useBeforeAll(async () =>
        runRhx({
          dir: scene.dir,
          args: [SKILL, '--scope', '.', '--grain', 'leak', '--mode', 'plan'],
        }),
      );
      then(
        'it names the spend and the outward acts, and stops (exit 0)',
        () => {
          expect(plan.exitCode).toBe(0);
          expect(plan.stderr).toEqual('');
          expect(plan.stdout).toContain('publishes:');
          expect(plan.stdout).toContain('--mode apply');
          expect(asRenderMasked({ stdout: plan.stdout })).toMatchSnapshot();
        },
      );
    });

    when('[t3] the human passes a grain the skill does not know', () => {
      const belay = useBeforeAll(async () =>
        runRhx({
          dir: scene.dir,
          args: [SKILL, '--scope', '.', '--grain', 'bogus', '--mode', 'plan'],
        }),
      );
      then('it belays (exit 2) and names the valid grains', () => {
        expect(belay.exitCode).toBe(2);
        expect(belay.stdout).toContain('✋ ConstraintError');
        expect(belay.stdout).toContain('infil');
        expect(asRenderMasked({ stdout: belay.stdout })).toMatchSnapshot();
      });
    });

    when('[t4] the human omits --scope', () => {
      const belay = useBeforeAll(async () =>
        runRhx({
          dir: scene.dir,
          args: [SKILL, '--grain', 'leak', '--mode', 'plan'],
        }),
      );
      then('it belays (exit 2) and names the absent flag', () => {
        expect(belay.exitCode).toBe(2);
        expect(belay.stdout).toContain('✋ ConstraintError');
        expect(belay.stdout).toContain('--scope');
        expect(asRenderMasked({ stdout: belay.stdout })).toMatchSnapshot();
      });
    });

    when('[t5] the human joins a flag to its value with =', () => {
      const belay = useBeforeAll(async () =>
        runRhx({
          dir: scene.dir,
          args: [SKILL, '--scope', '.', '--grain=leak', '--mode', 'plan'],
        }),
      );
      then('it belays (exit 2) and names the spaced form', () => {
        expect(belay.exitCode).toBe(2);
        expect(belay.stdout).toContain('✋ ConstraintError');
        expect(belay.stdout).toContain('--grain');
        expect(asRenderMasked({ stdout: belay.stdout })).toMatchSnapshot();
      });
    });
  });

  given('[case2] an installed habitat with no route yet', () => {
    const scene = useBeforeAll(async () =>
      genInstalledHabitat({ slug: 'redteam-acceptance-init', branch: null }),
    );

    when('[t0] the human scaffolds a route with no bind', () => {
      const init = useBeforeAll(async () =>
        runRhx({
          dir: scene.dir,
          args: [
            SKILL,
            'init',
            '--scope',
            '.',
            '--grain',
            'leak',
            '--skip-route-bind',
          ],
        }),
      );
      then('the route and its stones land (exit 0)', () => {
        expect(init.exitCode).toBe(0);
        expect(init.stderr).toEqual('');
        expect(init.stdout).toContain('guardian-redteam.grain=leak');
        expect(init.stdout).toContain('1.ground');
        expect(asRenderMasked({ stdout: init.stdout })).toMatchSnapshot();
      });
    });
  });

  given('[case3] an installed habitat on main, with no route bound', () => {
    const scene = useBeforeAll(async () =>
      genInstalledHabitat({
        slug: 'redteam-acceptance-apply-main',
        branch: null,
      }),
    );

    when('[t0] the human applies a sweep on the protected branch', () => {
      const apply = useBeforeAll(async () =>
        runRhx({
          dir: scene.dir,
          args: [SKILL, '--scope', '.', '--grain', 'infil', '--mode', 'apply'],
        }),
      );
      then(
        'the real bind refuses it, and the skill belays (exit 2) with a feature-branch fix',
        () => {
          expect(apply.exitCode).toBe(2);
          expect(apply.stdout).toContain(
            'cannot bind route on protected branch',
          );
          expect(apply.stdout).toContain('check out a feature branch');
          expect(apply.stdout).toContain(
            'not bound: cannot bind route on protected branch; branch: main\n',
          );
          expect(apply.stdout).not.toContain('\u001b[');
          expect(asStderrPlain({ stderr: apply.stderr })).toEqual(
            RHX_REFUSAL_BANNER,
          );
          expect(asRenderMasked({ stdout: apply.stdout })).toMatchSnapshot();
        },
      );
    });
  });

  given(
    '[case4] an installed habitat on a feature branch, with no route bound',
    () => {
      const scene = useBeforeAll(async () =>
        genInstalledHabitat({
          slug: 'redteam-acceptance-apply',
          branch: 'feat/redteam-sweep',
        }),
      );

      when('[t0] the human applies a sweep, which binds its route', () => {
        const apply = useBeforeAll(async () =>
          runRhx({
            dir: scene.dir,
            args: [
              SKILL,
              '--scope',
              '.',
              '--grain',
              'infil',
              '--mode',
              'apply',
            ],
          }),
        );
        then(
          'the route is scaffolded and bound through the real bind contract (exit 0)',
          () => {
            // the whole run rides the assert, so a red names what the bind said
            expect({
              exitCode: apply.exitCode,
              stdout: apply.exitCode === 0 ? '' : apply.stdout,
              stderr: apply.stderr,
            }).toEqual({ exitCode: 0, stdout: '', stderr: '' });
            expect(apply.stdout).toContain('guardian-redteam.grain=infil');
            expect(apply.stdout).toContain('rhx route.drive');
            expect(asRenderMasked({ stdout: apply.stdout })).toMatchSnapshot();
          },
        );
      });
    },
  );

  given(
    '[case5] an installed habitat whose redteam route stands uncommitted',
    () => {
      const scene = useBeforeAll(async () => {
        const habitat = genInstalledHabitat({
          slug: 'redteam-acceptance-backup',
          branch: null,
        });
        // the drive's own route records are the one uncommitted state the gate exempts
        runRhx({
          dir: habitat.dir,
          args: [
            SKILL,
            'init',
            '--scope',
            '.',
            '--grain',
            'leak',
            '--skip-route-bind',
          ],
        });
        return habitat;
      });

      when('[t0] 4.repair runs the backup gate', () => {
        const gate = useBeforeAll(async () =>
          runRhx({ dir: scene.dir, args: [SKILL, 'backup-before-rewrite'] }),
        );
        then(
          'it takes a backup ref and lets the rewrite proceed (exit 0)',
          () => {
            expect(existsSync(join(scene.dir, '.behavior'))).toBe(true);
            expect(gate.exitCode).toBe(0);
            expect(gate.stderr).toEqual('');
            expect(gate.stdout).toContain(
              'backed up — the rewrite may proceed',
            );
            expect(gate.stdout).toContain('refs/redteam-backup/');
            expect(asRenderMasked({ stdout: gate.stdout })).toMatchSnapshot();
          },
        );
      });

      when('[t1] work outside the route stands uncommitted', () => {
        const gate = useBeforeAll(async () => {
          const refsBefore = getBackupRefs({ dir: scene.dir });
          writeFileSync(join(scene.dir, 'seed.txt'), 'seed, edited\n');
          const run = runRhx({
            dir: scene.dir,
            args: [SKILL, 'backup-before-rewrite'],
          });
          return {
            ...run,
            refsBefore,
            refsAfter: getBackupRefs({ dir: scene.dir }),
          };
        });
        then(
          'it refuses (exit 2), names the path, and takes no backup ref',
          () => {
            expect(gate.exitCode).toBe(2);
            expect(gate.stdout).toContain('✋ ConstraintError');
            expect(gate.stdout).toContain('seed.txt');
            expect(gate.refsAfter).toEqual(gate.refsBefore);
            expect(asStderrPlain({ stderr: gate.stderr })).toEqual(
              RHX_REFUSAL_BANNER,
            );
            expect(asRenderMasked({ stdout: gate.stdout })).toMatchSnapshot();
          },
        );
      });
    },
  );

  given('[case6] a bound route with a budget of one cycle', () => {
    const scene = useBeforeAll(async () => {
      const habitat = genInstalledHabitat({
        slug: 'redteam-acceptance-rewind',
        branch: 'feat/redteam-sweep',
      });
      runRhx({
        dir: habitat.dir,
        args: [
          SKILL,
          '--scope',
          '.',
          '--grain',
          'leak',
          '--budget',
          '1',
          '--mode',
          'apply',
        ],
      });
      return { ...habitat, route: getRouteDir({ dir: habitat.dir }) };
    });

    when('[t0] 5.promote asks to rewind after cycle 1', () => {
      const rewind = useBeforeAll(async () =>
        runRhx({
          dir: scene.dir,
          args: [
            SKILL,
            'rewind-detect',
            '--route',
            scene.route,
            '--cycle',
            '1',
          ],
          stdin: 'leak::committed-token\n',
        }),
      );
      then(
        'it refuses as spent (exit 2), rewinds naught, and names the resume',
        () => {
          expect(rewind.exitCode).toBe(2);
          expect(rewind.stdout).toContain('not rewound: budget spent');
          expect(rewind.stdout).toContain('fix: to resume');
          // stderr holds rhx's own refusal banner alone; no skill render moved there
          expect(asStderrPlain({ stderr: rewind.stderr })).toEqual(
            RHX_REFUSAL_BANNER,
          );
          expect(asRenderMasked({ stdout: rewind.stdout })).toMatchSnapshot();
        },
      );
    });

    when('[t1] a cycle number skips ahead of the record', () => {
      const rewind = useBeforeAll(async () =>
        runRhx({
          dir: scene.dir,
          args: [
            SKILL,
            'rewind-detect',
            '--route',
            scene.route,
            '--cycle',
            '3',
          ],
          stdin: 'leak::committed-token\n',
        }),
      );
      then(
        'it refuses as out of order (exit 2) and names the cycle to pass',
        () => {
          expect(rewind.exitCode).toBe(2);
          expect(rewind.stdout).toContain('is out of order');
          expect(rewind.stdout).toContain('fix: pass --cycle 1');
          expect(asStderrPlain({ stderr: rewind.stderr })).toEqual(
            RHX_REFUSAL_BANNER,
          );
          expect(asRenderMasked({ stdout: rewind.stdout })).toMatchSnapshot();
        },
      );
    });
  });

  given('[case7] a bound route with a budget of two cycles', () => {
    const scene = useBeforeAll(async () => {
      const habitat = genInstalledHabitat({
        slug: 'redteam-acceptance-rewind-ok',
        branch: 'feat/redteam-sweep',
      });
      runRhx({
        dir: habitat.dir,
        args: [
          SKILL,
          '--scope',
          '.',
          '--grain',
          'leak',
          '--budget',
          '2',
          '--mode',
          'apply',
        ],
      });
      return { ...habitat, route: getRouteDir({ dir: habitat.dir }) };
    });

    when('[t0] 5.promote asks to rewind after cycle 1', () => {
      const rewind = useBeforeAll(async () =>
        runRhx({
          dir: scene.dir,
          args: [
            SKILL,
            'rewind-detect',
            '--route',
            scene.route,
            '--cycle',
            '1',
          ],
          stdin: 'leak::committed-token\n',
        }),
      );
      then(
        'the real route.stone.set rewinds 2.detect and the cycle record holds the key (exit 0)',
        () => {
          // the whole run rides the assert, so a red names what the rewind said
          expect({
            exitCode: rewind.exitCode,
            stdout: rewind.exitCode === 0 ? '' : rewind.stdout,
            stderr: rewind.stderr,
          }).toEqual({ exitCode: 0, stdout: '', stderr: '' });
          expect(rewind.stdout).toContain('rewound 2.detect');
          expect(
            readFileSync(
              join(scene.dir, scene.route, '.claims/0.cycle.md'),
              'utf8',
            ),
          ).toContain('leak::committed-token');
          expect(asRenderMasked({ stdout: rewind.stdout })).toMatchSnapshot();
        },
      );
    });
  });

  given('[case8] an installed habitat and a lesson to dispatch', () => {
    const scene = useBeforeAll(async () =>
      genInstalledHabitat({
        slug: 'redteam-acceptance-dispatch',
        branch: null,
      }),
    );

    when('[t0] the lesson body carries a live-claim marker', () => {
      const dispatch = useBeforeAll(async () =>
        runRhx({
          dir: scene.dir,
          args: [
            SKILL,
            'dispatch-lesson',
            '--title',
            'exfil: allowlist the egress of a build runner',
          ],
          stdin: 'the gateway at 10.0.4.17 accepts any client\n',
        }),
      );
      then(
        'the scan refuses it (exit 2) and names the marker, before any push',
        () => {
          expect(dispatch.exitCode).toBe(2);
          expect(dispatch.stdout).toContain(
            '✋ ConstraintError: not dispatched',
          );
          expect(dispatch.stdout).toContain('10.0.4.17');
          // stderr holds rhx's own refusal banner alone; no skill render moved there
          expect(asStderrPlain({ stderr: dispatch.stderr })).toEqual(
            RHX_REFUSAL_BANNER,
          );
          expect(asRenderMasked({ stdout: dispatch.stdout })).toMatchSnapshot();
        },
      );
    });

    when('[t1] the lesson has no title', () => {
      const dispatch = useBeforeAll(async () =>
        runRhx({
          dir: scene.dir,
          args: [SKILL, 'dispatch-lesson'],
          stdin: 'a generalized class\n',
        }),
      );
      then('it belays (exit 2) and names --title', () => {
        expect(dispatch.exitCode).toBe(2);
        expect(dispatch.stdout).toContain('✋ ConstraintError');
        expect(dispatch.stdout).toContain('--title');
        expect(asStderrPlain({ stderr: dispatch.stderr })).toEqual(
          RHX_REFUSAL_BANNER,
        );
        expect(asRenderMasked({ stdout: dispatch.stdout })).toMatchSnapshot();
      });
    });
  });
});
