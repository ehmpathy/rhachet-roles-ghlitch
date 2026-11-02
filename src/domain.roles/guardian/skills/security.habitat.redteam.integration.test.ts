import { ConstraintError, MalfunctionError } from 'helpful-errors';
import { genTempDir, given, then, useBeforeAll, when } from 'test-fns';

import { execSync, spawnSync } from 'node:child_process';
import {
  accessSync,
  chmodSync,
  copyFileSync,
  existsSync,
  constants as fsConstants,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, join } from 'node:path';
import {
  asEnvHermetic,
  PATH_WITHOUT_RHX,
  runRoleSkill,
} from '../../.test/runRoleSkill';
import {
  genBrokenToolBin,
  genGuardianStubBinPath,
  genScriptedToolBin,
  getRouteKind,
  maskRouteDate,
  maskSkillPath,
  runGuardianSkill,
  runGuardianSkillOnTerminal,
  runSourcedBash,
} from './.test/runGuardianSkill';

/**
 * .what = render + contract clamps for every critipath of the `security.habitat.redteam`
 *         cli — help, plan, init scaffold, apply handoff, and every belay
 * .why  = a contract surface smoke-tested by hand lets a path like an invalid `--mode`
 *         fall through to a silent exit-0, and leaves no record of what an operator reads
 *         at each belay. this suite makes each path a committed render a reviewer can
 *         vibecheck and a drift reddens.
 *
 *         no mocks (rule.forbid.integration.mocks). the sweep is pure bash over a temp git
 *         habitat; `PATH_WITHOUT_RHX` holds the help/plan/init/belay paths hermetic, and a
 *         guardian-local stub `rhx` answers the one `route.bind.get` probe the apply path
 *         makes, so apply reaches its scaffold + honest-handoff branch with no bound route.
 *
 * .note = the stub stands only for contracts this skill calls and does not own; each owner
 *         proves its own contract with real calls:
 *         - `rhx radio.task.push --via gh.issues` → ehmpathy/rhachet-roles-bhuild
 *           `src/contract/cli/radioTaskPush.integration.test.ts` (real cli, gh.issues auth + gate)
 *         - `rhx route.bind.get|set` → ehmpathy/rhachet-roles-bhrain
 *           `src/domain.operations/route/bind/getRouteBindByBranch.integration.test.ts`,
 *           `src/domain.operations/route/bind/setRouteBind.integration.test.ts`
 *         - `rhx route.stone.set` → ehmpathy/rhachet-roles-bhrain
 *           `src/domain.operations/route/stepRouteStoneSet.integration.test.ts`
 *         this suite clamps what this skill owns: the argv it sends, and its reaction to each
 *         answer (bound, unbound, refused, read-back drift).
 */

const SKILL = 'security.habitat.redteam.sh';
const INIT = 'security.habitat.redteam/init.sh';

// read the route-kind token from output.sh's single source, never a hardcoded literal —
// so a rename of ROUTE_KIND reddens this suite loud rather than silently desyncs it.
const ROUTE_KIND = getRouteKind();

/**
 * .what = rename a habitat's current branch to `main`
 * .why  = the one step that makes a habitat's branch host-independent; named so [case17]
 *         can clamp it on a repo forced onto `master`
 */
const setHabitatBranchMain = (input: { dir: string }): void => {
  execSync('git branch -M main', {
    cwd: input.dir,
    env: asEnvHermetic(),
    timeout: 60_000,
  });
};

/**
 * .what = the `halted:` close line of a render (empty when the render holds none)
 * .why  = a remedy belongs in the `fix:` item, never in the close; a named cut lets a clamp
 *         assert on the close alone
 */
const asHaltedLine = (input: { stdout: string }): string =>
  input.stdout.split('\n').find((line) => line.includes('halted:')) ?? '';

/**
 * .what = a cycle record on disk, under `<dir>/rec/`, with the body given
 * .why  = a record-read clamp needs a known record; a named builder keeps the arrangement
 *         out of the shell expression under test, so each scene reads "stage, then run"
 */
const genCycleRecordFile = (input: {
  dir: string;
  name: string;
  body: string;
}): string => {
  mkdirSync(join(input.dir, 'rec'), { recursive: true });
  const path = join(input.dir, 'rec', input.name);
  writeFileSync(path, input.body);
  return path;
};

/**
 * .what = the ward-loop gate subcommands the skill's help page names
 * .why  = each gate owes every documented help spelling a test; one list keeps the three in step
 */
const GATE_SUBCOMMANDS = [
  'dispatch-lesson',
  'rewind-detect',
  'backup-before-rewrite',
] as const;

/**
 * .what = mask a real mkdir refusal to one vendor-neutral form, whatever its reason
 * .why  = GNU renders `mkdir: cannot create directory 'X': <reason>`, BSD renders
 *         `mkdir: X: <reason>`; LC_ALL=C pins the locale, never the vendor, so a snapshot
 *         of either form would redden on the other host for no change in the skill. the
 *         reason (`File exists`, `No such file or directory`) stays: it is the diagnosis
 */
const asMkdirVendorMasked = (input: { out: string }): string =>
  input.out
    .replace(/mkdir: cannot create directory '([^']*)': /g, 'mkdir: [$1]: ')
    .replace(/mkdir: ([^[\s][^\s]*?): (?=[A-Z])/g, 'mkdir: [$1]: ');

/**
 * .what = a temp git habitat on a branch named `main`, whatever the host's git default
 * .why  = the bind render names the branch; `git init` takes it from the host's
 *         `init.defaultBranch`, so a laptop pinned `main` and a runner rendered `master`
 *         (rule.require.hermetic-tests)
 */
const setupHabitat = (input: { slug: string }): string => {
  const dir = genTempDir({ slug: input.slug, git: true });
  setHabitatBranchMain({ dir });
  return dir;
};

/**
 * .what = git's verdict on one path: the path itself when ignored, `NOT_IGNORED` when tracked
 * .why  = the claims ignore is the linchpin a live claim leans on; a git break must redden
 *         loud, never read as either verdict
 */
const getGitIgnoreVerdict = (input: { cwd: string; path: string }): string => {
  const run = spawnSync('git', ['check-ignore', input.path], {
    cwd: input.cwd,
    env: asEnvHermetic(),
    encoding: 'utf-8',
    timeout: 60_000,
    maxBuffer: 16 * 1024 * 1024,
  });

  // a spawn that never ran, or a git a signal killed, has no verdict to read
  if (run.error || run.status === null)
    throw new MalfunctionError('git check-ignore did not exit on its own', {
      path: input.path,
      error: run.error?.message ?? null,
      signal: run.signal,
      hint: 'a timeout (60s) or an absent git binary stops the run; check `git --version` in the habitat',
    });
  if (run.status === 0) return run.stdout.trim();
  if (run.status === 1) return 'NOT_IGNORED';
  throw new MalfunctionError('git check-ignore broke', {
    path: input.path,
    status: run.status,
    stderr: run.stderr,
    hint: 'run `git check-ignore -v <path>` in the habitat to reproduce; check the temp repo is initialized and readable',
  });
};

/**
 * .what = a copy of a route's stones + guards, minus one file
 * .why  = stages a partial route from node fs, so the fixture reads as data
 */
const genRouteWithFileAbsent = (input: {
  from: string;
  at: string;
  absent: string;
}): string => {
  mkdirSync(input.at, { recursive: true });
  readdirSync(input.from)
    .filter((name) => name.endsWith('.stone') || name.endsWith('.guard'))
    .filter((name) => name !== input.absent)
    .map((name) => copyFileSync(join(input.from, name), join(input.at, name)));
  return input.at;
};

/** locate the scaffolded route dir (its slug carries today's date, the grain, and
 * — for a subtree sweep — a scope token; so match the ROUTE_KIND token anywhere in the
 * slug, the same shape the shell's route probe uses). */
const findRouteDir = (cwd: string): string => {
  const behaviorDir = join(cwd, '.behavior');
  const entries = existsSync(behaviorDir) ? readdirSync(behaviorDir) : [];
  const routes = entries.filter((e) => e.includes(`.${ROUTE_KIND}`));
  // more than one route makes the answer readdir order, not data: refuse, so a second route
  // reddens the case by name rather than stands in for the first
  if (routes.length > 1)
    throw new ConstraintError(
      `more than one ${ROUTE_KIND} route stands; this helper reads one`,
      {
        behaviorDir,
        routes,
        hint: 'name the route the case scaffolded (its grain + scope token) instead',
      },
    );
  const route = routes[0];
  // throw, never fall back — a silent miss would let a scaffold assertion pass over a
  // habitat that was never scaffolded (rule.forbid.failhide).
  if (!route)
    throw new ConstraintError(`no ${ROUTE_KIND} route was scaffolded`, {
      behaviorDir,
      entries,
      hint: 'the init or apply run in this case did not scaffold; read its stdout',
    });
  return join(behaviorDir, route);
};

describe('security.habitat.redteam (contract renders)', () => {
  given('[case1] help is requested', () => {
    const scene = useBeforeAll(async () => {
      const dir = setupHabitat({ slug: 'redteam-help' });
      const run = (args: string) =>
        runGuardianSkill(
          { skill: SKILL, args, cwd: dir },
          { env: { PATH: PATH_WITHOUT_RHX } },
        );
      return {
        bare: run('help'),
        long: run('--help'),
        short: run('-h'),
        initViaMain: run('init --help'),
        initHelpWord: run('init help'),
        initHelpShort: run('init -h'),
        initDirect: runGuardianSkill(
          { skill: INIT, args: '--help', cwd: dir },
          { env: { PATH: PATH_WITHOUT_RHX } },
        ),
        belayNoSeverity: runSourcedBash({
          expression: 'print_belay "a slip" "security.habitat.redteam" ""',
          stdin: '',
          env: {},
        }),
      };
    });

    when('[t4] the grain gloss is read', () => {
      then(
        'exfil names any outbound channel, never only an attacker-driven one',
        () => {
          // self-exfil (the habitat's own channel, no infiltrator) is exfil too; a gloss that
          // says "attacker" teaches the blind spot the exfil grain exists to close
          expect(scene.bare.stdout).toContain(
            'exfil = what can leave, by any outbound channel',
          );
          expect(scene.bare.stdout).not.toContain('attacker can pull out');
        },
      );
    });

    when('[t2] help is asked of the init subcommand', () => {
      then('it renders the init page, the one an init hint points to', () => {
        expect(scene.initViaMain.exitCode).toBe(0);
        expect(scene.initViaMain.stdout).toEqual(scene.initDirect.stdout);
        expect(scene.initViaMain.stdout).toContain(
          '🧿 security.habitat.redteam init — scaffold the ward-loop route',
        );
      });
      then('init help and init -h render the same init page (exit 0)', () => {
        expect(scene.initHelpWord.exitCode).toBe(0);
        expect(scene.initHelpShort.exitCode).toBe(0);
        expect(scene.initHelpWord.stdout).toEqual(scene.initDirect.stdout);
        expect(scene.initHelpShort.stdout).toEqual(scene.initDirect.stdout);
      });
    });

    when('[t3] a belay is printed with no severity named', () => {
      then('it reads as a malfunction, never as a caller fault', () => {
        expect(scene.belayNoSeverity.stdout).toContain('🐈 wet paws...');
        expect(scene.belayNoSeverity.stdout).toContain(
          'halted: 💥 MalfunctionError: a slip',
        );
        expect(scene.belayNoSeverity.stdout).toMatchSnapshot();
      });
    });

    when('[t0] help is the first token', () => {
      then('it exits 0', () => {
        expect(scene.bare.exitCode).toBe(0);
      });

      then('the full help stdout matches snapshot (visual vibecheck)', () => {
        expect(scene.bare.stdout).toContain('--mode plan');
        expect(scene.bare.stdout).toContain('--mode apply');
        expect(scene.bare.stdout).toMatchSnapshot();
      });

      then('it carries the not-security-advice disclaimer', () => {
        expect(scene.bare.stdout).toContain('not professional security advice');
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
  });

  given('[case2] plan mode emits the partition + cost, drives no peer', () => {
    const scene = useBeforeAll(async () => {
      const dir = setupHabitat({ slug: 'redteam-plan' });
      const run = (args: string) =>
        runGuardianSkill(
          { skill: SKILL, args, cwd: dir },
          { env: { PATH: PATH_WITHOUT_RHX } },
        );
      return {
        all: run('--scope . --grain all --peers 6 --budget 3 --mode plan'),
        exfil: run('--scope . --grain exfil --mode plan'),
        // the args rhx prepends on every real call, with and without a value after each
        viaRhx: run(
          '--skill security.habitat.redteam --repo ghlitch --role guardian --scope . --grain exfil --mode plan',
        ),
        viaRhxFinal: run(
          '--scope . --grain exfil --mode plan --repo ghlitch --role',
        ),
        // a passthrough flag right before a skill flag: a blind `shift 2` would eat --scope
        viaRhxFlagNext: run(
          '--repo ghlitch --role --scope . --grain exfil --mode plan',
        ),
        // both counts at COUNT_MAX: the bound exists so the product never wraps
        atCap: run(
          '--scope . --grain all --peers 9999 --budget 9999 --mode plan',
        ),
        // after four clean plans, the habitat holds only what it held before: a plan makes no
        // route, no scope record, and no bind (the stub-free PATH has no rhx to bind with)
        entriesAfter: readdirSync(dir).sort(),
      };
    });

    when('[t3] the plans complete', () => {
      then(
        'the habitat is unwritten: no .behavior/, no route, no record',
        () => {
          expect(scene.entriesAfter).toEqual(['.git']);
        },
      );
    });

    when('[t2] the args rhx prepends ride along', () => {
      then('the plan renders as the bare call does (exit 0)', () => {
        expect(scene.viaRhx.exitCode).toBe(0);
        expect(scene.viaRhx.stdout).toEqual(scene.exfil.stdout);
      });
      then(
        'a passthrough flag that ends the argv neither aborts nor eats a flag',
        () => {
          expect(scene.viaRhxFinal.exitCode).toBe(0);
          expect(scene.viaRhxFinal.stdout).toEqual(scene.exfil.stdout);
        },
      );
      then(
        'a passthrough flag right before a skill flag never eats that flag',
        () => {
          expect(scene.viaRhxFlagNext.exitCode).toBe(0);
          expect(scene.viaRhxFlagNext.stdout).toEqual(scene.exfil.stdout);
        },
      );
    });

    when('[t0] --grain all spreads three disjoint partitions', () => {
      then('it exits 0 and matches snapshot', () => {
        expect(scene.all.exitCode).toBe(0);
        expect(scene.all.stdout).toMatchSnapshot();
      });

      then('the derived peer total + projected cost are printed', () => {
        // 6 peers × 3 grains = 18 blind peers; 18 peers × 3 budget cycles = 54 upper bound.
        // the projection states the arithmetic in one unit (peer-dispatch runs), never a
        // "loop cycles ⇒ peer-runs" unit-mix (rule.require.consistent-skill-contracts).
        expect(scene.all.stdout).toContain('⇒ 18 blind peers total');
        expect(scene.all.stdout).toContain(
          '18 peers × 3 cycles = up to 54 peer-dispatch runs',
        );
      });

      then(
        'the header names the mode, and the plan names the aggregate-map limit before the spend',
        () => {
          // the header is the invocation it renders; the limit is read before any peer runs
          expect(scene.all.stdout).toContain(
            'security.habitat.redteam --mode plan --scope . --grain all',
          );
          expect(scene.all.stdout).toContain(
            'scope limit: blind peers cannot see the aggregate map',
          );
        },
      );

      then('the plan closes on the apply that spends what it priced', () => {
        expect(scene.all.stdout).toContain(
          '└─ next: spend it: rhx security.habitat.redteam --scope . --grain all --peers 6 --budget 3 --mode apply',
        );
      });

      then('all three grain prompts are emitted', () => {
        expect(scene.all.stdout).toContain('infil — "what reaches in');
        expect(scene.all.stdout).toContain('exfil — "what leaves this slice');
        expect(scene.all.stdout).toContain('leak  — "what value on this slice');
      });
    });

    when('[t4] both counts sit at the cap', () => {
      then(
        'the peer total and projection render as whole positive numbers',
        () => {
          // 9999 × 3 grains = 29997 peers; × 9999 cycles = 299940003 runs, far inside 64 bits
          expect(scene.atCap.exitCode).toBe(0);
          expect(scene.atCap.stdout).toContain('⇒ 29997 blind peers total');
          expect(scene.atCap.stdout).toContain(
            '29997 peers × 9999 cycles = up to 299940003 peer-dispatch runs',
          );
          expect(scene.atCap.stdout).toMatchSnapshot();
        },
      );
    });

    when('[t1] a single grain defaults peers=3, budget=1', () => {
      then('it exits 0 and matches snapshot', () => {
        expect(scene.exfil.exitCode).toBe(0);
        expect(scene.exfil.stdout).toMatchSnapshot();
      });

      then('it emits one partition and only the exfil prompt', () => {
        // a count of one reads singular, never `1 partition(s)`
        expect(scene.exfil.stdout).toContain('(1 grain-partition, disjoint');
        expect(scene.exfil.stdout).toContain('budget: 1 loop cycle —');
        expect(scene.exfil.stdout).toContain('exfil — "what leaves this slice');
        expect(scene.exfil.stdout).not.toContain('infil — "what reaches in');
      });
    });
  });

  given('[case3] argument constraints belay before any work', () => {
    const scene = useBeforeAll(async () => {
      const dir = setupHabitat({ slug: 'redteam-belays' });
      const run = (args: string) =>
        runGuardianSkill(
          { skill: SKILL, args, cwd: dir },
          { env: { PATH: PATH_WITHOUT_RHX } },
        );
      return {
        absentScope: run('--grain all --mode plan'),
        scopeNotFound: run('--scope ./nope --grain all --mode plan'),
        absentGrain: run('--scope . --mode plan'),
        invalidGrain: run('--scope . --grain bogus --mode plan'),
        invalidPeers: run('--scope . --grain all --peers 0 --mode plan'),
        invalidBudget: run('--scope . --grain all --budget abc --mode plan'),
        absentMode: run('--scope . --grain all'),
        invalidMode: run('--scope . --grain all --mode bogus'),
        unknownArg: run('--scope . --grain all --mode plan --bogus'),
        joinedFlag: run('--scope=. --grain all --mode plan'),
        flagEatsFlag: run('--scope --grain all --mode plan'),
        grainValueAbsent: run('--scope . --grain --mode plan'),
        initWithMode: run('init --scope . --grain all --mode apply'),
        planSkipBind: run(
          '--scope . --grain all --mode plan --skip-route-bind',
        ),
      };
    });

    when('[t0] --scope is absent', () => {
      then('it is a constraint (exit 2) and matches snapshot', () => {
        expect(scene.absentScope.exitCode).toBe(2);
        expect(scene.absentScope.stdout).toContain(
          'absent required arg: --scope',
        );
        expect(scene.absentScope.stdout).toMatchSnapshot();
      });
    });

    when('[t1] --scope names a path that does not exist', () => {
      then('it names the found-miss and exits 2', () => {
        expect(scene.scopeNotFound.exitCode).toBe(2);
        expect(scene.scopeNotFound.stdout).toContain('scope not found: ./nope');
        expect(scene.scopeNotFound.stdout).toMatchSnapshot();
      });
    });

    when('[t2] --grain is absent', () => {
      then('it names the valid set and exits 2', () => {
        expect(scene.absentGrain.exitCode).toBe(2);
        expect(scene.absentGrain.stdout).toContain(
          'absent required arg: --grain',
        );
        expect(scene.absentGrain.stdout).toMatchSnapshot();
      });
    });

    when('[t3] --grain is not in the enum', () => {
      then('it names the invalid value and exits 2', () => {
        expect(scene.invalidGrain.exitCode).toBe(2);
        expect(scene.invalidGrain.stdout).toContain('invalid grain: bogus');
        expect(scene.invalidGrain.stdout).toMatchSnapshot();
      });
    });

    when('[t4] --peers is not a positive integer', () => {
      then('it exits 2 and names the fix', () => {
        expect(scene.invalidPeers.exitCode).toBe(2);
        expect(scene.invalidPeers.stdout).toContain('invalid --peers: 0');
        expect(scene.invalidPeers.stdout).toMatchSnapshot();
      });
    });

    when('[t5] --budget is not a positive integer', () => {
      then('it exits 2 and names the fix', () => {
        expect(scene.invalidBudget.exitCode).toBe(2);
        expect(scene.invalidBudget.stdout).toContain('invalid --budget: abc');
        expect(scene.invalidBudget.stdout).toMatchSnapshot();
      });
    });

    when('[t6] --mode is absent on a non-init run', () => {
      then('it exits 2 and names the fix', () => {
        expect(scene.absentMode.exitCode).toBe(2);
        expect(scene.absentMode.stdout).toContain(
          'absent required arg: --mode',
        );
        expect(scene.absentMode.stdout).toMatchSnapshot();
      });
    });

    when('[t7] --mode is not in the enum', () => {
      // an invalid --mode must belay (exit 2), never fall through both the plan and apply
      // branches to a silent exit-0 "success" for a run that swept nil.
      then('it belays (exit 2), never a silent exit-0 no-op', () => {
        expect(scene.invalidMode.exitCode).toBe(2);
        expect(scene.invalidMode.stdout).toContain('invalid --mode: bogus');
        expect(scene.invalidMode.stdout).toMatchSnapshot();
      });

      then('it does not emit a plan or a handoff for the bogus mode', () => {
        expect(scene.invalidMode.stdout).not.toContain('chartin course');
        expect(scene.invalidMode.stdout).not.toContain('the ward loop:');
      });
    });

    when('[t8] an unknown or a joined --flag=value argument is passed', () => {
      then('it is a constraint (exit 2) and matches snapshot', () => {
        expect(scene.unknownArg.exitCode).toBe(2);
        expect(scene.unknownArg.stdout).toContain('unknown argument: --bogus');
        expect(scene.unknownArg.stdout).toMatchSnapshot();
      });

      then(
        'a known flag in --flag=value form names the slip and its fix, never "unknown"',
        () => {
          expect(scene.joinedFlag.exitCode).toBe(2);
          expect(scene.joinedFlag.stdout).toContain(
            "flag and value joined by '=': --scope=.",
          );
          expect(scene.joinedFlag.stdout).toContain(
            'fix: pass the value as its own word: --scope .',
          );
          expect(scene.joinedFlag.stdout).not.toContain('unknown argument');
          expect(scene.joinedFlag.stdout).toMatchSnapshot();
        },
      );
    });

    when(
      '[t9] a flag stands where a --scope or --grain value should be',
      () => {
        // require_val must belay about --scope, never let --grain be eaten as its value.
        then('it belays about --scope, not about --grain', () => {
          expect(scene.flagEatsFlag.exitCode).toBe(2);
          expect(scene.flagEatsFlag.stdout).toContain(
            'absent value for --scope',
          );
          expect(scene.flagEatsFlag.stdout).not.toContain('grain');
        });

        then('the belay matches snapshot', () => {
          expect(scene.flagEatsFlag.stdout).toContain(
            'blocked: ✋ ConstraintError',
          );
          expect(scene.flagEatsFlag.stdout).toMatchSnapshot();
        });

        then(
          'a flag where the --grain value should be belays about --grain',
          () => {
            expect(scene.grainValueAbsent.exitCode).toBe(2);
            expect(scene.grainValueAbsent.stdout).toContain(
              'absent value for --grain',
            );
            expect(scene.grainValueAbsent.stdout).toMatchSnapshot();
          },
        );
      },
    );

    when('[t10] init is given a --mode', () => {
      then('it belays (exit 2): init always scaffolds', () => {
        expect(scene.initWithMode.exitCode).toBe(2);
        expect(scene.initWithMode.stdout).toContain(
          'init takes no --mode (it always scaffolds)',
        );
        expect(scene.initWithMode.stdout).toMatchSnapshot();
      });
    });

    when('[t11] plan is given --skip-route-bind', () => {
      then('it belays (exit 2): a plan makes no route', () => {
        expect(scene.planSkipBind.exitCode).toBe(2);
        expect(scene.planSkipBind.stdout).toContain(
          '--skip-route-bind applies to apply and init only (a plan makes no route)',
        );
        expect(scene.planSkipBind.stdout).toMatchSnapshot();
      });
    });
  });

  given(
    '[case29] plan runs from a subtree, or with a scope spelled two ways',
    () => {
      // the plan names its scope relative to the repo root, as apply and init do: a plan run
      // from src/ with --scope . must preview the src slice, never the whole repo. and two
      // spellings of one dir (`.` vs `src/..`, `src/foo` vs `src//foo`) name one slice.
      const scene = useBeforeAll(async () => {
        const dir = setupHabitat({ slug: 'redteam-plan-subtree' });
        mkdirSync(join(dir, 'src', 'foo'), { recursive: true });
        const run = (args: string, cwd: string) =>
          runGuardianSkill(
            { skill: SKILL, args, cwd },
            { env: { PATH: PATH_WITHOUT_RHX } },
          );
        const asSlugs = (scope: string) =>
          runSourcedBash({
            expression: `cd "$ROOT" && get_route_slug infil "$(get_scope_from_repo_root "$SCOPE" "$ROOT")"`,
            stdin: '',
            env: { SCOPE: scope, ROOT: dir },
          });
        return {
          // the temp dir, so a snapped render masks it to `<dir>`
          dir,
          fromSubtree: run(
            '--scope . --grain infil --mode plan',
            join(dir, 'src'),
          ),
          slugDot: asSlugs('.'),
          slugUpDown: asSlugs('src/..'),
          slugFoo: asSlugs('src/foo'),
          slugFooDouble: asSlugs('src//foo'),
          // an absolute scope, and a scope that names a file, each named from the repo root
          absoluteScope: run(
            `--scope ${join(dir, 'src', 'foo')} --grain infil --mode plan`,
            dir,
          ),
          slugAbsolute: asSlugs(join(dir, 'src', 'foo')),
          fileScope: (() => {
            writeFileSync(join(dir, 'src', 'a.ts'), '');
            return run('--scope src/a.ts --grain infil --mode plan', dir);
          })(),
          slugFile: asSlugs('src/a.ts'),
        };
      });

      when('[t2] the scope is absolute, or names a file', () => {
        then('an absolute scope reads as its repo-relative path', () => {
          expect(scene.absoluteScope.exitCode).toBe(0);
          expect(scene.absoluteScope.stdout).toContain('scope: src/foo');
          expect(scene.slugAbsolute.stdout).toEqual(scene.slugFoo.stdout);
          expect(
            scene.absoluteScope.stdout.split(scene.dir).join('<dir>'),
          ).toMatchSnapshot();
        });
        then(
          'a file scope keeps its file name in the scope and the slug',
          () => {
            expect(scene.fileScope.exitCode).toBe(0);
            expect(scene.fileScope.stdout).toContain('scope: src/a.ts');
            expect(scene.slugFile.stdout).toContain('.scope=src__a.ts');
            expect(
              scene.fileScope.stdout.split(scene.dir).join('<dir>'),
            ).toMatchSnapshot();
          },
        );
      });

      when('[t0] plan runs from src/ with --scope .', () => {
        then('it names the scope as src, relative to the repo root', () => {
          expect(scene.fromSubtree.exitCode).toBe(0);
          expect(scene.fromSubtree.stdout).toContain('scope: src');
          expect(scene.fromSubtree.stdout).toMatchSnapshot();
        });
      });

      when('[t1] one dir is spelled two ways', () => {
        then('`src/..` lands the same slug as `.`', () => {
          expect(scene.slugDot.status).toBe(0);
          expect(scene.slugUpDown.stdout).toEqual(scene.slugDot.stdout);
        });

        then('`src//foo` lands the same slug as `src/foo`', () => {
          expect(scene.slugFoo.status).toBe(0);
          expect(scene.slugFooDouble.stdout).toEqual(scene.slugFoo.stdout);
        });
      });
    },
  );

  given(
    '[case4] init scaffolds the route (hermetic, --skip-route-bind)',
    () => {
      const scene = useBeforeAll(async () => {
        const dir = setupHabitat({ slug: 'redteam-init' });
        const viaMain = runGuardianSkill(
          {
            skill: SKILL,
            args: 'init --scope . --grain all --skip-route-bind',
            cwd: dir,
          },
          { env: { PATH: PATH_WITHOUT_RHX } },
        );
        const route = findRouteDir(dir);

        // prove the gitignore by behavior, never by string alone: drop a claim yield into
        // .claims/ and confirm the temp git repo treats it as ignored. this is the security
        // linchpin the whole design leans on (a live claim must never publish) — a string
        // read of the .gitignore cannot prove git actually ignores a dropped claim.
        writeFileSync(
          join(route, '.claims/2.detect.yield.md'),
          '### claim: demo\n- grain: leak\n',
          'utf-8',
        );
        const claimIgnoreCheck = getGitIgnoreVerdict({
          cwd: route,
          path: '.claims/2.detect.yield.md',
        });
        // the flat shape above is not the shape 2.detect actually writes — the stone commits
        // per-grain-namespaced claims at `.claims/{grain}/{peer}.md` (nested). the unanchored
        // `*` covers nested paths, so this is not a live bug — but the whole design leans on
        // "a live claim never publishes", so prove the linchpin at the shape the loop really
        // produces, never only the flat one (rule.require.behavior-intent-coverage).
        mkdirSync(join(route, '.claims', 'leak'), { recursive: true });
        writeFileSync(join(route, '.claims', 'leak', 'peer-01.md'), 'x');
        const nestedClaimIgnoreCheck = getGitIgnoreVerdict({
          cwd: route,
          path: '.claims/leak/peer-01.md',
        });

        // a supplied --peers/--budget must persist into the scope record, never be
        // validated-then-dropped (a silent no-op the operator never sees). scaffold a
        // separate habitat with non-default values and read what landed.
        const paramDir = setupHabitat({ slug: 'redteam-init-params' });
        runGuardianSkill(
          {
            skill: SKILL,
            args: 'init --scope . --grain all --peers 6 --budget 3 --skip-route-bind',
            cwd: paramDir,
          },
          { env: { PATH: PATH_WITHOUT_RHX } },
        );
        const scopeRecord = readFileSync(
          join(findRouteDir(paramDir), '0.scope.md'),
          'utf-8',
        );

        // scope canonicalization: `--scope ./` must land the same route slug as
        // `--scope .` (no .scope= token) and record a canonical `- scope: .`, so a
        // later reuse spelled either way matches the one bound route
        // (as_normalized_scope). without it, `.` and `./` scaffold two routes and a
        // reuse belays a false mismatch.
        const slashDir = setupHabitat({ slug: 'redteam-init-scope-slash' });
        runGuardianSkill(
          {
            skill: SKILL,
            args: 'init --scope ./ --grain all --skip-route-bind',
            cwd: slashDir,
          },
          { env: { PATH: PATH_WITHOUT_RHX } },
        );
        const slashRoute = findRouteDir(slashDir);

        return {
          dir,
          route,
          viaMain,
          rootRouteBase: route.split('/').pop(),
          slashRouteBase: slashRoute.split('/').pop(),
          slashScopeRecord: readFileSync(
            join(slashRoute, '0.scope.md'),
            'utf-8',
          ),
          routeEntries: readdirSync(route).sort(),
          claimsIgnore: readFileSync(
            join(route, '.claims/.gitignore'),
            'utf-8',
          ),
          claimIgnoreCheck,
          nestedClaimIgnoreCheck,
          scopeRecord,
          // content of the two stones whose prose carries a load-bearing, string-checkable
          // contract: promote must name the rewind command (the route is forward-only, so
          // "loop" is inert prose without it), and verify must assign the `critical`
          // severity promote's convergence test keys on.
          promoteStone: readFileSync(join(route, '5.promote.stone'), 'utf-8'),
          verifyStone: readFileSync(join(route, '3.verify.stone'), 'utf-8'),
          detectStone: readFileSync(join(route, '2.detect.stone'), 'utf-8'),
        };
      });

      when('[t0] init runs through the main skill dispatch', () => {
        then('it exits 0 and matches snapshot (date masked)', () => {
          expect(scene.viaMain.exitCode).toBe(0);
          expect(maskRouteDate(scene.viaMain.stdout)).toMatchSnapshot();
        });

        then('the bind is reported as skipped, never faked as bound', () => {
          expect(scene.viaMain.stdout).toContain('skipped (--skip-route-bind)');
        });
      });

      when('[t1] the scaffold lands on disk', () => {
        then('all five stones + five guards are copied', () => {
          expect(scene.routeEntries).toEqual(
            expect.arrayContaining([
              '1.ground.stone',
              // 1.ground.guard is the one stage with no other clamp, so it is
              // asserted explicitly here, never left to
              // an incidental snapshot render — a regression that dropped it would
              // otherwise stay green.
              '1.ground.guard',
              '2.detect.stone',
              '2.detect.guard',
              '3.verify.stone',
              '3.verify.guard',
              '4.repair.stone',
              '4.repair.guard',
              '5.promote.stone',
              '5.promote.guard',
              '0.scope.md',
            ]),
          );
        });

        then(
          'the claims path is self-ignored (live claims never publish)',
          () => {
            expect(scene.claimsIgnore).toContain('*');
            expect(scene.claimsIgnore).toContain('!.gitignore');
          },
        );

        then(
          'a claim yield dropped into .claims/ is actually git-ignored (behavior, not string)',
          () => {
            // git check-ignore echoes the path when it is ignored, else our `|| echo`
            // fires. the security linchpin proven by behavior in the temp git repo.
            expect(scene.claimIgnoreCheck).toBe('.claims/2.detect.yield.md');
          },
        );

        then(
          'a nested per-grain claim (the shape 2.detect really writes) is git-ignored too',
          () => {
            // 2.detect.stone commits `.claims/{grain}/{peer}.md`, not the flat shape
            // above. prove the linchpin at the real nested shape, so a regression that
            // narrowed the ignore to the flat path alone would redden here.
            expect(scene.nestedClaimIgnoreCheck).toBe(
              '.claims/leak/peer-01.md',
            );
          },
        );

        then(
          'the scope record persists a supplied --peers/--budget (never discarded)',
          () => {
            expect(scene.scopeRecord).toContain('- peers: 6');
            expect(scene.scopeRecord).toContain('- budget: 3');
          },
        );

        then(
          'the promote stone names the concrete rewind command (the loop is inert prose without it)',
          () => {
            // the route is forward-only; "loop → go again" is unrunnable unless the stone
            // names the one command that walks it back. a plain string-content fact, as
            // testable as the scope-record assertion above.
            expect(scene.promoteStone).toContain(
              'rhx route.stone.set --stone 2.detect --as rewound',
            );
            expect(scene.promoteStone).toContain(
              'rhx security.habitat.redteam rewind-detect',
            );
          },
        );

        then(
          'the promote stone names the cross-cycle counter by its canonical path',
          () => {
            // a fresh agent context after a rewind finds the cycle spend by convention,
            // never by a per-cycle-invented filename.
            expect(scene.promoteStone).toContain('.claims/0.cycle.md');
          },
        );

        then(
          'the verify stone defines the `critical` severity the promote convergence test keys on',
          () => {
            // promote terminates on "no critical claim left"; verify is where severity is
            // assigned, so the term is operational, never a per-run judgment call.
            expect(scene.verifyStone).toContain('**critical**');
            expect(scene.verifyStone).toContain('severity');
          },
        );

        then(
          'the re-detect trust mechanism is wired: detect re-hunts the carried keys, verify flips them',
          () => {
            // the repair stone marks a fix PENDING-REDETECT; promote's convergence reads
            // "repairs held (re-detect confirmed)". that check is inert unless a stone
            // actually performs it. detect §2.0 must read the carried keys and re-hunt;
            // verify must flip a confirmed-absent key to CLOSED. a string-checkable fact
            // that the wire exists — the mechanism referenced by three stones now has two
            // that execute it.
            expect(scene.detectStone).toContain('PENDING-REDETECT');
            expect(scene.detectStone).toContain('.claims/0.cycle.md');
            expect(scene.detectStone).toContain('REDETECT-ABSENT');
            expect(scene.verifyStone).toContain('REDETECT-ABSENT');
            expect(scene.verifyStone).toContain('CLOSED');
          },
        );
      });

      when('[t2] the surface is spelled ./ rather than .', () => {
        then(
          'it lands the same route slug (no .scope= token) and records a canonical scope',
          () => {
            // `.` and `./` name one surface; normalization makes them one route, so a
            // reuse spelled either way matches (no false mismatch belay).
            expect(scene.slashRouteBase).toBe(scene.rootRouteBase);
            expect(scene.slashRouteBase).not.toContain('.scope=');
            expect(scene.slashScopeRecord).toContain('- scope: .');
          },
        );
      });
    },
  );

  given('[case5] init guards its own args when invoked directly', () => {
    const scene = useBeforeAll(async () => {
      const dir = setupHabitat({ slug: 'redteam-init-guards' });
      const run = (args: string) =>
        runGuardianSkill(
          { skill: INIT, args, cwd: dir },
          { env: { PATH: PATH_WITHOUT_RHX } },
        );
      // a non-git dir, to drive the 'not in a git repository' belay from init's own guard
      const nonGitDir = genTempDir({ slug: 'redteam-init-nongit' });
      const runAt = (cwd: string, args: string) =>
        runGuardianSkill(
          { skill: INIT, args, cwd },
          { env: { PATH: PATH_WITHOUT_RHX } },
        );
      // scaffold once, then a second time into the same habitat to prove idempotency belays
      const first = run('--scope . --grain all --skip-route-bind');
      // drop a sentinel into the first route's in-flight .claims/, then run a second init
      // against the same surface. the atomic clobber guard must refuse (exit 2) and leave
      // the sentinel untouched — proof the second scaffold never overwrote the first's
      // in-flight state (the TOCTOU hazard the atomic mkdir closes).
      const firstRoute = findRouteDir(dir);
      const sentinelPath = join(firstRoute, '.claims/2.detect.yield.md');
      writeFileSync(sentinelPath, '### claim: sentinel\n', 'utf-8');
      const second = run('--scope . --grain all --skip-route-bind');
      const sentinelSurvived = readFileSync(sentinelPath, 'utf-8');
      return {
        sentinelSurvived,
        help: run('help'),
        unknownArg: run('--scope . --grain all --bogus --skip-route-bind'),
        joinedFlag: run('--scope . --grain=all --skip-route-bind'),
        absentGrainValue: run('--grain --skip-route-bind'),
        scopeNotFound: run(
          '--scope ./does-not-exist --grain all --skip-route-bind',
        ),
        invalidPeers: run('--scope . --grain all --peers 0 --skip-route-bind'),
        invalidBudget: run(
          '--scope . --grain all --budget x --skip-route-bind',
        ),
        notInGitRepo: runAt(
          nonGitDir,
          '--scope . --grain all --skip-route-bind',
        ),
        // the rhx prefix, and a passthrough flag that ends the argv: each skips clean
        viaRhx: runAt(
          setupHabitat({ slug: 'redteam-init-viarhx' }),
          '--skill security.habitat.redteam --repo ghlitch --role guardian --scope . --grain leak --skip-route-bind',
        ),
        viaRhxFinal: runAt(
          setupHabitat({ slug: 'redteam-init-viarhx-final' }),
          '--scope . --grain leak --skip-route-bind --role',
        ),
        viaRhxFlagNext: runAt(
          setupHabitat({ slug: 'redteam-init-viarhx-flag-next' }),
          '--role --scope . --grain leak --skip-route-bind',
        ),
        first,
        second,
      };
    });

    when('[t0] init help is requested', () => {
      then('it exits 0', () => {
        expect(scene.help.exitCode).toBe(0);
      });

      then('it renders the init help (snapshot)', () => {
        // snap init's own --help so a drift in what an operator sees on the
        // direct-invocation help reddens like the belay renders around it.
        expect(scene.help.exitCode).toBe(0);
        expect(scene.help.stdout).toContain('exit: 0 = scaffolded');
        expect(scene.help.stdout).toMatchSnapshot();
      });
    });

    when(
      '[t1] an unknown argument or an rhx passthrough flag reaches init',
      () => {
        // an unknown flag must belay, consistent with the parent, never be swallowed silently
        // into a scaffold under the default grain.
        then(
          'it belays (exit 2), never scaffolds under a wrong default',
          () => {
            expect(scene.unknownArg.exitCode).toBe(2);
            expect(scene.unknownArg.stdout).toContain(
              'unknown argument: --bogus',
            );
            // snap the init belay render too, so a drift in what an operator sees on a
            // direct-invocation block reddens like the main-skill belays (case3).
            expect(scene.unknownArg.stdout).toMatchSnapshot();
          },
        );

        then('a --flag=value token names the slip and its fix (exit 2)', () => {
          expect(scene.joinedFlag.exitCode).toBe(2);
          expect(scene.joinedFlag.stdout).toContain(
            'fix: pass the value as its own word: --grain all',
          );
          expect(scene.joinedFlag.stdout).not.toContain('unknown argument');
          expect(scene.joinedFlag.stdout).toMatchSnapshot();
        });

        then(
          'the rhx passthrough prefix is skipped, and init scaffolds',
          () => {
            expect(scene.viaRhx.exitCode).toBe(0);
            expect(scene.viaRhx.stdout).not.toContain('unknown argument');
          },
        );

        then('a passthrough flag that ends the argv never aborts init', () => {
          expect(scene.viaRhxFinal.exitCode).toBe(0);
          expect(scene.viaRhxFinal.stdout).not.toContain('unknown argument');
        });

        then('a passthrough flag right before --scope never eats it', () => {
          expect(scene.viaRhxFlagNext.exitCode).toBe(0);
          expect(scene.viaRhxFlagNext.stdout).not.toContain('unknown argument');
          expect(scene.viaRhxFlagNext.stdout).not.toContain(
            'absent value for --scope',
          );
        });
      },
    );

    when('[t2] --grain is given no value', () => {
      // --scope/--grain must never take $2 unguarded, or a flag becomes the value.
      // require_init_val belays loud.
      then('it belays about the absent value, never mis-scaffolds', () => {
        expect(scene.absentGrainValue.exitCode).toBe(2);
        expect(scene.absentGrainValue.stdout).toContain(
          'absent value for --grain',
        );
        expect(scene.absentGrainValue.stdout).toMatchSnapshot();
      });
    });

    when('[t3] --scope points at a path that does not exist', () => {
      // init.sh added its own existence guard (mirroring the parent skill) so a direct
      // init invocation — a documented, tested path — cannot scaffold a route + 0.scope.md
      // for a surface that was never checked to exist. a direct clamp on that guard.
      then('it belays (exit 2) with scope-not-found, never scaffolds', () => {
        expect(scene.scopeNotFound.exitCode).toBe(2);
        expect(scene.scopeNotFound.stdout).toContain(
          'scope not found: ./does-not-exist',
        );
        expect(maskRouteDate(scene.scopeNotFound.stdout)).toMatchSnapshot();
      });
    });

    when('[t4] --peers is not a positive integer', () => {
      // init's own is_positive_integer guard — a direct init invocation validates
      // --peers too (failfast), and its blocked state is snapped like every other belay.
      then('it belays (exit 2) about invalid --peers, never scaffolds', () => {
        expect(scene.invalidPeers.exitCode).toBe(2);
        expect(scene.invalidPeers.stdout).toContain('invalid --peers: 0');
        expect(scene.invalidPeers.stdout).toMatchSnapshot();
      });
    });

    when('[t5] --budget is not a positive integer', () => {
      then('it belays (exit 2) about invalid --budget, never scaffolds', () => {
        expect(scene.invalidBudget.exitCode).toBe(2);
        expect(scene.invalidBudget.stdout).toContain('invalid --budget: x');
        expect(scene.invalidBudget.stdout).toMatchSnapshot();
      });
    });

    when('[t6] init is invoked outside a git repository', () => {
      // init's git-repo guard — a direct invocation from a non-git dir belays loud
      // rather than scaffold a route that has no branch to bind to.
      then('it belays (exit 2) about the absent git repository', () => {
        expect(scene.notInGitRepo.exitCode).toBe(2);
        expect(scene.notInGitRepo.stdout).toContain('not in a git repository');
        expect(scene.notInGitRepo.stdout).toMatchSnapshot();
      });
    });

    when('[t7] init runs twice for one route on one day', () => {
      then('the first scaffold succeeds', () => {
        expect(scene.first.exitCode).toBe(0);
      });

      then('the second refuses to clobber (exit 2)', () => {
        expect(scene.second.exitCode).toBe(2);
        expect(scene.second.stdout).toContain('already stands today');
        // snap the clobber-refusal render (date-masked — the route slug carries
        // today's date) so this blocked state vibechecks like the rest.
        expect(maskRouteDate(scene.second.stdout)).toMatchSnapshot();
      });

      then(
        "the refused second init leaves the first route's in-flight .claims/ untouched",
        () => {
          // the TOCTOU guarantee: the atomic clobber guard refuses before any scaffold
          // write, so the first sweep's in-flight claim survives intact — the second
          // init never overwrote it.
          expect(scene.sentinelSurvived).toBe('### claim: sentinel\n');
        },
      );
    });
  });

  given(
    '[case6] apply scaffolds + hands off honestly when no route is bound',
    () => {
      const scene = useBeforeAll(async () => {
        const dir = setupHabitat({ slug: 'redteam-apply-handoff' });
        // the guardian stub answers `rhx route.bind.get` with an empty answer (no route bound), so apply
        // reaches its scaffold branch; --skip-route-bind keeps the scaffold unbound, so the
        // honest "not bound — bind before you drive" handoff is the branch observed.
        const run = runGuardianSkill(
          {
            skill: SKILL,
            args: '--scope . --grain exfil --mode apply --skip-route-bind',
            cwd: dir,
          },
          { env: { PATH: genGuardianStubBinPath() } },
        );
        return { run, route: findRouteDir(dir) };
      });

      when('[t0] apply runs with no bound route', () => {
        then(
          'it reaches the handoff (exit 0) and matches snapshot (date masked)',
          () => {
            expect(scene.run.exitCode).toBe(0);
            expect(maskRouteDate(scene.run.stdout)).toMatchSnapshot();
          },
        );

        then('it reports the route scaffolded but not bound', () => {
          expect(scene.run.stdout).toContain('scaffolded, not bound');
        });

        then(
          'it refuses to promise a drive the unbound route cannot take',
          () => {
            expect(scene.run.stdout).toContain('the route is not bound');
            expect(scene.run.stdout).toContain('rhx route.bind.set --route');
            expect(scene.run.stdout).toContain(
              'next: bind it, then drive it: rhx route.bind.set --route',
            );
          },
        );
      });
    },
  );

  given('[case7] apply halts loud when the route probe malfunctions', () => {
    const scene = useBeforeAll(async () => {
      const dir = setupHabitat({ slug: 'redteam-apply-probe-fail' });
      // with rhx OFF PATH, `rhx route.bind.get` cannot run. get_bound_route must surface the
      // probe break as a malfunction (exit 1), never silently read it as "no route bound".
      return runGuardianSkill(
        {
          skill: SKILL,
          args: '--scope . --grain exfil --mode apply',
          cwd: dir,
        },
        { env: { PATH: PATH_WITHOUT_RHX } },
      );
    });

    when('[t0] the bind probe cannot run', () => {
      then('it is a malfunction (exit 1), never a false clean terminal', () => {
        expect(scene.exitCode).toBe(1);
        expect(scene.stdout).toContain('could not probe the bound route');
        expect(maskRouteDate(scene.stdout)).toMatchSnapshot();
      });
    });
  });

  given(
    '[case8] apply reuses a bound route only when its scope+grain match the request',
    () => {
      const scene = useBeforeAll(async () => {
        const dir = setupHabitat({ slug: 'redteam-apply-reuse' });
        // scaffold a route bound (in the stub's eyes) for grain=leak. the stub answers
        // route.bind.get with THIS route path, so apply's route-reuse branch is reached.
        runGuardianSkill(
          {
            skill: INIT,
            args: '--scope . --grain leak --skip-route-bind',
            cwd: dir,
          },
          { env: { PATH: PATH_WITHOUT_RHX } },
        );
        const route = findRouteDir(dir);
        const routeRel = `.behavior/${basename(route)}`;
        const stubPath = genGuardianStubBinPath();
        const runReuse = (grain: string) =>
          runGuardianSkill(
            {
              skill: SKILL,
              args: `--scope . --grain ${grain} --mode apply --skip-route-bind`,
              cwd: dir,
            },
            { env: { PATH: stubPath, STUB_BOUND_ROUTE: routeRel } },
          );
        // capture mismatch + match first, while 0.scope.md is intact
        const mismatch = runReuse('infil'); // grain differs from the bound route's leak
        const match = runReuse('leak'); // grain matches — the reuse is honored
        // the scope half of the match: a route bound for scope=src, asked for scope=.
        const scopeDir = setupHabitat({ slug: 'redteam-apply-reuse-scope' });
        mkdirSync(join(scopeDir, 'src'), { recursive: true });
        runGuardianSkill(
          {
            skill: INIT,
            args: '--scope src --grain leak --skip-route-bind',
            cwd: scopeDir,
          },
          { env: { PATH: PATH_WITHOUT_RHX } },
        );
        const scopeMismatch = runGuardianSkill(
          {
            skill: SKILL,
            args: '--scope . --grain leak --mode apply --skip-route-bind',
            cwd: scopeDir,
          },
          {
            env: {
              PATH: stubPath,
              STUB_BOUND_ROUTE: `.behavior/${basename(findRouteDir(scopeDir))}`,
            },
          },
        );
        // a bind string that points at a route dir that was never created (a deleted dir,
        // a changed checkout) — is_route_on_disk must halt the reuse handoff (exit 1)
        // rather than promise a drive with no route to walk.
        const absentOnDisk = runGuardianSkill(
          {
            skill: SKILL,
            args: '--scope . --grain leak --mode apply --skip-route-bind',
            cwd: dir,
          },
          {
            env: {
              PATH: stubPath,
              STUB_BOUND_ROUTE: `.behavior/v2026_01_01.${ROUTE_KIND}.grain=leak`,
            },
          },
        );
        // then remove the record and re-run — drives the exit-1 malfunction halt in
        // assert_bound_route_matches_request (it cannot read the record to compare).
        rmSync(join(route, '0.scope.md'));
        const unreadableRecord = runReuse('leak');
        return {
          mismatch,
          scopeMismatch,
          match,
          absentOnDisk,
          unreadableRecord,
        };
      });

      when('[t0] the request grain differs from the bound route', () => {
        // apply must not silently drive the wrong surface. it belays,
        // names both sweeps, and exits 2 — never hands the operator a wrong-sweep drive.
        then(
          'it belays (exit 2) and names the mismatch, matches snapshot',
          () => {
            expect(scene.mismatch.exitCode).toBe(2);
            expect(scene.mismatch.stdout).toContain(
              'requested sweep does not match the bound route',
            );
            expect(scene.mismatch.stdout).toContain(
              'bound:     scope=. grain=leak',
            );
            expect(scene.mismatch.stdout).toContain(
              'requested: scope=. grain=infil',
            );
            expect(maskRouteDate(scene.mismatch.stdout)).toMatchSnapshot();
          },
        );
      });

      when('[t1] the request grain matches the bound route', () => {
        then('it reuses the route and hands off (exit 0)', () => {
          expect(scene.match.exitCode).toBe(0);
          expect(scene.match.stdout).toContain('reused the bound route');
          expect(maskRouteDate(scene.match.stdout)).toMatchSnapshot();
        });
      });

      when('[t2] the request scope differs from the bound route', () => {
        // the other half of the guard: one grain, two scopes, still two sweeps
        then('it belays (exit 2) and names both scopes', () => {
          expect(scene.scopeMismatch.exitCode).toBe(2);
          expect(scene.scopeMismatch.stdout).toContain(
            'requested sweep does not match the bound route',
          );
          expect(scene.scopeMismatch.stdout).toContain(
            'bound:     scope=src grain=leak',
          );
          expect(scene.scopeMismatch.stdout).toContain(
            'requested: scope=. grain=leak',
          );
          expect(maskRouteDate(scene.scopeMismatch.stdout)).toMatchSnapshot();
        });
      });

      when("[t3] the bound route's scope record cannot be read", () => {
        // assert_bound_route_matches_request has a malfunction branch — a bound route whose
        // 0.scope.md is absent/garbled cannot be compared, so it must halt (exit 1), never
        // fall through to a wrong-sweep drive on an unreadable record.
        then('it halts (exit 1) and names the unreadable record', () => {
          expect(scene.unreadableRecord.exitCode).toBe(1);
          expect(scene.unreadableRecord.stdout).toContain(
            "could not read the bound route's scope record",
          );
          expect(
            maskRouteDate(scene.unreadableRecord.stdout),
          ).toMatchSnapshot();
        });
      });

      when('[t4] the bind persists but its route dir is gone from disk', () => {
        // is_route_on_disk guards the reuse handoff: a bind string can outlive its route
        // dir, so apply must halt (exit 1) rather than promise a drive with no route to
        // walk (rule.forbid.failhide). the scaffold branch re-probes; this closes the
        // reuse branch's twin gap.
        then(
          'it halts (exit 1) and names the bound route absent on disk',
          () => {
            expect(scene.absentOnDisk.exitCode).toBe(1);
            expect(scene.absentOnDisk.stdout).toContain(
              'bound route is absent on disk',
            );
            expect(maskRouteDate(scene.absentOnDisk.stdout)).toMatchSnapshot();
          },
        );
      });
    },
  );

  given(
    '[case9] apply threads a supplied --peers/--budget into the scaffolded route',
    () => {
      const scene = useBeforeAll(async () => {
        // the vision's primary invocation shape is `--mode apply` directly (never `init`
        // first). apply builds its own init args at a SEPARATE call site from the init
        // subcommand, so a peers/budget drop there would stay green under every other test
        // (case4 proves only the init-subcommand path). drive the apply scaffold with
        // NON-DEFAULT values and read what actually landed in 0.scope.md.
        const dir = setupHabitat({ slug: 'redteam-apply-params' });
        const run = runGuardianSkill(
          {
            skill: SKILL,
            args: '--scope . --grain exfil --peers 5 --budget 2 --mode apply --skip-route-bind',
            cwd: dir,
          },
          { env: { PATH: genGuardianStubBinPath() } },
        );
        const route = findRouteDir(dir);
        return {
          run,
          scopeRecord: readFileSync(join(route, '0.scope.md'), 'utf-8'),
        };
      });

      when('[t0] apply scaffolds with non-default peers/budget', () => {
        then('it reaches the handoff (exit 0)', () => {
          expect(scene.run.exitCode).toBe(0);
        });

        then('the apply render matches snapshot (date masked)', () => {
          expect(scene.run.exitCode).toBe(0);
          expect(scene.run.stdout).toContain('scaffolded, not bound');
          expect(maskRouteDate(scene.run.stdout)).toMatchSnapshot();
        });

        then(
          'the scaffolded 0.scope.md carries the supplied peers/budget (never dropped at the apply call site)',
          () => {
            expect(scene.scopeRecord).toContain('- peers: 5');
            expect(scene.scopeRecord).toContain('- budget: 2');
          },
        );
      });
    },
  );

  given(
    '[case10] a partial scaffold is caught — init verifies the complete required set, not merely a non-empty copy',
    () => {
      // a zero-file copy is not the only broken scaffold. a partial copy (a bad
      // glob, an unreadable or absent template, a damaged install that drops some-but-not-all
      // files) still copied some files, passed the zero-check, printed clean success, bound
      // the route, and handed the operator off to `rhx route.drive` against a route that
      // lacks a stone/guard — a hidden-state hazard that fails the drive partway for an
      // invisible reason. the fix verifies the required set via `get_route_absent_files`.
      const scene = useBeforeAll(async () => {
        const dir = setupHabitat({ slug: 'redteam-partial-scaffold' });
        // a real init lands the complete required set — the positive control that ties
        // REQUIRED_ROUTE_STONES to what the templates actually provide (a drift reddens here).
        runGuardianSkill(
          {
            skill: INIT,
            args: '--scope . --grain all --skip-route-bind',
            cwd: dir,
          },
          { env: { PATH: PATH_WITHOUT_RHX } },
        );
        const completeRoute = findRouteDir(dir);
        // exercise the detection unit init's halt rests on, directly. before the fix this
        // function is absent, so the command errors and the clamp reddens (teeth).
        // the unit must exit 0, or an empty answer could mean "it never ran", not "naught absent"
        const absentOf = (routeDir: string): string => {
          const run = runSourcedBash({
            expression: 'get_route_absent_files "$ROUTE"',
            stdin: '',
            env: { ROUTE: routeDir },
          });
          if (run.status !== 0)
            throw new MalfunctionError(
              'get_route_absent_files did not run clean',
              {
                status: run.status,
                stderr: run.stderr,
                hint: 'source security.habitat.redteam/output.sh, then run `get_route_absent_files <route>` against the scaffolded route to reproduce',
              },
            );
          return run.stdout.trim();
        };
        // a partial route: the complete set, minus one required guard.
        const partial = genRouteWithFileAbsent({
          from: completeRoute,
          at: join(dir, '.partial-route'),
          absent: '3.verify.guard',
        });
        return {
          completeAbsent: absentOf(completeRoute),
          partialAbsent: absentOf(partial),
        };
      });

      when('[t0] the scaffold is complete', () => {
        then(
          'no required file is reported absent (REQUIRED_ROUTE_STONES matches the real scaffold)',
          () => {
            expect(scene.completeAbsent).toEqual('');
          },
        );
      });

      when('[t1] one required guard is absent from the route', () => {
        then(
          'it names exactly the absent guard, so init halts loud rather than hand off a partial route',
          () => {
            expect(scene.partialAbsent).toEqual('3.verify.guard');
          },
        );
      });
    },
  );

  given(
    '[case11] init binds the route (the real bind path, not skipped)',
    () => {
      // every other init path passes --skip-route-bind, so set_route_bind and both of
      // init's post-bind render trees (the success 'bound to branch' item and the
      // BIND_RC=1 'bind did not take' halt) were never exercised. the stub now answers
      // route.bind.set per STUB_BIND_RC, so both the stated bind contract and the
      // exit-1-on-bind-failure guarantee are pinned.
      const scene = useBeforeAll(async () => {
        const okDir = setupHabitat({ slug: 'redteam-init-bind-ok' });
        const failDir = setupHabitat({ slug: 'redteam-init-bind-fail' });
        const bindOk = runGuardianSkill(
          { skill: INIT, args: '--scope . --grain all', cwd: okDir },
          { env: { PATH: genGuardianStubBinPath() } },
        );
        const bindFail = runGuardianSkill(
          { skill: INIT, args: '--scope . --grain all', cwd: failDir },
          {
            env: {
              PATH: genGuardianStubBinPath(),
              STUB_BIND_RC: '1',
            },
          },
        );
        // the real route.bind.set refuses a protected branch as a ConstraintError, under its run
        // banner and in color; init must relay it as the caller's fix (exit 2), in plain text
        const protectedDir = setupHabitat({
          slug: 'redteam-init-bind-protected',
        });
        const bindProtected = runGuardianSkill(
          { skill: INIT, args: '--scope . --grain all', cwd: protectedDir },
          {
            env: {
              PATH: genGuardianStubBinPath(),
              STUB_BIND_RC: '2',
              STUB_BIND_SAID:
                '\\n🪨 run solid skill repo=bhrain/role=driver/skill=route.bind.set\\n\\n└─ ✋ blocked by constraints\\n   └─ \\e[31m✋ ConstraintError: cannot bind route on protected branch\\n\\n      branch: main\\e[0m',
            },
          },
        );
        return { bindOk, bindFail, bindProtected };
      });

      when('[t0] the bind takes', () => {
        then('init exits 0 and reports the route bound to the branch', () => {
          expect(scene.bindOk.exitCode).toBe(0);
          expect(scene.bindOk.stdout).toContain('bound to branch');
          expect(maskRouteDate(scene.bindOk.stdout)).toMatchSnapshot();
        });
      });

      when('[t1] the requested bind does not take', () => {
        then('init halts (exit 1) and names the bind as not taken', () => {
          expect(scene.bindFail.exitCode).toBe(1);
          expect(scene.bindFail.stdout).toContain('not bound');
          expect(scene.bindFail.stdout).toContain('the bind did not take');
          expect(maskRouteDate(scene.bindFail.stdout)).toMatchSnapshot();
        });
      });

      when(
        '[t2] the bind is refused as a constraint (a protected branch)',
        () => {
          then(
            'init belays (exit 2), relays the refusal in plain text, and names the fix',
            () => {
              expect(scene.bindProtected.exitCode).toBe(2);
              expect(scene.bindProtected.stdout).toContain(
                'cause: ✋ ConstraintError: not bound: cannot bind route on protected branch; branch: main\n',
              );
              expect(scene.bindProtected.stdout).toContain(
                '├─ fix: clear what route.bind.set names (on a protected branch, check out a feature branch)',
              );
              expect(scene.bindProtected.stdout).toContain(
                '└─ blocked: ✋ ConstraintError: route scaffolded, but the bind did not take\n',
              );
              expect(scene.bindProtected.stdout).not.toContain(
                'run solid skill',
              );
              expect(scene.bindProtected.stdout).not.toContain('\u001b[');
              expect(
                maskRouteDate(scene.bindProtected.stdout),
              ).toMatchSnapshot();
            },
          );
        },
      );
    },
  );

  given(
    '[case12] the promote stone + guard carry the safety phrases the loop rests on (a prose-drift clamp)',
    () => {
      // the promote stone is an agent-driven prose stone — no deterministic exec path runs
      // it, so a render-audit is the only floor under a silent prose regression (the same
      // backstop cicd.deflake / declapract.upgrade rely on). three
      // safety contracts that live only as stone/guard prose and would rot invisibly if an
      // edit removed them: the fullsun-safe exfil gate + its deterministic scanner backstop,
      // the aggregate-map scope-limit on the verdict, and the budget-out "add budget"
      // escalation. this clamps the SOURCE templates (what ships), so a removed phrase reddens.
      const templatesDir = join(
        __dirname,
        'security.habitat.redteam',
        'templates',
      );
      const scene = useBeforeAll(async () => ({
        promoteStone: readFileSync(
          join(templatesDir, '5.promote.stone'),
          'utf-8',
        ),
        promoteGuard: readFileSync(
          join(templatesDir, '5.promote.guard'),
          'utf-8',
        ),
        repairStone: readFileSync(
          join(templatesDir, '4.repair.stone'),
          'utf-8',
        ),
        repairGuard: readFileSync(
          join(templatesDir, '4.repair.guard'),
          'utf-8',
        ),
        verifyStone: readFileSync(
          join(templatesDir, '3.verify.stone'),
          'utf-8',
        ),
        verifyGuard: readFileSync(
          join(templatesDir, '3.verify.guard'),
          'utf-8',
        ),
        detectGuard: readFileSync(
          join(templatesDir, '2.detect.guard'),
          'utf-8',
        ),
        detectStone: readFileSync(
          join(templatesDir, '2.detect.stone'),
          'utf-8',
        ),
        groundStone: readFileSync(
          join(templatesDir, '1.ground.stone'),
          'utf-8',
        ),
        groundGuard: readFileSync(
          join(templatesDir, '1.ground.guard'),
          'utf-8',
        ),
      }));

      when('[t9] the verify contract is read', () => {
        then(
          'the stone drops each false positive and the guard blocks one kept',
          () => {
            expect(scene.verifyStone).toContain('drop false positives');
            expect(scene.verifyStone).toContain(
              'a peer read is a LEAD, never a verdict',
            );
            expect(scene.verifyStone).toContain(
              'a **fail** is a false positive — drop it',
            );
            expect(scene.verifyGuard).toContain(
              'a false positive kept as a work item',
            );
          },
        );
      });

      when('[t10] the detect claim shape is read', () => {
        then(
          'each claim is a chain keyed on channel + mechanism, and the guard blocks a smell or an unkeyed claim',
          () => {
            expect(scene.detectStone).toContain(
              '## every claim is a CHAIN, never a smell',
            );
            expect(scene.detectStone).toContain(
              'same channel + same mechanism → one claim, merge',
            );
            expect(scene.detectGuard).toContain(
              'a claim is a smell ("this looks risky"), not a chain (channel → mechanism → harm)',
            );
            expect(scene.detectGuard).toContain(
              'a claim has no channel+mechanism key',
            );
          },
        );
      });

      when('[t11] the detect anatomy is read', () => {
        then(
          'each peer hunts via imagination and via cited research, and blend fans both in',
          () => {
            // the value is the AND: instinct catches novel chains, research catches known classes
            expect(scene.detectStone).toContain(
              '### 2.1 detect.via_imagination',
            );
            expect(scene.detectStone).toContain('### 2.2 detect.via_research');
            expect(scene.detectStone).toContain(
              '## 2.3 detect.blend — the TOTAL fan-in',
            );
            expect(scene.detectStone).toContain(
              'cite each source **verbatim via the bhrowser**',
            );
            // a habitat with no bhrowser holds research as uncited leads, never a web fetch
            expect(scene.detectStone).toContain(
              'if the bhrowser itself is absent from this habitat',
            );
            expect(scene.detectStone).toContain(
              'hold each via_research candidate as an UNCITED lead',
            );
            expect(scene.detectStone).toContain(
              '- **within each peer** — its 2.1 + 2.2 findings',
            );
            expect(scene.detectStone).toContain(
              '- **across peers** — merge the claims two peers keyed alike, and link a chain they reached from\n  opposite ends',
            );
            expect(scene.detectGuard).toContain(
              'a research citation came from WebFetch/WebSearch, not a verbatim bhrowser read',
            );
            expect(scene.detectGuard).toContain(
              'a live claim OR a yield that names a claim was written anywhere but the gitignored `.claims/` path',
            );
          },
        );
      });

      when('[t12] the repair re-detect marker is read', () => {
        then(
          'the repair stone writes each fix PENDING-REDETECT by disposition, and the guard blocks a CLOSED or unkeyed one',
          () => {
            // detect + verify read the marker; this pins the stone that writes it
            expect(scene.repairStone).toContain(
              'mark it **PENDING-REDETECT**, never',
            );
            expect(scene.repairStone).toContain(
              '   - status: PENDING-REDETECT (next detect confirms)',
            );
            expect(scene.repairStone).toContain(
              'verify flips it CLOSED only when that re-hunt confirms BOTH:',
            );
            expect(scene.repairStone).toContain(
              '| **own-tree fix** | fix in the repo — close the channel',
            );
            expect(scene.repairStone).toContain(
              '| **redact** | remove the leaked value from HEAD, AND rewrite each local, unpushed commit that carries it',
            );
            expect(scene.repairStone).toContain(
              'a repair runs ONLY inside `--mode apply`',
            );
            expect(scene.repairGuard).toContain(
              'a repair marked CLOSED rather than PENDING-REDETECT',
            );
            expect(scene.repairGuard).toContain(
              "a repair begun before the verify stone's sorted roadmap exists",
            );
            expect(scene.repairGuard).toContain(
              'a repair with no re-detect key',
            );
          },
        );
      });

      when('[t13] the promote + verify guard blockers are read', () => {
        then(
          'false convergence, a live dispatch, an absent verdict or disposition, and a spent loop-back each block',
          () => {
            expect(scene.promoteGuard).toContain(
              'convergence claimed with critical claims still open, or with repairs still PENDING-REDETECT',
            );
            expect(scene.promoteGuard).toContain(
              'a dispatched radio task that carries a path, host, key, or identifier from this tree',
            );
            expect(scene.promoteGuard).toContain(
              'a lesson dispatched that could not have its specifics stripped and its lesson kept',
            );
            expect(scene.promoteGuard).toContain('a terminal verdict absent');
            expect(scene.promoteGuard).toContain(
              'a loop-back decision taken with budget exhausted',
            );
            expect(scene.verifyGuard).toContain(
              'a disposition absent on any verified claim',
            );
          },
        );
      });

      when('[t14] the ground partition axis is read', () => {
        then(
          'the partition cuts by grain-surface, and the guard blocks a directory split',
          () => {
            // a directory split cuts a cross-dir chain so no peer sees it whole
            expect(scene.groundStone).toContain(
              '## the partition — by grain-surface, not by directory',
            );
            expect(scene.groundGuard).toContain(
              'a partition split by top-level directory instead of by grain-surface',
            );
          },
        );
      });

      when('[t15] the rotate disposition is read', () => {
        then(
          'a human runs each revoke or rotate; the guard blocks one the agent ran',
          () => {
            // a revoke reaches outside the habitat and can cut off a live consumer
            expect(scene.repairStone).toContain(
              '🛑 **a human runs it, never the agent**',
            );
            expect(scene.repairStone).toContain(
              '## handed to a human to revoke or rotate (NOT run here)',
            );
            expect(scene.repairStone).toContain(
              'status: open until the human records the command',
            );
            expect(scene.repairGuard).toContain(
              'a revoke or rotate run by the agent at the issuer',
            );
          },
        );
      });

      when('[t16] the infil + exfil frames are read', () => {
        then(
          'exfil spans every exit, not network egress alone; infil spans every inbound channel',
          () => {
            // a narrowed exfil frame would read "no exfil claims" as clean on a smaller scope
            expect(scene.groundStone).toContain(
              '| **exfil** | every outbound channel — NOT just network egress: a DNS lookup',
            );
            expect(scene.groundStone).toContain(
              'EXIF/steganography, a time-based side channel',
            );
            expect(scene.groundStone).toContain(
              '**exfil is every exit, and the creative ones are the point.**',
            );
            expect(scene.groundStone).toContain(
              '| **infil** | every inbound channel — a port, an API, a file upload, a launch flag',
            );
            expect(scene.groundStone).toContain(
              '| **leak** | every exposed value',
            );
            expect(scene.groundStone).toContain(
              '`all` is a shorthand for the three, never a fourth grain',
            );
          },
        );
      });

      when('[t17] the peer blindness contract is read', () => {
        then(
          'each peer gets a fresh context and one confined slice; the guards block an unconfined peer',
          () => {
            // blindness is prompt-enforced: the prose is the only wall, so it is pinned
            expect(scene.detectStone).toContain(
              'fresh context per peer, no shared summary). each peer hunts ITS slice only.',
            );
            expect(scene.detectStone).toContain(
              'blindness held through 2.1 / 2.2; blend is the ONE non-blind join.',
            );
            expect(scene.groundStone).toContain(
              '**blindness + disjointness are PROMPT-enforced, not tool-enforced.**',
            );
            expect(scene.groundGuard).toContain(
              'a peer row with no `confined-to` scope',
            );
            expect(scene.detectGuard).toContain(
              '- slug: has-blind-disjoint-chains',
            );
          },
        );
      });

      when('[t18] the pushed-vs-local split is read', () => {
        then(
          'pushed means a remote ref; a local leak is rewritten, a pushed one rotated; the guards block an --all split',
          () => {
            // --all cannot tell pushed from local: it reads local branches and tags too
            expect(scene.verifyStone).toContain(
              '**pushed = reachable from a remote ref.**',
            );
            expect(scene.verifyStone).toContain(
              '| a local, unpushed commit | yes | no | redact (the history rewrite too) |',
            );
            expect(scene.verifyStone).toContain(
              "| **rotate** | a leaked value already pushed (`git log --remotes -S '<value>'` names a commit)",
            );
            expect(scene.repairStone).toContain(
              'a local one closes once the rewrite leaves no commit that carries it',
            );
            expect(scene.verifyGuard).toContain(
              "a leak's redact-vs-rotate split read from `git log --all` rather than `git log --remotes`",
            );
            expect(scene.repairGuard).toContain(
              "a leak's redact-vs-rotate split read from `git log --all` rather than `git log --remotes`",
            );
          },
        );
      });

      when('[t19] the repair log completeness is read', () => {
        then(
          'every roadmap claim lands in the log under one section, and the guard blocks a dropped one',
          () => {
            // a dropped verified hole would let the loop converge with it still open
            expect(scene.repairStone).toContain(
              '## 4. every roadmap claim lands in the log — none may simply not appear',
            );
            expect(scene.repairStone).toContain(
              '## deferred (NOT repaired this loop)',
            );
            expect(scene.repairStone).toContain(
              'roadmap claims: {N} · logged: {N}',
            );
            expect(scene.repairGuard).toContain(
              "a claim present in `.claims/3.verify.yield.md`'s roadmap (phase 1, phase 2, or do-not-repair) absent from `.claims/4.repair.yield.md`",
            );
            expect(scene.repairGuard).toContain(
              'the final `roadmap claims: N · logged: N` line absent, or its two counts unequal',
            );
          },
        );
      });

      when(
        '[t20] the partition rules and the route-dir exclusion are read',
        () => {
          then(
            'one grain per peer, disjoint, full coverage, within the count, and the route dir never in a slice',
            () => {
              expect(scene.groundStone).toContain(
                '- **one grain per peer.** a peer row serves exactly one grain',
              );
              expect(scene.groundStone).toContain(
                '- **disjoint within a grain.** no two peers of one grain share a path',
              );
              expect(scene.groundStone).toContain(
                "- **full coverage.** each channel the focus-surface maps sits in exactly one peer's slice",
              );
              expect(scene.groundStone).toContain(
                '🛑 **the route dir is never surface.**',
              );
              // only .claims/ is gitignored; every other route sidecar publishes
              expect(scene.groundStone).toContain(
                'so it names a claim by its key, never by its value',
              );
              expect(scene.groundGuard).toContain(
                'two peers of one grain whose `confined-to` globs overlap',
              );
              expect(scene.groundGuard).toContain(
                "a mapped channel in no peer's slice",
              );
              expect(scene.groundGuard).toContain(
                'one peer row asked two grains',
              );
              expect(scene.groundGuard).toContain(
                'a `confined-to` that does not exclude `$route/**`',
              );
              // an out-of-scope read is reportable only if the emit has a field for it
              expect(scene.detectStone).toContain('### out-of-scope reads');
              expect(scene.detectStone).toContain(
                'every re-hunt excludes `$route/**`',
              );
              expect(scene.detectGuard).toContain(
                'the `### out-of-scope reads` section absent',
              );
              expect(scene.detectGuard).toContain(
                'a carried key re-hunted over `$route/**`',
              );
              // a prior or parallel sweep's claims hold values verbatim too: every route's is out
              expect(scene.groundStone).toContain(
                'so each `confined-to` also excludes\n`.behavior/*/.claims/**`',
              );
              expect(scene.groundGuard).toContain(
                "a `confined-to` that does not exclude every route's claims, `.behavior/*/.claims/**`",
              );
              expect(scene.detectStone).toContain(
                "every re-hunt excludes `$route/**` and every route's claims\n  (`.behavior/*/.claims/**`)",
              );
              expect(scene.detectGuard).toContain(
                "or over any route's `.behavior/*/.claims/**`",
              );
              // a history rewrite can drop work no one pushed: backup first, never over a dirty tree
              expect(scene.repairStone).toContain(
                '### a history rewrite — backup first, never over uncommitted work',
              );
              expect(scene.repairStone).toContain(
                'rhx security.habitat.redteam backup-before-rewrite',
              );
              expect(scene.repairStone).toContain(
                '🛑 a rewrite on a branch the gate did not back up in this repair is forbidden',
              );
              expect(scene.repairStone).toContain(
                '- backup: {the refs/redteam-backup/ ref taken before a rewrite',
              );
              expect(scene.repairGuard).toContain(
                'a history rewrite with no `rhx security.habitat.redteam backup-before-rewrite` exit 0 on that branch before it',
              );
              expect(scene.repairGuard).toContain(
                'a history rewrite after the gate exited 2',
              );
              expect(scene.repairGuard).toContain(
                'a backup taken by a hand-run `git branch` or `git update-ref`, not the gate',
              );
              // a failed fetch cannot prove a value unpushed: rotate, never redact
              expect(scene.verifyStone).toContain(
                'read such a value as pushed: rotate',
              );
              expect(scene.verifyGuard).toContain(
                'a redact chosen after a fetch that failed',
              );
              expect(scene.repairGuard).toContain(
                'a redact chosen after a fetch that failed',
              );
            },
          );
        },
      );

      when('[t21] the loop memory across cycles is read', () => {
        then(
          'detect writes fresh, reads the accrued classes and the added surface; the resume names its keys in full',
          () => {
            expect(scene.detectStone).toContain(
              'each cycle writes these files and the yield fresh',
            );
            expect(scene.detectGuard).toContain(
              'a per-peer claim file or yield left from a prior cycle that this cycle did not rewrite',
            );
            // the flywheel: promote writes the list, the next detect reads it
            expect(scene.promoteStone).toContain(
              '## accrued classes\n- {vuln class} — dispatched as: {the lesson title}',
            );
            expect(scene.detectStone).toContain(
              "also read the prior cycle's `## accrued classes` in `.claims/5.promote.yield.md`",
            );
            // a repair that adds surface is hunted next cycle, never left outside every slice
            expect(scene.repairStone).toContain(
              '## surface added (the next detect must hunt it)',
            );
            expect(scene.detectStone).toContain(
              'a surface no slice covers is hunted\napart and named in the yield',
            );
            // keys a peer wrote ride a quoted heredoc: the shell expands naught inside <<'KEYS'
            expect(scene.promoteStone).toContain(
              'rewind-detect --route "$route" --cycle "$cycle" <<\'KEYS\'\n<each open key, one per line>\nKEYS',
            );
            expect(scene.promoteStone).toContain(
              "🛑 **keys ride a quoted heredoc (`<<'KEYS'`), never a command line.**",
            );
            expect(scene.promoteStone).not.toContain(
              '<each open key, one per line> |',
            );
            // the stone names the held push, so an agent never re-dispatches a twin
            expect(scene.promoteStone).toContain('**do not re-dispatch it**');
            // no rewind call, the resume nor the carry gate, pipes a variable the stone never sets
            expect(scene.promoteStone).not.toContain('"$carried_keys"');
            // self-exfil: the habitat's own legitimate exit is the leak
            expect(scene.groundStone).toContain(
              '**self-exfil is the quiet case: no infiltrator at all.**',
            );
          },
        );
      });

      when('[t3] the third-party disposition is read', () => {
        then(
          'the repair stone + guard and the verify guard never let a third-party disclosure be repaired, committed, or filed',
          () => {
            // the mechanism IS the payload: a repair, a commit, or an issue publishes it.
            // the repair stone is the one stone that mutates the tree, so its gate is pinned.
            expect(scene.repairStone).toContain('**NEVER auto-repair.**');
            expect(scene.repairStone).toContain(
              'route to a PRIVATE channel — never an issue, never a commit',
            );
            expect(scene.repairGuard).toContain(
              'a third-party disclosure auto-repaired, committed, or routed to an issue',
            );
            expect(scene.verifyGuard).toContain(
              'a third-party disclosure routed to a repair or an issue instead of a private channel',
            );
          },
        );
      });

      when('[t4] the closure proof is read', () => {
        then('every CLOSED must carry its command and that output', () => {
          // a closure once written from a summary hid a value live three files away
          expect(scene.repairStone).toContain('every CLOSED carries its proof');
          expect(scene.repairStone).toContain('the command that closed it');
          expect(scene.repairStone).toContain("that command's exact output");
          // a pushed leak closes on rotation, never on a clean HEAD; its re-hunt reads history
          expect(scene.repairStone).toContain('| **rotate** |');
          expect(scene.repairStone).toContain("a leak's re-hunt reads history");
          // the re-hunt skips the repair's own backup ref, or a redact could never CLOSE
          const reHunt =
            "git log --exclude='refs/redteam-backup/*' --all -S '<value>'";
          expect(scene.repairStone).toContain(reHunt);
          expect(scene.repairStone).toContain(
            '🛑 never push a `refs/redteam-backup/` ref',
          );
          expect(scene.verifyStone).toContain('| **rotate** |');
          expect(scene.verifyStone).toContain('or when a rotate');
          expect(scene.verifyStone).toContain(reHunt);
          expect(scene.detectStone).toContain("a leak key's");
          expect(scene.detectStone).toContain(reHunt);
          // a rotate or a private route waits on a human: its own bucket, never "add budget"
          expect(scene.promoteStone).toContain(
            '**held on a human** is the third bucket',
          );
          expect(scene.promoteStone).toContain(
            '- held on a human (a rotate that awaits its output · a third-party disclosure routed privately · a rewrite the gate handed to the human): {n}',
          );
          expect(scene.promoteStone).toContain('- human acts owed:');
          // the verdict's state never reads "clean": the aggregate map stays unswept, named
          expect(scene.promoteStone).toContain(
            '- unswept: the aggregate map — no state above reads "clean"',
          );
          // a rewrite the gate refused is held too, never still found
          expect(scene.promoteStone).toContain(
            'a history rewrite the\n  `backup-before-rewrite` gate refused (exit 2) and handed to the human',
          );
          expect(scene.repairStone).toContain(
            '## handed to a human to rewrite (the backup-before-rewrite gate exited 2',
          );
          // a spent budget with no critical open has its own honest state
          expect(scene.promoteStone).toContain(
            'state: {converged | budget-out-with-critical | held-on-human | budget-out-clean}',
          );
          // the fresh hunt skips the backup too, not only the re-detect
          expect(scene.detectStone).toContain(
            "each peer's prompt carries one history rule, for the fresh hunt and the re-detect alike",
          );
          // the sweep commits its own edits before the gate; a value on another ref is the human's
          expect(scene.repairStone).toContain(
            "before the gate, commit this sweep's own edits",
          );
          expect(scene.repairStone).toContain(
            'a redact rewrites the checked-out branch alone',
          );
          // a rotate closes on a recorded proof, and sorts first in phase 1
          expect(scene.verifyStone).toContain('`.claims/rotate.proofs.md`');
          expect(scene.verifyStone).toContain(
            'deadline: {already public|next run|next push} — disposition: {rotate|redact|own-tree fix}',
          );
          // the shell reads the decision by these exact phrases (`^- decision: `, `terminate*`,
          // `escalate the human act`); a reword of the template must redden here, never in a drive
          expect(scene.promoteStone).toContain(
            '- decision: {terminate | loop | terminate + escalate "add budget" | terminate + escalate the human act}',
          );
          // two ends of one chain carry two keys: linked, never merged
          expect(scene.detectStone).toContain(
            "`chain-with: {the other's key}`",
          );
          // every open claim's key carries; convergence reads the whole ledger
          expect(scene.promoteStone).toContain('**every open claim**');
          expect(scene.promoteStone).toContain('the whole carried ledger');
          expect(scene.promoteStone).toContain(
            'never the latest verify yield alone',
          );
          expect(scene.detectStone).toContain(
            'whether or not a fresh peer re-finds it',
          );
          // "add budget" names its resume
          expect(scene.promoteStone).toContain(
            "rhx security.habitat.redteam --scope <the record's scope> --grain <the record's grain> --mode apply --budget <more than the spent allowance>",
          );
          expect(scene.repairGuard).toContain(
            'a repaired claim with no command + output behind it',
          );
          expect(scene.verifyGuard).toContain(
            'a claim marked CLOSED/confirmed with no command + output behind it',
          );
        });
      });

      when('[t5] the permanence-trigger sort is read', () => {
        then(
          'leaks sort by deadline, infil + exfil by blast radius, interleaved only at the end',
          () => {
            expect(scene.verifyStone).toContain(
              '**interleave only at the end**',
            );
            expect(scene.verifyStone).toContain(
              '## phase 1 — leaks + self-exfil, by deadline',
            );
            // self-exfil fires on the habitat's own next run, so it takes the deadline key
            expect(scene.verifyStone).toContain(
              '- **self-exfil** (a legitimate channel of the habitat',
            );
            expect(scene.verifyStone).toContain(
              '## phase 2 — infil + exfil, by blast radius',
            );
            expect(scene.repairStone).toContain('phase 1 leaks first, by');
            expect(scene.repairStone).toContain(
              'phase 2 infil + exfil, by blast radius',
            );
            expect(scene.verifyGuard).toContain(
              'the sort is by SEVERITY, not by the permanence trigger (leaks by deadline, infil+exfil by blast radius)',
            );
            expect(scene.verifyGuard).toContain(
              'leaks and infil/exfil interleaved before the end',
            );
            expect(scene.repairGuard).toContain(
              'a phase-2 blast-radius item repaired before a phase-1 deadline leak',
            );
          },
        );
      });

      when(
        '[t0] the fullsun-safe gate + its deterministic backstop are read',
        () => {
          then(
            'the stone names the fullsun-safe gate and the scanner backstop',
            () => {
              // the dispatch tool is itself an exfil channel; a live claim must never leave.
              // the gate is the judgment; the scanner is the floor under it (necessary, not
              // sufficient) — both must survive, or the exfil irony the wish names re-opens.
              expect(scene.promoteStone).toContain('the fullsun-safe gate');
              expect(scene.promoteStone).toContain(
                'scan_for_live_claim_markers',
              );
              expect(scene.promoteStone).toContain('the scan is a floor');
              expect(scene.promoteStone).toContain(
                'rhx security.habitat.redteam dispatch-lesson',
              );
            },
          );
        },
      );

      when('[t1] the verdict template is read', () => {
        then(
          'it carries the aggregate-map scope-limit (a clean verdict is not "clean")',
          () => {
            // v1 runs blind disjoint peers, so it is blind to the aggregate map (deferred per
            // 2.detect). the verdict must say so, or a human reads "converged" as "clean".
            expect(scene.promoteStone).toContain('scope limit');
            expect(scene.promoteStone).toContain('aggregate map');

            // ground hands the same blind spot forward, so detect knows to flag a suspected map
            expect(scene.groundStone).toContain(
              '**carried forward for detect:**',
            );
            expect(scene.groundStone).toContain(
              'aggregate-map blind spot — no blind slice sees a whole-corpus map',
            );
          },
        );
      });

      when('[t2] the guard enforces the terminal verdict + escalation', () => {
        then(
          'the guard blocks a silent budget-out and a verdict with no disclaimer',
          () => {
            // the guard is what a self-review grades against; these BLOCKER lines are the
            // contract the stone must satisfy. a budget-out with critical claims open must
            // escalate "add budget", never stop silent.
            expect(scene.promoteGuard).toContain('escalate "add budget"');
            expect(scene.promoteGuard).toContain('budget-out-with-critical');
            expect(scene.promoteGuard).toContain(
              'no not-security-advice disclaimer',
            );
          },
        );
      });

      when('[t6] the flywheel accrual is read', () => {
        then(
          'fullsun-safe lessons accrue into the vuln-class corpus, and the guard blocks a skip',
          () => {
            // the flywheel is structural: the next detect stands on what this cycle learned.
            // the route is prose-only, so these phrases are the only floor under the accrual
            expect(scene.promoteStone).toContain(
              'fullsun-safe lessons also accrue into the `inventory.of=vuln.class` corpus',
            );
            expect(scene.promoteStone).toContain(
              'the flywheel, made structural',
            );
            // the corpus ships upstream, so a driver closes the accrual with a yield list
            expect(scene.promoteStone).toContain(
              'so the dispatched lesson IS the accrual: list each class it carries under',
            );
            expect(scene.promoteGuard).toContain(
              "its class absent from the yield's `## accrued classes` list",
            );
            expect(scene.promoteGuard).toContain(
              'a fullsun-safe lesson taught but not accrued into the `inventory.of=vuln.class` corpus',
            );
          },
        );
      });

      when('[t7] the loop rewind contract is read', () => {
        then(
          'the stone names the rewind as idempotent, so a retry re-dispatches no peer',
          () => {
            expect(scene.promoteStone).toContain('the call is idempotent');
            expect(scene.promoteStone).toContain('"already rewound"');
            expect(scene.promoteStone).toContain('- rewound: yes');
          },
        );
      });

      when('[t8] the ground partition contract is read', () => {
        then(
          'blindness is prompt-enforced, and an out-of-scope read is a reportable violation',
          () => {
            // the blind-peer property rests on prose: the tool walls no peer off a slice
            expect(scene.groundStone).toContain(
              'blindness + disjointness are PROMPT-enforced, not tool-enforced',
            );
            expect(scene.groundStone).toContain(
              'read is a reportable violation',
            );
          },
        );

        then(
          'ground emits the yield the grounded-route latch reads, and detect nests claims per grain',
          () => {
            // is_route_grounded reads `.claims/1.ground.yield.md`; a stone that moved its
            // yield would leave the peers-fixed belay inert while every case stays green
            expect(scene.groundStone).toContain(
              'emit into $route/.claims/1.ground.yield.md',
            );
            expect(scene.groundGuard).toContain(
              '$route/.claims/1.ground.yield.md',
            );
            expect(scene.detectStone).toContain(
              '$route/.claims/{grain}/{peer-slug}.md',
            );
            expect(scene.groundGuard).toContain(
              'a peer row with no `confined-to` scope',
            );
            expect(scene.detectGuard).toContain(
              'an out-of-scope read is a reportable violation',
            );
          },
        );
      });
    },
  );

  given(
    '[case13] apply reuse halts loud on a partially-deleted bound route (the complete-set check, not merely non-empty)',
    () => {
      // the reuse-branch twin of case10. is_route_on_disk proves the dir + at
      // least one stone survive; it does not prove the complete required set. a bound route
      // that lost one required file after bind (a checkout change, a manual cleanup) passed
      // is_route_on_disk and the scope-record assert (which reads only 0.scope.md), so apply
      // exited 0 and promised a drive that walks an incomplete route and fails partway for an
      // invisible reason. the fix reuses get_route_absent_files on the reuse path. without it
      // this run returns exit 0 ("reused the bound route") — the teeth.
      const scene = useBeforeAll(async () => {
        const dir = setupHabitat({ slug: 'redteam-reuse-partial' });
        runGuardianSkill(
          {
            skill: INIT,
            args: '--scope . --grain leak --skip-route-bind',
            cwd: dir,
          },
          { env: { PATH: PATH_WITHOUT_RHX } },
        );
        const route = findRouteDir(dir);
        const routeRel = `.behavior/${basename(route)}`;
        // drop one required guard while 0.scope.md + the other stones survive, so the run
        // reaches the reuse completeness gate (never the absent-on-disk or record-read halt).
        rmSync(join(route, '3.verify.guard'));
        const partialReuse = runGuardianSkill(
          {
            skill: SKILL,
            args: '--scope . --grain leak --mode apply --skip-route-bind',
            cwd: dir,
          },
          {
            env: {
              PATH: genGuardianStubBinPath(),
              STUB_BOUND_ROUTE: routeRel,
            },
          },
        );
        return { partialReuse };
      });

      when(
        '[t0] the bound route is on disk but one required file is gone',
        () => {
          then(
            'it halts (exit 1), names the route incomplete, and names the absent file',
            () => {
              expect(scene.partialReuse.exitCode).toBe(1);
              expect(scene.partialReuse.stdout).toContain(
                'bound route is incomplete on disk',
              );
              expect(scene.partialReuse.stdout).toContain('3.verify.guard');
              expect(
                maskRouteDate(scene.partialReuse.stdout),
              ).toMatchSnapshot();
            },
          );
        },
      );
    },
  );

  given(
    '[case14] apply scaffolds and really binds a fresh route (the vision primary shape — no --skip-route-bind)',
    () => {
      // the headline contract + day-in-the-life both run `--mode apply`
      // directly, and the normal success path is no-route-bound → scaffold → a real bind
      // takes → the re-probe returns the new route → apply reports "scaffolded + bound a
      // fresh route" (exit 0). every other apply case drives --skip-route-bind (case6/8/9/13),
      // so this route state and the re-probe-after-real-bind logic were never exercised. the
      // stub models real bind persistence via STUB_BIND_STATE_FILE: the first probe (and
      // init's own rebind check) read an absent file = none bound; init's route.bind.set
      // writes the bound path; the re-probe reads it back = bound. teeth: if the re-probe
      // logic regressed to "scaffolded, not bound" (or dropped the re-probe), this reddens.
      const scene = useBeforeAll(async () => {
        const dir = setupHabitat({ slug: 'redteam-apply-realbind' });
        const bindStateFile = join(dir, '.stub-bind-state');
        const run = runGuardianSkill(
          {
            skill: SKILL,
            args: '--scope . --grain leak --mode apply',
            cwd: dir,
          },
          {
            env: {
              PATH: genGuardianStubBinPath(),
              STUB_BIND_STATE_FILE: bindStateFile,
            },
          },
        );
        return { run };
      });

      when(
        '[t0] no route is bound, so apply scaffolds and the bind takes',
        () => {
          then(
            'it reaches the handoff (exit 0) and reports the route scaffolded + bound',
            () => {
              expect(scene.run.exitCode).toBe(0);
              expect(scene.run.stdout).toContain(
                'scaffolded + bound a fresh route',
              );
              expect(maskRouteDate(scene.run.stdout)).toMatchSnapshot();
            },
          );
        },
      );
    },
  );

  given(
    '[case15] apply scaffolds but the bind fails (init exits non-zero — the halt render)',
    () => {
      // the apply orchestrator halts when init exits non-zero: it surfaces init's own
      // output under a `print_nested_lines` gutter and closes on "halted: the scaffold did
      // not land clean" (exit 1). case11 pins init's own bind-failure render, but drives init.sh
      // directly — apply's halt render around a failed scaffold (the gutter the operator
      // actually sees) was never exercised. drive apply with a real bind (no
      // --skip-route-bind) and STUB_BIND_RC=1, so init's route.bind.set refuses, init
      // exits non-zero, and apply's INIT_RC != 0 halt fires. teeth: if apply dropped the
      // INIT_RC check and inferred "scaffolded" from init's text, this reddens (exit 0).
      const scene = useBeforeAll(async () => {
        const dir = setupHabitat({ slug: 'redteam-apply-bindfail' });
        const run = runGuardianSkill(
          {
            skill: SKILL,
            args: '--scope . --grain leak --mode apply',
            cwd: dir,
          },
          {
            env: {
              PATH: genGuardianStubBinPath(),
              STUB_BIND_RC: '1',
            },
          },
        );
        return { run };
      });

      when(
        '[t0] init cannot bind, so the scaffold does not cleanly land',
        () => {
          then(
            'apply halts (exit 1), surfaces init under the gutter, and names the halt',
            () => {
              expect(scene.run.exitCode).toBe(1);
              expect(scene.run.stdout).toContain('├─ init said');
              expect(scene.run.stdout).toContain(
                'halted: 💥 MalfunctionError: the scaffold did not land clean',
              );
              expect(maskRouteDate(scene.run.stdout)).toMatchSnapshot();
            },
          );
        },
      );
    },
  );

  given('[case16] two scopes that differ only by their path separator', () => {
    // as_route_scope_token folds a subtree path into a route-slug token. a naive
    // collapse maps every non-alnum/dot run to one dash, so `src/foo` and `src-foo`
    // would alias to the identical token `src-foo` — two different surfaces on one
    // route identity. this clamp forces the two tokens apart: it reddens under the
    // pre-fix collapse and passes under the `/ -> __` distinct-encode.
    // a broken source is named as a broken run, never read as an empty token
    const scopeToken = (scope: string): string => {
      const run = runSourcedBash({
        expression: 'as_route_scope_token "$SCOPE"',
        stdin: '',
        env: { SCOPE: scope },
      });
      if (run.status !== 0)
        throw new MalfunctionError('as_route_scope_token did not run clean', {
          scope,
          status: run.status,
          stderr: run.stderr,
          hint: 'source security.habitat.redteam/output.sh, then run as_route_scope_token on this scope to reproduce; check the byte the stderr names',
        });
      return run.stdout.trim();
    };

    const scene = useBeforeAll(async () => ({
      slashToken: scopeToken('src/foo'),
      dashToken: scopeToken('src-foo'),
      underscoreToken: scopeToken('src__foo'),
      spaceToken: scopeToken('foo bar'),
      hyphenToken: scopeToken('foo-bar'),
      endHyphenToken: scopeToken('foo-'),
      bareToken: scopeToken('foo'),
      quoteToken: scopeToken("it's"),
      accentToken: scopeToken('café'),
    }));

    when('[t1] two scopes differ by a byte a collapse would drop', () => {
      then(
        'a space and a hyphen never share a token (other bytes -> _xHH)',
        () => {
          expect(scene.spaceToken).not.toEqual(scene.hyphenToken);
          expect(scene.spaceToken).toEqual('.scope=foo_x20bar');
        },
      );

      then("an apostrophe takes its own escape (' -> _x27)", () => {
        expect(scene.quoteToken).toEqual('.scope=it_x27s');
      });

      then('a non-ascii char encodes byte by byte (é -> _xc3_xa9)', () => {
        expect(scene.accentToken).toEqual('.scope=caf_xc3_xa9');
      });

      then('a hyphen at the end is kept, never trimmed into its stem', () => {
        expect(scene.endHyphenToken).not.toEqual(scene.bareToken);
        expect(scene.endHyphenToken).toEqual('.scope=foo-');
      });
    });

    when('[t0] both are slugified into route-scope tokens', () => {
      then('the two surfaces yield distinct tokens, never one alias', () => {
        expect(scene.slashToken).not.toEqual(scene.dashToken);
      });

      then('the separator is encoded distinctly (/ -> __)', () => {
        expect(scene.slashToken).toEqual('.scope=src__foo');
        expect(scene.dashToken).toEqual('.scope=src-foo');
      });

      then(
        'a literal `__` in a scope cannot alias a `/` (escaped `_` -> `_u`)',
        () => {
          expect(scene.underscoreToken).not.toEqual(scene.slashToken);
          expect(scene.underscoreToken).toEqual('.scope=src_u_ufoo');
        },
      );
    });
  });

  given('[case17] a habitat repo starts on `master`, as on a runner', () => {
    // the bind render names the branch, and `git init` takes it from the host's
    // `init.defaultBranch`: a laptop pinned `main` while a runner rendered `master`, so the
    // [case11] snapshot passed locally and reddened in cicd. this models the runner's repo
    // directly (moved onto `master`), so the clamp bites on any host.
    const getBranch = (cwd: string): string =>
      execSync('git rev-parse --abbrev-ref HEAD', {
        cwd,
        env: asEnvHermetic(),
        timeout: 60_000,
      })
        .toString()
        .trim();

    const scene = useBeforeAll(async () => {
      const dir = genTempDir({ slug: 'redteam-branch-pin', git: true });
      execSync('git branch -M master', { cwd: dir, env: asEnvHermetic() });
      const before = getBranch(dir);
      setHabitatBranchMain({ dir });
      return { before, after: getBranch(dir) };
    });

    when('[t0] the habitat branch pin runs', () => {
      then('the repo started on `master` (control)', () => {
        expect(scene.before).toEqual('master');
      });

      then('the habitat lands on `main`', () => {
        expect(scene.after).toEqual('main');
      });
    });
  });

  given('[case19] the branch is bound to a route of another kind', () => {
    // get_bound_route once recognized only a guardian-redteam path, so a foreign bind read as
    // "none bound" and the scaffold-and-bind path could clobber an unrelated in-flight route.
    // a foreign bind must halt as a constraint; --skip-route-bind (no bind) may proceed.
    const FOREIGN = '.behavior/v2026_01_01.some-other-feature';
    const scene = useBeforeAll(async () => {
      const applyDir = setupHabitat({ slug: 'redteam-foreign-apply' });
      const initDir = setupHabitat({ slug: 'redteam-foreign-init' });
      const skipDir = setupHabitat({ slug: 'redteam-foreign-skip' });
      const envFor = (_cwd: string) => ({
        env: {
          PATH: genGuardianStubBinPath(),
          STUB_BOUND_ROUTE: FOREIGN,
        },
      });
      return {
        apply: runGuardianSkill(
          {
            skill: SKILL,
            args: '--scope . --grain leak --mode apply',
            cwd: applyDir,
          },
          envFor(applyDir),
        ),
        init: runGuardianSkill(
          { skill: INIT, args: '--scope . --grain leak', cwd: initDir },
          envFor(initDir),
        ),
        skip: runGuardianSkill(
          {
            skill: SKILL,
            args: '--scope . --grain leak --mode apply --skip-route-bind',
            cwd: skipDir,
          },
          envFor(skipDir),
        ),
        // get call 1 = apply's probe, 2 = the handoff note's re-probe (init skips its own probe
        // under --skip-route-bind)
        skipNoteBroken: runGuardianSkill(
          {
            skill: SKILL,
            args: '--scope . --grain leak --mode apply --skip-route-bind',
            cwd: setupHabitat({ slug: 'redteam-foreign-skip-note-broken' }),
          },
          {
            env: {
              PATH: genGuardianStubBinPath(),
              STUB_BOUND_ROUTE: FOREIGN,
              STUB_BIND_GET_FAIL_ON: '2',
            },
          },
        ),
      };
    });

    when('[t0] apply runs with no --skip-route-bind', () => {
      then(
        'it belays as a constraint (exit 2) and names the foreign route',
        () => {
          expect(scene.apply.exitCode).toBe(2);
          expect(scene.apply.stdout).toContain(
            `a different route is bound to this branch: ${FOREIGN}`,
          );
          expect(scene.apply.stdout).not.toContain('anchors away!');
        },
      );

      then('the belay matches snapshot (date masked)', () => {
        expect(scene.apply.exitCode).toBe(2);
        expect(maskRouteDate(scene.apply.stdout)).toMatchSnapshot();
      });
    });

    when('[t1] init runs directly', () => {
      then('it belays as a constraint (exit 2) before any scaffold', () => {
        expect(scene.init.exitCode).toBe(2);
        expect(scene.init.stdout).toContain('a different route is bound');
      });

      then(
        'the init render matches snapshot (its own header and gutter)',
        () => {
          expect(scene.init.stdout).toContain(
            '🧿 security.habitat.redteam init',
          );
          expect(maskRouteDate(scene.init.stdout)).toMatchSnapshot();
        },
      );
    });

    when(
      '[t2] apply runs with --skip-route-bind, and its re-probe holds or breaks',
      () => {
        then(
          'it scaffolds unbound and leaves the foreign bind alone (exit 0)',
          () => {
            expect(scene.skip.exitCode).toBe(0);
            expect(scene.skip.stdout).toContain('scaffolded, not bound');
          },
        );
        then(
          'the handoff names the foreign bind it left alone, before the bind it asks for',
          () => {
            // the next step binds the route, which would replace the foreign route the flag kept
            expect(scene.skip.stdout).toContain('⚠️ left the bind alone:');
            expect(scene.skip.stdout).toContain(
              'a bind here replaces it, so finish or unbind it (rhx route.bind.del) first',
            );
            expect(maskRouteDate(scene.skip.stdout)).toMatchSnapshot();
          },
        );
        then(
          'a re-probe that breaks warns that a foreign route may stand, never a silent pass',
          () => {
            // the operator skipped the bind to keep a foreign route; this warn is their only signal
            expect(scene.skipNoteBroken.exitCode).toBe(0);
            expect(scene.skipNoteBroken.stdout).toContain(
              '⚠️ could not re-read the branch bind, so a foreign route may stand:',
            );
            expect(
              maskRouteDate(scene.skipNoteBroken.stdout),
            ).toMatchSnapshot();
          },
        );
      },
    );
  });

  given('[case20] the live-claim scanner reads a drafted lesson body', () => {
    // the fullsun-safe gate's deterministic floor: each marker kind the scanner claims to catch
    // must actually hit, a generalized class must scan clean, and a grep break must read dirty
    // (never clean), since "no lines" is the gate's permission to send a body upstream.
    const SCAN_CASES = [
      {
        description: 'a generalized class scans clean',
        body: 'an egress path with no allowlist lets a compromised host phone home',
        expectHit: null,
      },
      {
        description: 'an ip address is a marker',
        body: 'the box at 10.0.4.17 has open egress',
        expectHit: '10.0.4.17',
      },
      {
        description: 'a repo path is a marker',
        body: 'the grant lives in infra/network/egress.tf',
        expectHit: 'infra/network/egress.tf',
      },
      {
        description: 'a file:line ref is a marker',
        body: 'boot.sh:12 grants control to a remote box',
        expectHit: 'boot.sh:12',
      },
      {
        description: 'an arn is a marker',
        body: 'the role arn:aws:iam::123456789012:role/admin is too broad',
        expectHit: 'arn:aws:iam::123456789012:role/admin',
      },
      {
        description: 'a bare account id is a marker',
        body: 'account 123456789012 holds the bucket',
        expectHit: '123456789012',
      },
      {
        description: 'a key-shaped hex run is a marker',
        body: 'token 0123456789abcdef0123456789abcdef leaked',
        expectHit: '0123456789abcdef0123456789abcdef',
      },
      {
        description: 'a public hostname is a marker',
        body: 'the jump box jumpbox.acme-corp.com forwards agent keys',
        expectHit: 'jumpbox.acme-corp.com',
      },
      {
        description: 'an internal hostname is a marker',
        body: 'the replica prod-db.internal accepts any peer',
        expectHit: 'prod-db.internal',
      },
      {
        description: 'prose with a sentence-end period scans clean',
        body: 'a launch flag that opens a control channel inverts trust. strip it.',
        expectHit: null,
      },
      {
        description:
          'an opaque base64-shaped token (40+ chars, not hex) is a marker',
        body: 'bearer Zm9vYmFyQmF6UXV4K1dpZGdldC9HYWRnZXRGcm9iMTIz== leaked',
        expectHit: 'Zm9vYmFyQmF6UXV4K1dpZGdldC9HYWRnZXRGcm9iMTIz',
      },
      {
        description:
          'a 39-char opaque run stays under the token bound and scans clean',
        body: 'the run abcdefghijABCDEFGHIJabcdefghijABCDEFGHI stands alone',
        expectHit: null,
      },
      {
        description: 'an aws access key id is a marker',
        body: 'the key AKIAABCDEFGHIJKLMNOP was in the env',
        expectHit: 'AKIAABCDEFGHIJKLMNOP',
      },
      {
        description: 'a github token is a marker',
        body: 'the token ghp_abcdefghijklmnopqrstuvwxyz0123456789 was in a log',
        expectHit: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789',
      },
      {
        description: 'an sk- api key is a marker',
        body: 'the key sk-abcdefghij0123456789KLMN was hardcoded',
        expectHit: 'sk-abcdefghij0123456789KLMN',
      },
      {
        description: 'a home path is a marker',
        body: 'the config sits at /home/someone/notes/creds',
        expectHit: '/home/someone/notes/creds',
      },
      {
        description: 'a system-root path is a marker',
        body: 'the proxy reads its allowlist from /etc/squid/allow.list',
        expectHit: '/etc/squid/allow.list',
      },
      {
        description: 'a secret-bearer file name is a marker',
        body: 'the deploy reads prod.env at boot',
        expectHit: 'prod.env',
      },
      {
        description: 'a full ipv6 address is a marker',
        body: 'the host 2001:0db8:85a3:0000:0000:8a2e:0370:7334 answers',
        expectHit: '2001:0db8:85a3:0000:0000:8a2e:0370:7334',
      },
      {
        description: 'a compressed ipv6 address is a marker',
        body: 'the link-local fe80::1 is reachable',
        expectHit: 'fe80::1',
      },
      {
        description: 'a go source file is a marker',
        body: 'the handler in server.go trusts the header',
        expectHit: 'server.go',
      },
      {
        description: 'a tfvars file is a marker',
        body: 'the token sat in prod.tfvars',
        expectHit: 'prod.tfvars',
      },
      {
        description: 'a hostname on a newer tld is a marker',
        body: 'the panel at admin.acme.xyz is open',
        expectHit: 'admin.acme.xyz',
      },
    ];

    const runScan = (input: { body: string; path: string }) =>
      runSourcedBash({
        expression: 'scan_for_live_claim_markers',
        stdin: input.body,
        env: { PATH: input.path },
      });

    const scene = useBeforeAll(async () => {
      // a `grep` that always fails as a real error (rc 2), shadowed ahead of the system one
      const brokenBin = genBrokenToolBin({ tool: 'grep', exitCode: 2 });
      return {
        results: SCAN_CASES.map((thisCase) => ({
          thisCase,
          run: runScan({ body: thisCase.body, path: PATH_WITHOUT_RHX }),
        })),
        broken: runScan({
          body: SCAN_CASES[0]!.body,
          path: `${brokenBin}:${PATH_WITHOUT_RHX}`,
        }),
      };
    });

    when('[t0] each body is scanned', () => {
      SCAN_CASES.map((thisCase, index) =>
        then(thisCase.description, () => {
          const { run } = scene.results[index]!;
          expect(run.status).toBe(0);
          if (thisCase.expectHit === null)
            return expect(run.stdout.trim()).toEqual('');
          expect(run.stdout).toContain(thisCase.expectHit);
        }),
      );
    });

    when('[t1] grep itself breaks (rc 2)', () => {
      then('the scan fails toward dirty: a cause line and rc 1', () => {
        expect(scene.broken.status).toBe(1);
        expect(scene.broken.stdout).toContain(
          'the live-claim scanner broke (grep rc=2) — treat as not fullsun-safe, do not dispatch',
        );
        expect(scene.broken.stdout).toMatchSnapshot();
      });
    });
  });

  given('[case21] a lesson is dispatched upstream through the gate', () => {
    // the scan is a precondition of the push itself: a dirty body must exit 2 with naught
    // sent, and only a clean body reaches `rhx radio.task.push`.
    const runDispatch = (input: {
      title: string;
      body: string;
      pathPrefix: string | null;
      env: Record<string, string>;
      viaCommand?: boolean;
    }) => {
      const dir = genTempDir({ slug: 'redteam-dispatch' });
      const radioLog = join(dir, 'radio.log');
      writeFileSync(radioLog, '');
      const stubPath = genGuardianStubBinPath();
      const run = runSourcedBash({
        // the command form is the path 5.promote names; the sourced form is the gate itself
        expression: input.viaCommand
          ? 'bash --noprofile --norc "$SKILL_SH" dispatch-lesson --title "$LESSON_TITLE"'
          : 'dispatch_fullsun_lesson "$LESSON_TITLE"',
        stdin: input.body,
        env: {
          SKILL_SH: join(__dirname, SKILL),
          PATH: input.pathPrefix ? `${input.pathPrefix}:${stubPath}` : stubPath,
          STUB_RADIO_LOG: radioLog,
          LESSON_TITLE: input.title,
          ...input.env,
        },
      });
      return { run, sent: readFileSync(radioLog, 'utf-8') };
    };
    const CLEAN_BODY =
      'an egress path with no allowlist lets a compromised host phone home';

    const scene = useBeforeAll(async () => ({
      clean: runDispatch({
        title: 'egress with no allowlist',
        body: CLEAN_BODY,
        pathPrefix: null,
        env: {},
      }),
      dirtyBody: runDispatch({
        title: 'egress with no allowlist',
        body: 'the box at 10.0.4.17 has open egress',
        pathPrefix: null,
        env: {},
      }),
      dirtyTitle: runDispatch({
        title: 'open egress in infra/main.tf',
        body: CLEAN_BODY,
        pathPrefix: null,
        env: {},
      }),
      // a marker deep in a multi-line body: the render names the body line it sits on
      dirtyBodyDeep: runDispatch({
        title: 'egress with no allowlist',
        body: `${CLEAN_BODY}\nthe fix is an allowlist\nthe box at 10.0.4.17 had it open`,
        pathPrefix: null,
        env: {},
      }),
      blankTitleViaCommand: runDispatch({
        title: '   ',
        body: CLEAN_BODY,
        pathPrefix: null,
        env: {},
        viaCommand: true,
      }),
      scannerBroke: runDispatch({
        title: 'egress with no allowlist',
        body: CLEAN_BODY,
        pathPrefix: genBrokenToolBin({ tool: 'grep', exitCode: 2 }),
        env: {},
      }),
      pushRefused: runDispatch({
        title: 'egress with no allowlist',
        body: CLEAN_BODY,
        pathPrefix: null,
        env: { STUB_RADIO_RC: '1' },
      }),
      // radio.uses blocks the push: the record is held QUEUED (exit 2), never lost
      pushHeld: runDispatch({
        title: 'egress with no allowlist',
        body: CLEAN_BODY,
        pathPrefix: null,
        env: { STUB_RADIO_RC: '2' },
      }),
      cleanViaCommand: runDispatch({
        title: 'egress with no allowlist',
        body: CLEAN_BODY,
        pathPrefix: null,
        env: {},
        viaCommand: true,
      }),
      dirtyViaCommand: runDispatch({
        title: 'egress with no allowlist',
        body: 'the box at 10.0.4.17 has open egress',
        pathPrefix: null,
        env: {},
        viaCommand: true,
      }),
      // no --title at all; the radio log is staged and read back, so `sent` is observed
      untitledViaCommand: (() => {
        const radioLog = join(
          genTempDir({ slug: 'redteam-dispatch-untitled' }),
          'radio.log',
        );
        writeFileSync(radioLog, '');
        const run = runSourcedBash({
          expression: 'bash --noprofile --norc "$SKILL_SH" dispatch-lesson',
          stdin: CLEAN_BODY,
          env: {
            SKILL_SH: join(__dirname, SKILL),
            PATH: genGuardianStubBinPath(),
            STUB_RADIO_LOG: radioLog,
          },
        });
        return { run, sent: readFileSync(radioLog, 'utf-8') };
      })(),
    }));

    when(
      '[t5] 5.promote dispatches through the `dispatch-lesson` command',
      () => {
        then('a clean body is pushed (exit 0), the same gate', () => {
          expect(scene.cleanViaCommand.run.status).toBe(0);
          expect(scene.cleanViaCommand.sent).toContain('--idem findsert');
        });
        then('a dirty body exits 2 and sends naught', () => {
          expect(scene.dirtyViaCommand.run.status).toBe(2);
          expect(scene.dirtyViaCommand.sent).toEqual('');
        });
        then('a blank --title belays (exit 2), sends naught, snapped', () => {
          expect(scene.blankTitleViaCommand.run.status).toBe(2);
          expect(scene.blankTitleViaCommand.run.stdout).toContain(
            'blank --title (only whitespace)',
          );
          expect(scene.blankTitleViaCommand.sent).toEqual('');
          expect(scene.blankTitleViaCommand.run.stdout).toMatchSnapshot();
        });
        then('a marker on body line 3 is named at body line 3', () => {
          expect(scene.dirtyBodyDeep.run.status).toBe(2);
          expect(scene.dirtyBodyDeep.run.stdout).toContain(
            'body line 3: 10.0.4.17',
          );
          expect(scene.dirtyBodyDeep.sent).toEqual('');
          expect(scene.dirtyBodyDeep.run.stdout).toMatchSnapshot();
        });
        then('an absent --title belays (exit 2) with its fix', () => {
          expect(scene.untitledViaCommand.run.status).toBe(2);
          expect(scene.untitledViaCommand.sent).toEqual('');
          expect(scene.untitledViaCommand.run.stdout).toContain(
            'absent required arg: --title',
          );
          expect(scene.untitledViaCommand.run.stdout).toMatchSnapshot();
        });
      },
    );

    when('[t0] the body is a generalized class', () => {
      then('it is pushed to the role-package upstream', () => {
        expect(scene.clean.run.status).toBe(0);
        expect(scene.clean.sent).toContain(
          '--into ehmpathy/rhachet-roles-ghlitch',
        );
        expect(scene.clean.sent).toContain('egress with no allowlist');
        expect(scene.clean.run.stdout).toContain(
          'dispatched to ehmpathy/rhachet-roles-ghlitch',
        );
        expect(scene.clean.run.stdout).toMatchSnapshot();
      });

      then(
        'it is a findsert on the title, so a later cycle opens no twin',
        () => {
          expect(scene.clean.sent).toContain('--idem findsert');
        },
      );
    });

    when('[t1] the body carries a live-claim marker', () => {
      then('it exits 2, names the marker, and sends naught', () => {
        expect(scene.dirtyBody.run.status).toBe(2);
        expect(scene.dirtyBody.run.stdout).toContain(
          '✋ ConstraintError: not dispatched',
        );
        expect(scene.dirtyBody.run.stdout).toContain('10.0.4.17');
        expect(scene.dirtyBody.sent).toEqual('');
      });

      then('the refusal matches snapshot', () => {
        expect(scene.dirtyBody.run.stdout).toContain(
          'keep this lesson in .claims/',
        );
        expect(scene.dirtyBody.run.stdout).toMatchSnapshot();
      });
    });

    when('[t3] the scanner itself breaks (grep rc 2)', () => {
      then('it halts as a malfunction (exit 1) and sends naught', () => {
        expect(scene.scannerBroke.run.status).toBe(1);
        expect(scene.scannerBroke.run.stdout).toContain(
          '💥 MalfunctionError: not dispatched — the live-claim scanner broke; naught was sent',
        );
        expect(scene.scannerBroke.sent).toEqual('');
        expect(scene.scannerBroke.run.stdout).toMatchSnapshot();
      });
    });

    when('[t4] the push itself is refused', () => {
      then('it halts as a malfunction (exit 1) and names the cause', () => {
        expect(scene.pushRefused.run.status).toBe(1);
        expect(scene.pushRefused.run.stdout).toContain(
          '💥 MalfunctionError: not dispatched — the push broke',
        );
        expect(scene.pushRefused.run.stdout).toContain(
          'stub rhx: radio.task.push refused',
        );
        expect(scene.pushRefused.run.stdout).toMatchSnapshot();
      });
      then(
        'a push held QUEUED (exit 2) reads as held, never a break, and asks for no re-dispatch',
        () => {
          // a re-dispatch under a reworded title would queue a twin of the held lesson
          expect(scene.pushHeld.run.status).toBe(2);
          expect(scene.pushHeld.run.stdout).toContain(
            'held, not yet sent — radio.uses blocks the push',
          );
          expect(scene.pushHeld.run.stdout).toContain(
            'do not re-dispatch — the lesson waits QUEUED',
          );
          expect(scene.pushHeld.run.stdout).not.toContain('the push broke');
          expect(scene.pushHeld.run.stdout).toMatchSnapshot();
        },
      );
    });

    when('[t2] the title carries a live-claim marker', () => {
      then('it exits 2, names the marker, and sends naught', () => {
        expect(scene.dirtyTitle.run.status).toBe(2);
        expect(scene.dirtyTitle.run.stdout).toContain('infra/main.tf');
        expect(scene.dirtyTitle.sent).toEqual('');
        expect(scene.dirtyTitle.run.stdout).toMatchSnapshot();
      });
    });
  });

  given('[case22] a concurrent init binds the branch first', () => {
    // two inits on one branch both pass the "none bound" probe and both bind; the bind slot
    // holds whichever landed last. the loser must read the bind back and halt loud, never
    // report "bound" while a later route.drive drives the other route.
    const WINNER = `.behavior/v2026_01_01.${ROUTE_KIND}.grain=infil`;
    const scene = useBeforeAll(async () => {
      const dir = setupHabitat({ slug: 'redteam-bind-race' });
      return runGuardianSkill(
        { skill: INIT, args: '--scope . --grain leak', cwd: dir },
        {
          env: {
            PATH: genGuardianStubBinPath(),
            STUB_BIND_RACE_ROUTE: WINNER,
          },
        },
      );
    });

    when('[t0] init reads its bind back', () => {
      then('it halts as a malfunction (exit 1) and names the winner', () => {
        expect(scene.exitCode).toBe(1);
        expect(scene.stdout).toContain(
          `not bound: the branch reads back bound to ${WINNER}; a concurrent bind won`,
        );
        expect(scene.stdout).not.toContain('bound to branch');
      });

      then(
        'it names its own orphaned route dir, so a human can find it',
        () => {
          expect(scene.stdout).toMatch(
            /this route stands orphaned at \.behavior\/\S+\.grain=leak/,
          );
        },
      );

      then('the halt matches snapshot (date masked)', () => {
        expect(scene.stdout).toContain('halted: 💥 MalfunctionError');
        expect(maskRouteDate(scene.stdout)).toMatchSnapshot();
      });
    });
  });

  given(
    '[case23] the ward loop rewinds 2.detect through the carry gate',
    () => {
      // the convergence proof rests on the carried PENDING-REDETECT keys. the rewind may or may
      // not archive `.claims/`, so the gate must carry the keys before it, re-carry them after
      // it, and read them back — a lost key halts loud, never drops silent.
      const KEYS =
        'infil::launch-flag-control-channel\nexfil::egress-without-allowlist';
      const runRewind = (input: {
        slug: string;
        budget: number | string | null;
        cycle: number;
        recordPrior: string | null;
        env: Record<string, string>;
        damage?:
          | 'claims-file'
          | 'stale-lock'
          | 'unrecorded-lock'
          | 'unreadable-lock'
          | null;
        prelude?: string;
        pathPrefix?: string | null;
        viaCommand?: boolean;
        keys?: string;
        scopeRecord?: string;
      }) => {
        // the command form anchors at a repo root and checks the route stands, as a real drive does
        const dir = genTempDir({
          slug: input.slug,
          git: input.viaCommand ?? false,
        });
        const route = join(
          dir,
          '.behavior',
          'v2026_01_01.guardian-redteam.loop',
        );
        mkdirSync(route, { recursive: true });
        // the command form refuses a partial route, so it gets the whole stone + guard set
        if (input.viaCommand) {
          const templates = join(
            __dirname,
            'security.habitat.redteam',
            'templates',
          );
          readdirSync(templates).map((name) =>
            copyFileSync(join(templates, name), join(route, name)),
          );
        }
        if (input.damage === 'claims-file')
          writeFileSync(join(route, '.claims'), 'not a dir\n');
        if (input.damage !== 'claims-file')
          mkdirSync(join(route, '.claims'), { recursive: true });
        // a holder pid that is surely gone: the pid of a process that already exited, never a
        // hardcoded number some live process on the host could hold. a reaped pid may be handed
        // to the next process, so a pid that reads live is re-drawn, a bounded few times, and
        // only a host that recycles every draw fails loud
        const isPidLive = (pid: string): boolean =>
          assureSpawnRan({
            run: spawnSync(
              'bash',
              ['--noprofile', '--norc', '-c', `kill -0 ${pid}`],
              { env: { ...asEnvHermetic(), PATH: PATH_WITHOUT_RHX } },
            ),
            what: `kill -0 ${pid}`,
          }).status === 0;
        const genPidGone = (drawsLeft: number): string | null => {
          const pid = String(
            assureSpawnRan({ run: spawnSync('true'), what: 'true' }).pid,
          );
          if (!isPidLive(pid)) return pid;
          return drawsLeft > 1 ? genPidGone(drawsLeft - 1) : null;
        };
        const pidDrawn = genPidGone(5);
        if (input.damage === 'stale-lock' && pidDrawn === null)
          throw new ConstraintError(
            'the stale-lock fixture drew 5 exited pids and the host recycled each into a live process',
            {
              hint: 're-run the suite on a quieter host; the pid churn outran the draw',
            },
          );
        const pidGone = pidDrawn ?? '';
        if (input.damage === 'stale-lock') {
          mkdirSync(join(route, '.claims', '0.cycle.md.lock'));
          writeFileSync(
            join(route, '.claims', '0.cycle.md.lock', 'holder'),
            pidGone,
          );
        }
        // a lock some write left with no holder named
        if (input.damage === 'unrecorded-lock')
          mkdirSync(join(route, '.claims', '0.cycle.md.lock'));
        // a lock whose holder cannot be read: a dir where the pid file goes, so the read
        // breaks the same way under any uid
        if (input.damage === 'unreadable-lock')
          mkdirSync(join(route, '.claims', '0.cycle.md.lock', 'holder'), {
            recursive: true,
          });
        // a hand-written record stands in for the canonical one, to reach a damaged-record arm
        if (input.scopeRecord !== undefined)
          writeFileSync(join(route, '0.scope.md'), input.scopeRecord);
        if (input.budget !== null && input.scopeRecord === undefined)
          writeFileSync(
            join(route, '0.scope.md'),
            `- scope: .\n- grain: all\n- peers: 3\n- budget: ${input.budget}\n`,
          );
        const recordPath = join(route, '.claims', '0.cycle.md');
        if (input.recordPrior !== null)
          writeFileSync(recordPath, input.recordPrior);
        const rewindLog = join(dir, 'rewind.log');
        writeFileSync(rewindLog, '');
        const stubPath = genGuardianStubBinPath();
        const call = (healed: string) =>
          runSourcedBash({
            // the command form is the path 5.promote names; the sourced form reaches a prelude
            expression: input.viaCommand
              ? `cd "$ROUTE/../.." && bash --noprofile --norc "$SKILL_SH" rewind-detect --route .behavior/v2026_01_01.guardian-redteam.loop --cycle ${input.cycle}`
              : `${input.prelude ?? ''}rewind_detect_with_cycle_carry "$ROUTE" ${input.cycle}`,
            stdin: input.keys ?? KEYS,
            env: {
              SKILL_SH: join(__dirname, SKILL),
              PATH: input.pathPrefix
                ? `${input.pathPrefix}:${stubPath}`
                : stubPath,
              STUB_REWIND_LOG: rewindLog,
              ROUTE: route,
              AFTER_HEALED: healed,
              ...input.env,
            },
          });
        const first = call('');
        const second = call('1');
        const asRouteMasked = (out: string) =>
          out
            .split(route)
            .join('<route>')
            .split(`pid ${pidGone},`)
            .join('pid <gone>,');
        return {
          route,
          first: { ...first, stdout: asRouteMasked(first.stdout) },
          second: { ...second, stdout: asRouteMasked(second.stdout) },
          rewinds: readFileSync(rewindLog, 'utf-8'),
          record:
            existsSync(recordPath) && statSync(recordPath).isFile()
              ? readFileSync(recordPath, 'utf-8')
              : '',
        };
      };
      const BOTH_KEYS =
        '- carried PENDING-REDETECT: infil::launch-flag-control-channel\n- carried PENDING-REDETECT: exfil::egress-without-allowlist\n';
      // the carry after the rewind breaks once (the first call), then heals (the second call)
      const AFTER_CARRY_BREAKS_ONCE =
        'eval "orig_$(declare -f set_cycle_carry_confirmed)"; set_cycle_carry_confirmed() { [[ "$5" == after && -z "$AFTER_HEALED" ]] && { printf "simulated after-carry break"; return 1; }; orig_set_cycle_carry_confirmed "$@"; }; ';
      // each fresh cycle-record lock gets a dir where its holder file goes, so the holder write
      // breaks; the rewind lock stays whole, so the break lands on the record write it targets
      const HOLDER_WRITE_BREAKS =
        'mkdir() { command mkdir "$@" || return; [[ "$1" == *0.cycle.md.lock ]] && command mkdir -- "$1/holder"; return 0; }; ';
      // an `rm` that breaks on the cycle lock alone, so its release fails
      const LOCK_RELEASE_BREAKS = genBrokenToolBin({
        tool: 'rm',
        exitCode: 1,
        failOn: '0.cycle.md.lock',
      });

      const scene = useBeforeAll(async () => ({
        kept: runRewind({
          slug: 'redteam-rewind-kept',
          budget: 3,
          cycle: 1,
          recordPrior: null,
          env: {},
        }),
        swept: runRewind({
          slug: 'redteam-rewind-swept',
          budget: 3,
          cycle: 1,
          recordPrior: null,
          env: { STUB_REWIND_CLEARS_CLAIMS: '1' },
        }),
        refused: runRewind({
          slug: 'redteam-rewind-refused',
          budget: 3,
          cycle: 1,
          recordPrior: null,
          env: { STUB_REWIND_RC: '1' },
        }),
        spent: runRewind({
          slug: 'redteam-rewind-spent',
          budget: 1,
          cycle: 1,
          recordPrior: null,
          env: {},
        }),
        skipped: runRewind({
          slug: 'redteam-rewind-skipped',
          budget: 9,
          cycle: 3,
          recordPrior: null,
          env: {},
        }),
        // cycle 1 holds both keys; cycle 2's block stands but lost them. a check over the
        // whole record would let cycle 1's keys stand in for cycle 2's loss.
        priorCycleOnly: runRewind({
          slug: 'redteam-rewind-prior-cycle-only',
          budget: 3,
          cycle: 2,
          recordPrior: `\n## cycle 1\n- spent: 1 / 3\n- carried PENDING-REDETECT: infil::launch-flag-control-channel\n- carried PENDING-REDETECT: exfil::egress-without-allowlist\n\n## cycle 2\n- spent: 2 / 3\n`,
          env: {},
        }),
        afterCarryBreaks: runRewind({
          slug: 'redteam-rewind-after-carry-breaks',
          budget: 3,
          cycle: 1,
          recordPrior: null,
          env: {},
          prelude: AFTER_CARRY_BREAKS_ONCE,
        }),
        // cycle 1 rewound, and the record has since opened cycle 2
        advanced: runRewind({
          slug: 'redteam-rewind-advanced',
          budget: 3,
          cycle: 1,
          recordPrior: `\n## cycle 1\n- spent: 1 / 3\n${BOTH_KEYS}- rewound: yes\n\n## cycle 2\n- spent: 2 / 3\n${BOTH_KEYS}`,
          env: {},
        }),
        budgetInvalid: runRewind({
          slug: 'redteam-rewind-budget-invalid',
          budget: 'n/a',
          cycle: 1,
          recordPrior: null,
          env: {},
        }),
        scopeAbsent: runRewind({
          slug: 'redteam-rewind-scope-absent',
          budget: null,
          cycle: 1,
          recordPrior: null,
          env: {},
        }),
        // the record stands but lacks its budget line: the in-place field fix, never a rebind
        budgetFieldAbsent: runRewind({
          slug: 'redteam-rewind-budget-field-absent',
          budget: null,
          cycle: 1,
          recordPrior: null,
          env: {},
          scopeRecord: '- scope: .\n- grain: all\n- peers: 3\n',
        }),
        recordUnopenable: runRewind({
          slug: 'redteam-rewind-record-unopenable',
          budget: 3,
          cycle: 1,
          recordPrior: null,
          env: {},
          damage: 'claims-file',
        }),
        lockStale: runRewind({
          slug: 'redteam-rewind-lock-stale',
          budget: 3,
          cycle: 1,
          recordPrior: null,
          env: {},
          damage: 'stale-lock',
        }),
        lockUnrecorded: runRewind({
          slug: 'redteam-rewind-lock-unrecorded',
          budget: 3,
          cycle: 1,
          recordPrior: null,
          env: {},
          damage: 'unrecorded-lock',
        }),
        lockUnreadable: runRewind({
          slug: 'redteam-rewind-lock-unreadable',
          budget: 3,
          cycle: 1,
          recordPrior: null,
          env: {},
          damage: 'unreadable-lock',
        }),
        releaseBroke: runRewind({
          slug: 'redteam-rewind-release-broke',
          budget: 3,
          cycle: 1,
          recordPrior: null,
          env: {},
          pathPrefix: LOCK_RELEASE_BREAKS,
        }),
        holderBroke: runRewind({
          slug: 'redteam-rewind-holder-broke',
          budget: 3,
          cycle: 1,
          recordPrior: null,
          env: {},
          prelude: HOLDER_WRITE_BREAKS,
        }),
        holderAndReleaseBroke: runRewind({
          slug: 'redteam-rewind-holder-release-broke',
          budget: 3,
          cycle: 1,
          recordPrior: null,
          env: {},
          prelude: HOLDER_WRITE_BREAKS,
          pathPrefix: LOCK_RELEASE_BREAKS,
        }),
        // cycle 1 already rewound, and the retry's carry-after breaks
        rewoundCarryBreaks: runRewind({
          slug: 'redteam-rewind-rewound-carry-breaks',
          budget: 3,
          cycle: 1,
          recordPrior: `\n## cycle 1\n- spent: 1 / 3\n${BOTH_KEYS}- rewound: yes\n`,
          env: {},
          prelude: AFTER_CARRY_BREAKS_ONCE,
        }),
        viaCommand: runRewind({
          slug: 'redteam-rewind-via-command',
          budget: 3,
          cycle: 1,
          recordPrior: null,
          env: {},
          viaCommand: true,
        }),
        // a loop with no PENDING-REDETECT key to carry still rewinds and marks its cycle
        noKeys: runRewind({
          slug: 'redteam-rewind-no-keys',
          budget: 3,
          cycle: 1,
          recordPrior: null,
          env: {},
          keys: '',
        }),
        // the rewind lock alone fails its release; the record lock releases clean
        rewindLockReleaseBroke: runRewind({
          slug: 'redteam-rewind-lock-release-broke',
          budget: 3,
          cycle: 1,
          recordPrior: null,
          env: {},
          pathPrefix: genBrokenToolBin({
            tool: 'rm',
            exitCode: 1,
            failOn: '.rewind-detect.lock',
          }),
        }),
        // the cycle-1 probe reads clean; the probe for a later cycle 2 breaks
        laterProbeBroke: runRewind({
          slug: 'redteam-rewind-later-probe-broke',
          budget: 3,
          cycle: 1,
          recordPrior: null,
          env: {},
          pathPrefix: genBrokenToolBin({
            tool: 'grep',
            exitCode: 2,
            failOn: '## cycle 2',
          }),
        }),
        // a spent budget whose record lacks the scope, then one that lacks the grain
        spentScopeAbsent: runRewind({
          slug: 'redteam-rewind-spent-scope-absent',
          budget: 1,
          cycle: 1,
          recordPrior: null,
          env: {},
          scopeRecord: '- grain: all\n- peers: 3\n- budget: 1\n',
        }),
        spentGrainAbsent: runRewind({
          slug: 'redteam-rewind-spent-grain-absent',
          budget: 1,
          cycle: 1,
          recordPrior: null,
          env: {},
          scopeRecord: '- scope: .\n- peers: 3\n- budget: 1\n',
        }),
        // a lock held by a live process: this shell's own pid, which runs through the wait
        lockLive: runRewind({
          slug: 'redteam-rewind-lock-live',
          budget: 3,
          cycle: 1,
          recordPrior: null,
          env: {},
          prelude:
            'mkdir -p "$ROUTE/.claims/0.cycle.md.lock" && printf "%s" "$$" > "$ROUTE/.claims/0.cycle.md.lock/holder"; ',
        }),
        // the rewind lands, then its marker write breaks
        markerBroke: runRewind({
          slug: 'redteam-rewind-marker-broke',
          budget: 3,
          cycle: 1,
          recordPrior: null,
          env: {},
          prelude:
            'set_cycle_rewound() { printf "simulated marker break"; return 1; }; ',
        }),
        // the carry append fails and names no cause of its own
        appendSilent: runRewind({
          slug: 'redteam-rewind-append-silent',
          budget: 3,
          cycle: 1,
          recordPrior: null,
          env: {},
          prelude: 'set_cycle_carry_block() { return 1; }; ',
        }),
        // the rewind sweeps the record, and the block rewritten after it carries no keys
        afterAbsent: runRewind({
          slug: 'redteam-rewind-after-absent',
          budget: 3,
          cycle: 1,
          recordPrior: null,
          env: { STUB_REWIND_CLEARS_CLAIMS: '1' },
          prelude:
            'eval "orig_$(declare -f set_cycle_carry_block)"; set_cycle_carry_block() { [[ -s "$STUB_REWIND_LOG" ]] && set -- "$1" "$2" "$3" ""; orig_set_cycle_carry_block "$@"; }; ',
        }),
        recordReadBroke: runRewind({
          slug: 'redteam-rewind-record-read-broke',
          budget: 3,
          cycle: 1,
          recordPrior: null,
          env: {},
          pathPrefix: genBrokenToolBin({
            tool: 'grep',
            exitCode: 2,
            failOn: 'rewound: yes',
          }),
        }),
        // cycle 1 walked, rewound, and both keys carried: the loop opens cycle 2 with budget left
        secondCycle: runRewind({
          slug: 'redteam-rewind-second-cycle',
          budget: 3,
          cycle: 2,
          recordPrior: `\n## cycle 1\n- spent: 1 / 3\n${BOTH_KEYS}- rewound: yes\n`,
          env: {},
        }),
        // the same walk on a budget of 2: cycle 2 is the last one paid for
        lastCycle: runRewind({
          slug: 'redteam-rewind-last-cycle',
          budget: 2,
          cycle: 2,
          recordPrior: `\n## cycle 1\n- spent: 1 / 2\n${BOTH_KEYS}- rewound: yes\n`,
          env: {},
        }),
        // four rewinds of one cycle overlap; the rewind lock admits one, the rest read its marker
        raced: (() => {
          const dir = genTempDir({ slug: 'redteam-rewind-raced' });
          const route = join(
            dir,
            '.behavior',
            'v2026_01_01.guardian-redteam.loop',
          );
          mkdirSync(join(route, '.claims'), { recursive: true });
          writeFileSync(
            join(route, '0.scope.md'),
            '- scope: .\n- grain: all\n- peers: 3\n- budget: 3\n',
          );
          const rewindLog = join(dir, 'rewind.log');
          writeFileSync(rewindLog, '');
          const run = runSourcedBash({
            expression:
              'pids=(); for i in 1 2 3 4; do printf "%s\\n" "$KEYS" | rewind_detect_with_cycle_carry "$ROUTE" 1 & pids+=("$!"); done; rc=0; for pid in "${pids[@]}"; do wait "$pid" || rc=1; done; exit "$rc"',
            stdin: '',
            env: {
              PATH: genGuardianStubBinPath(),
              STUB_REWIND_LOG: rewindLog,
              ROUTE: route,
              KEYS,
            },
          });
          return {
            run,
            rewinds: readFileSync(rewindLog, 'utf-8'),
            record: readFileSync(join(route, '.claims', '0.cycle.md'), 'utf-8'),
          };
        })(),
      }));

      when('[t10] the loop opens its second cycle with budget left', () => {
        then('cycle 2 rewinds once, in its own block after block 1', () => {
          expect(scene.secondCycle.first.status).toBe(0);
          expect(scene.secondCycle.first.stdout).toContain(
            'rewound 2.detect after cycle 2 of 3',
          );
          expect(
            scene.secondCycle.rewinds.split('--as rewound').length - 1,
          ).toBe(1);
          expect(scene.secondCycle.record).toEqual(
            `\n## cycle 1\n- spent: 1 / 3\n${BOTH_KEYS}- rewound: yes\n\n## cycle 2\n- spent: 2 / 3\n${BOTH_KEYS}- rewound: yes\n`,
          );
          expect(scene.secondCycle.first.stdout).toMatchSnapshot();
        });
        then('a retry of cycle 2 reads its marker, never rewinds twice', () => {
          expect(scene.secondCycle.second.status).toBe(0);
          expect(scene.secondCycle.second.stdout).toContain(
            'already rewound 2.detect after cycle 2 of 3',
          );
        });
        then('cycle 2 of a budget of 2 is refused as spent', () => {
          expect(scene.lastCycle.first.status).toBe(2);
          expect(scene.lastCycle.first.stdout).toContain(
            'budget spent — cycle 2 of 2',
          );
          expect(scene.lastCycle.rewinds).toEqual('');
          expect(scene.lastCycle.first.stdout).toMatchSnapshot();
        });
      });

      when('[t11] four rewinds of one cycle overlap', () => {
        then('2.detect rewinds once; every racer exits 0', () => {
          expect(scene.raced.run.status).toBe(0);
          expect(scene.raced.rewinds.split('--as rewound').length - 1).toBe(1);
          expect(scene.raced.run.stdout).not.toContain('could not');
          expect(
            scene.raced.run.stdout.split('already rewound 2.detect').length - 1,
          ).toBe(3);
          expect(scene.raced.record.split('- rewound: yes').length - 1).toBe(1);
        });
      });

      when('[t6] the carry after the rewind breaks once', () => {
        then(
          'the marker already stands, so the retry converges and rewinds once',
          () => {
            expect(scene.afterCarryBreaks.first.status).toBe(1);
            expect(scene.afterCarryBreaks.first.stdout).toContain(
              'rewound (marker held, a retry converges), but simulated after-carry break',
            );
            expect(scene.afterCarryBreaks.second.status).toBe(0);
            expect(scene.afterCarryBreaks.second.stdout).toContain(
              'already rewound 2.detect after cycle 1 of 3',
            );
            expect(
              scene.afterCarryBreaks.rewinds.split('--as rewound').length - 1,
            ).toBe(1);
            expect(scene.afterCarryBreaks.first.stdout).toMatchSnapshot();
          },
        );
      });

      when('[t7] a rewound cycle is retried after the record moved on', () => {
        then('it answers "already rewound", never "out of order"', () => {
          expect(scene.advanced.first.status).toBe(0);
          expect(scene.advanced.first.stdout).toContain(
            'already rewound 2.detect after cycle 1 of 3',
          );
          expect(scene.advanced.first.stdout).not.toContain('out of order');
          expect(scene.advanced.rewinds).toEqual('');
        });
      });

      when('[t8] the gate cannot read its own inputs', () => {
        then(
          'an unparseable budget halts (exit 1), never reads as no cap',
          () => {
            expect(scene.budgetInvalid.first.status).toBe(1);
            expect(scene.budgetInvalid.first.stdout).toContain(
              "the scope record's budget is no positive integer: 'n/a'",
            );
            expect(scene.budgetInvalid.rewinds).toEqual('');
            expect(scene.budgetInvalid.first.stdout).toMatchSnapshot();
          },
        );

        then('an absent scope record halts (exit 1), named', () => {
          expect(scene.scopeAbsent.first.status).toBe(1);
          expect(scene.scopeAbsent.first.stdout).toContain(
            'not rewound: could not read the budget: no scope record at',
          );
          expect(scene.scopeAbsent.first.stdout).toMatchSnapshot();
        });

        then(
          'a scope record that lacks its budget line halts (exit 1) with the in-place field fix',
          () => {
            expect(scene.budgetFieldAbsent.first.status).toBe(1);
            expect(scene.budgetFieldAbsent.first.stdout).toContain(
              'not rewound: could not read the budget:',
            );
            expect(scene.budgetFieldAbsent.first.stdout).toContain(
              "fix: set '- budget: <value>' in <route>/0.scope.md",
            );
            expect(scene.budgetFieldAbsent.rewinds).toEqual('');
            expect(scene.budgetFieldAbsent.first.stdout).toMatchSnapshot();
          },
        );

        then(
          'a cycle record that cannot be opened halts (exit 1), named',
          () => {
            expect(scene.recordUnopenable.first.status).toBe(1);
            expect(scene.recordUnopenable.first.stdout).toContain(
              'not rewound: could not open the cycle record',
            );
            expect(scene.recordUnopenable.rewinds).toEqual('');
            expect(scene.recordUnopenable.first.stdout).toContain(
              'File exists',
            );
            expect(
              asMkdirVendorMasked({ out: scene.recordUnopenable.first.stdout }),
            ).toMatchSnapshot();
          },
        );

        then('a read break on the cycle record halts (exit 1), named', () => {
          expect(scene.recordReadBroke.first.status).toBe(1);
          expect(scene.recordReadBroke.first.stdout).toContain(
            'not rewound: could not read the cycle record',
          );
          // the leaf cause rides in, so the operator can tell a tool break from an absent file
          expect(scene.recordReadBroke.first.stdout).toContain(
            'has_cycle_line: grep broke (rc=2)',
          );
          expect(scene.recordReadBroke.rewinds).toEqual('');
          expect(scene.recordReadBroke.first.stdout).toMatchSnapshot();
        });

        then(
          'a lock left by a gone holder halts (exit 1) and names the remedy',
          () => {
            expect(scene.lockStale.first.status).toBe(1);
            expect(scene.lockStale.first.stdout).toContain(
              'held by pid <gone>, which is gone',
            );
            // the remedy sits in the fix item; the halted close stays the diagnosis alone
            expect(scene.lockStale.first.stdout).toContain(
              'fix: if no drive runs, remove the lock by hand (rm -r <route>/.claims/0.cycle.md.lock), then re-run',
            );
            expect(
              asHaltedLine({ stdout: scene.lockStale.first.stdout }),
            ).not.toContain('rm -r');
            expect(scene.lockStale.rewinds).toEqual('');
            expect(scene.lockStale.first.stdout).toMatchSnapshot();
          },
        );
      });

      when('[t9] the cycle lock breaks at its holder or its release', () => {
        const LOCK_CASES = [
          {
            key: 'lockUnrecorded',
            says: 'holder unrecorded',
          },
          {
            key: 'lockUnreadable',
            says: 'holder unreadable, said: ',
          },
          {
            key: 'releaseBroke',
            says: 'could not release the lock',
          },
          {
            key: 'holderBroke',
            says: 'could not record the holder of the lock',
          },
          {
            key: 'holderAndReleaseBroke',
            says: 'could not release the lock',
          },
          {
            key: 'rewoundCarryBreaks',
            says: 'already rewound, but simulated after-carry break',
          },
          {
            key: 'markerBroke',
            says: 'rewound, but the rewound marker could not be written to',
          },
          {
            key: 'appendSilent',
            says: 'could not write the cycle record <route>/.claims/0.cycle.md: the append broke',
          },
          {
            key: 'afterAbsent',
            // a real count label, and the keys joined by `; ` so no reader takes two keys for one
            says: '2 carried keys absent from cycle 1 after the rewind: infil::launch-flag-control-channel; exfil::egress-without-allowlist',
          },
        ] as const;
        LOCK_CASES.map((thisCase) =>
          then(`${thisCase.key}: halts (exit 1), named, snapped`, () => {
            const run = scene[thisCase.key];
            expect(run.first.status).toBe(1);
            expect(run.first.stdout).toContain(thisCase.says);
            expect(run.first.stdout).toContain('halted: 💥 MalfunctionError');
            // a remedy never rides inside the close: the fix item carries it
            expect(asHaltedLine({ stdout: run.first.stdout })).not.toContain(
              'rm -r',
            );
            expect(run.first.stdout).toMatchSnapshot();
          }),
        );

        then(
          'zero carried keys rewinds once and marks the cycle (exit 0), never "append broke"',
          () => {
            expect(scene.noKeys.first.status).toBe(0);
            expect(scene.noKeys.first.stdout).toContain(
              'rewound 2.detect after cycle 1 of 3',
            );
            expect(scene.noKeys.rewinds.split('--as rewound').length - 1).toBe(
              1,
            );
            expect(scene.noKeys.record).toContain('- rewound: yes');
          },
        );

        then(
          'a lock a live process holds names that it still runs, so no one removes it',
          () => {
            expect(scene.lockLive.first.status).toBe(1);
            expect(scene.lockLive.first.stdout).toMatch(
              /held by pid \d+, which still runs/,
            );
            // a live holder gets the wait remedy; a removal would let a second writer in
            expect(scene.lockLive.first.stdout).toContain(
              'fix: do not remove <route>/.claims/0.cycle.md.lock; wait for the drive that holds it to end, then re-run',
            );
            expect(scene.lockLive.first.stdout).not.toContain('rm -r');
            expect(scene.lockLive.rewinds).toEqual('');
            expect(
              scene.lockLive.first.stdout.replace(/pid \d+/g, 'pid <pid>'),
            ).toMatchSnapshot();
          },
        );

        then(
          'a release that breaks names the lock path whole in its fix',
          () => {
            // the cause's `; said:` separator must never bleed into the path the fix hands over
            expect(scene.releaseBroke.first.stdout).toContain(
              'fix: if no drive runs, remove the lock by hand (rm -r <route>/.claims/0.cycle.md.lock), then re-run',
            );
            expect(scene.rewindLockReleaseBroke.first.stdout).toContain(
              'fix: if no drive runs, remove the lock by hand (rm -r <route>/.rewind-detect.lock), then re-run',
            );
          },
        );

        then('a release that breaks leaves no rewind behind it', () => {
          expect(scene.releaseBroke.rewinds).toEqual('');
          expect(scene.holderBroke.rewinds).toEqual('');
        });

        then(
          'a rewind lock that cannot release halts (exit 1) after the verdict, never a silent leftover',
          () => {
            // the rewind lock outlives .claims/ on purpose, so a leftover would halt every later rewind
            const run = scene.rewindLockReleaseBroke.first;
            expect(run.status).toBe(1);
            expect(run.stdout).toContain(
              'rewound 2.detect after cycle 1 of 3 — carried keys held in <route>/.claims/0.cycle.md; then',
            );
            expect(run.stdout).toContain(
              'could not release the lock <route>/.rewind-detect.lock',
            );
            expect(run.stdout).toMatchSnapshot();
          },
        );
      });

      when('[t12] a probe for a later cycle breaks', () => {
        then(
          'the carry halts (exit 1) and appends no block, never read as "no later block"',
          () => {
            // the cycle-1 probe reads clean; only the cycle-2 probe breaks
            expect(scene.laterProbeBroke.first.status).toBe(1);
            expect(scene.laterProbeBroke.record).not.toContain('## cycle 1');
            expect(scene.laterProbeBroke.rewinds).toEqual('');
            expect(scene.laterProbeBroke.first.stdout).toContain(
              'has_cycle_block: grep broke',
            );
            expect(scene.laterProbeBroke.first.stdout).toMatchSnapshot();
          },
        );
      });

      when(
        '[t13] a spent budget meets a record that lacks a resume field',
        () => {
          then(
            'the escalation halts (exit 1) and names the field the resume could not read',
            () => {
              // the resume command is built from these two fields; an empty one would mislead
              expect(scene.spentScopeAbsent.first.status).toBe(1);
              expect(scene.spentScopeAbsent.first.stdout).toContain(
                'not rewound: budget spent, and the resume could not read the scope:',
              );
              expect(scene.spentGrainAbsent.first.status).toBe(1);
              expect(scene.spentGrainAbsent.first.stdout).toContain(
                'not rewound: budget spent, and the resume could not read the grain:',
              );
              expect(scene.spentScopeAbsent.rewinds).toEqual('');
              expect(scene.spentScopeAbsent.first.stdout).toMatchSnapshot();
              expect(scene.spentGrainAbsent.first.stdout).toMatchSnapshot();
            },
          );
        },
      );

      when('[t0] the rewind leaves `.claims/` in place', () => {
        then('it rewinds 2.detect on the route and holds every key', () => {
          expect(scene.kept.first.status).toBe(0);
          expect(scene.kept.rewinds).toContain(
            `route.stone.set --stone 2.detect --as rewound --route ${scene.kept.route}`,
          );
          expect(scene.kept.record).toContain(
            '- carried PENDING-REDETECT: infil::launch-flag-control-channel',
          );
          expect(scene.kept.record).toContain(
            '- carried PENDING-REDETECT: exfil::egress-without-allowlist',
          );
          expect(scene.kept.record).toContain('- spent: 1 / 3');
        });

        then(
          'the `rewind-detect` command 5.promote names runs the same gate',
          () => {
            expect(scene.viaCommand.first.status).toBe(0);
            expect(scene.viaCommand.rewinds).toContain(
              'route.stone.set --stone 2.detect --as rewound --route .behavior/v2026_01_01.guardian-redteam.loop',
            );
            expect(scene.viaCommand.record).toContain(
              '- carried PENDING-REDETECT: exfil::egress-without-allowlist',
            );
            expect(scene.viaCommand.second.stdout).toContain(
              'already rewound 2.detect after cycle 1 of 3',
            );
          },
        );

        then('a second call for one cycle writes one block, not two', () => {
          expect(scene.kept.second.status).toBe(0);
          expect(scene.kept.record.split('## cycle 1').length - 1).toBe(1);
        });

        then('a second call for one cycle rewinds once, not twice', () => {
          expect(scene.kept.rewinds.split('--as rewound').length - 1).toBe(1);
          expect(scene.kept.second.stdout).toContain(
            'already rewound 2.detect after cycle 1 of 3 — naught re-dispatched',
          );
          expect(scene.kept.record).toContain('- rewound: yes');
          expect(scene.kept.second.stdout).toMatchSnapshot();
        });

        then('the success line matches snapshot', () => {
          expect(scene.kept.first.stdout).toContain('rewound 2.detect');
          expect(scene.kept.first.stdout).toMatchSnapshot();
        });
      });

      when('[t3] the budget is spent', () => {
        then('it refuses as a constraint (exit 2) and rewinds naught', () => {
          expect(scene.spent.first.status).toBe(2);
          expect(scene.spent.first.stdout).toContain(
            'not rewound: budget spent',
          );
          expect(scene.spent.first.stdout).toContain('add budget');
          expect(scene.spent.rewinds).toEqual('');
          expect(scene.spent.first.stdout).toMatchSnapshot();
        });
      });

      when('[t4] the cycle number skips ahead of the record', () => {
        then('it refuses as a constraint (exit 2) and rewinds naught', () => {
          expect(scene.skipped.first.status).toBe(2);
          expect(scene.skipped.first.stdout).toContain('is out of order');
          expect(scene.skipped.rewinds).toEqual('');
          expect(scene.skipped.first.stdout).toMatchSnapshot();
        });
      });

      when('[t5] only an earlier cycle holds the carried keys', () => {
        then(
          "the keys land in this cycle's own block (exit 0): an earlier cycle never stands in",
          () => {
            // a retry with a corrected key set converges into the block, never a dead end
            expect(scene.priorCycleOnly.first.status).toBe(0);
            const cycle2 =
              scene.priorCycleOnly.record.split('## cycle 2')[1] ?? '';
            expect(cycle2).toContain(
              '- carried PENDING-REDETECT: infil::launch-flag-control-channel',
            );
            expect(cycle2).toContain(
              '- carried PENDING-REDETECT: exfil::egress-without-allowlist',
            );
            expect(
              scene.priorCycleOnly.record.split('## cycle 2').length - 1,
            ).toBe(1);
            expect(scene.priorCycleOnly.first.stdout).toMatchSnapshot();
          },
        );
      });

      when('[t1] the rewind sweeps the cycle record away', () => {
        then('the gate re-carries every key after the rewind', () => {
          expect(scene.swept.first.status).toBe(0);
          expect(scene.swept.record).toContain(
            '- carried PENDING-REDETECT: infil::launch-flag-control-channel',
          );
          expect(scene.swept.record).toContain(
            '- carried PENDING-REDETECT: exfil::egress-without-allowlist',
          );
        });
      });

      when('[t2] the rewind itself is refused', () => {
        then('it halts as a malfunction (exit 1), named', () => {
          expect(scene.refused.first.status).toBe(1);
          expect(scene.refused.first.stdout).toContain('not rewound');
          expect(scene.refused.first.stdout).toMatchSnapshot();
        });
      });
    },
  );

  given('[case18] init scaffolds the verify + detect templates', () => {
    // the promote stone's convergence test counts critical claims, so a verified claim with no
    // severity escapes that count. the verify guard must block it. and the detect stone grounds
    // via_research on a corpus the vision ships separately, so it must name a fallback when that
    // corpus is absent. both are prompt text a driven route reads; pin them on the scaffold.
    const scene = useBeforeAll(async () => {
      const dir = setupHabitat({ slug: 'redteam-templates' });
      runGuardianSkill(
        {
          skill: INIT,
          args: '--scope . --grain all --skip-route-bind',
          cwd: dir,
        },
        { env: { PATH: PATH_WITHOUT_RHX } },
      );
      const route = findRouteDir(dir);
      return {
        verifyGuard: readFileSync(join(route, '3.verify.guard'), 'utf-8'),
        detectStone: readFileSync(join(route, '2.detect.stone'), 'utf-8'),
      };
    });

    when('[t0] the scaffolded verify guard is read', () => {
      then('it blocks a verified claim with no severity', () => {
        expect(scene.verifyGuard).toContain(
          'a severity (critical|minor) absent on any verified claim',
        );
      });
    });

    when('[t1] the scaffolded detect stone is read', () => {
      then(
        'it names the public-canon fallback for an absent vuln-class corpus',
        () => {
          expect(scene.detectStone).toContain(
            'if the `inventory.of=vuln.class` corpus is absent',
          );
        },
      );
    });
  });

  given(
    '[case24] init belays each constraint and halts each malfunction',
    () => {
      // every belay init can print is a render an operator reads; each is driven for real
      // (a broken git on PATH, a stub bind, a skill copy with a damaged install) and snapped.
      const runInit = (input: {
        args: string;
        cwd: string;
        skillRoot: string | null;
        env: Record<string, string>;
      }) => {
        const run =
          input.skillRoot === null
            ? runGuardianSkill(
                { skill: INIT, args: input.args, cwd: input.cwd },
                { env: input.env },
              )
            : runRoleSkill(
                {
                  skillPath: join(input.skillRoot, INIT),
                  args: input.args,
                  cwd: input.cwd,
                },
                { env: input.env },
              );
        const asMasked = (out: string) =>
          maskRouteDate(maskSkillPath({ out, skillRoot: input.skillRoot }));
        // read on demand: a scene that stages `.behavior` as a file never asks what routes it left
        return {
          ...run,
          masked: asMasked(run.stdout),
          get routesLeft(): string[] {
            return getRedteamRoutes({ cwd: input.cwd });
          },
        };
      };
      const NO_RHX = { PATH: PATH_WITHOUT_RHX };

      const scene = useBeforeAll(async () => {
        const dir = setupHabitat({ slug: 'redteam-init-belays' });
        const mkdirBrokenDir = setupHabitat({ slug: 'redteam-init-mkdir' });
        writeFileSync(join(mkdirBrokenDir, '.behavior'), 'not a dir\n');
        return {
          absentScope: runInit({
            args: '--grain leak',
            cwd: dir,
            skillRoot: null,
            env: NO_RHX,
          }),
          absentGrain: runInit({
            args: '--scope .',
            cwd: dir,
            skillRoot: null,
            env: NO_RHX,
          }),
          invalidGrain: runInit({
            args: '--scope . --grain bogus',
            cwd: dir,
            skillRoot: null,
            env: NO_RHX,
          }),
          gitBroken: runInit({
            args: '--scope . --grain leak --skip-route-bind',
            cwd: dir,
            skillRoot: null,
            env: {
              PATH: `${genBrokenToolBin({ tool: 'git', exitCode: 1 })}:${PATH_WITHOUT_RHX}`,
            },
          }),
          probeBroken: runInit({
            args: '--scope . --grain leak',
            cwd: dir,
            skillRoot: null,
            env: NO_RHX,
          }),
          alreadyBound: runInit({
            args: '--scope . --grain leak',
            cwd: dir,
            skillRoot: null,
            env: {
              PATH: genGuardianStubBinPath(),
              STUB_BOUND_ROUTE: `.behavior/v2026_01_01.${ROUTE_KIND}.grain=infil`,
            },
          }),
          templatesAbsent: runInit({
            args: '--scope . --grain leak --skip-route-bind',
            cwd: setupHabitat({ slug: 'redteam-init-tpl-absent' }),
            skillRoot: genSkillCopy({ damage: 'templates-absent' }),
            env: NO_RHX,
          }),
          templatesEmpty: runInit({
            args: '--scope . --grain leak --skip-route-bind',
            cwd: setupHabitat({ slug: 'redteam-init-tpl-empty' }),
            skillRoot: genSkillCopy({ damage: 'templates-empty' }),
            env: NO_RHX,
          }),
          templatesPartial: runInit({
            args: '--scope . --grain leak --skip-route-bind',
            cwd: setupHabitat({ slug: 'redteam-init-tpl-partial' }),
            skillRoot: genSkillCopy({ damage: 'templates-partial' }),
            env: NO_RHX,
          }),
          // LC_ALL=C pins mkdir's message quotes, which a utf-8 locale renders as curly ones
          mkdirBroken: runInit({
            args: '--scope . --grain leak --skip-route-bind',
            cwd: mkdirBrokenDir,
            skillRoot: null,
            env: { ...NO_RHX, LC_ALL: 'C' },
          }),
          rootBroken: runInit({
            args: '--scope . --grain leak --skip-route-bind',
            cwd: setupHabitat({ slug: 'redteam-init-root' }),
            skillRoot: null,
            env: {
              PATH: `${genBrokenToolBin({ tool: 'git', exitCode: 1, failOn: 'show-toplevel' })}:${PATH_WITHOUT_RHX}`,
            },
          }),
          cpBroken: runInit({
            args: '--scope . --grain leak --skip-route-bind',
            cwd: setupHabitat({ slug: 'redteam-init-cp' }),
            skillRoot: null,
            env: {
              PATH: `${genBrokenToolBin({ tool: 'cp', exitCode: 1 })}:${PATH_WITHOUT_RHX}`,
            },
          }),
          cpAndRmBroken: runInit({
            args: '--scope . --grain leak --skip-route-bind',
            cwd: setupHabitat({ slug: 'redteam-init-cp-rm' }),
            skillRoot: null,
            env: {
              PATH: `${genBrokenToolBin({ tool: 'cp', exitCode: 1 })}:${genBrokenToolBin({ tool: 'rm', exitCode: 1 })}:${PATH_WITHOUT_RHX}`,
            },
          }),
          claimsBroken: runInit({
            args: '--scope . --grain leak --skip-route-bind',
            cwd: setupHabitat({ slug: 'redteam-init-claims' }),
            skillRoot: null,
            env: {
              PATH: `${genBrokenToolBin({ tool: 'mkdir', exitCode: 1, failOn: '.claims' })}:${PATH_WITHOUT_RHX}`,
            },
          }),
          recordBroken: runInit({
            args: '--scope . --grain leak --skip-route-bind',
            cwd: setupHabitat({ slug: 'redteam-init-record' }),
            skillRoot: null,
            env: {
              PATH: `${genBrokenToolBin({ tool: 'cat', exitCode: 1 })}:${PATH_WITHOUT_RHX}`,
            },
          }),
          // the clock read exits non-zero: no route name, never one with an empty date
          clockBroken: runInit({
            args: '--scope . --grain leak --skip-route-bind',
            cwd: setupHabitat({ slug: 'redteam-init-clock' }),
            skillRoot: null,
            env: {
              PATH: `${genBrokenToolBin({ tool: 'date', exitCode: 1 })}:${PATH_WITHOUT_RHX}`,
            },
          }),
          // the clock read succeeds but prints no YYYY_MM_DD
          clockLies: runInit({
            args: '--scope . --grain leak --skip-route-bind',
            cwd: setupHabitat({ slug: 'redteam-init-clock-lies' }),
            skillRoot: null,
            env: {
              PATH: `${genScriptedToolBin({ tool: 'date', body: 'echo not-a-date' })}:${PATH_WITHOUT_RHX}`,
            },
          }),
          // the claims dir stands, but its .gitignore cannot be written: the one write that
          // keeps live claims unpublishable
          gitignoreBroken: runInit({
            args: '--scope . --grain leak --skip-route-bind',
            cwd: setupHabitat({ slug: 'redteam-init-gitignore' }),
            skillRoot: null,
            env: {
              PATH: `${genScriptedToolBin({
                tool: 'mkdir',
                body: [
                  'PATH="$(getconf PATH)" mkdir "$@" || exit $?',
                  'for arg in "$@"; do [[ "$arg" == *.claims ]] && chmod 555 "$arg"; done',
                  'exit 0',
                ].join('\n'),
              })}:${PATH_WITHOUT_RHX}`,
            },
          }),
        };
      });

      const CONSTRAINTS = [
        { key: 'absentScope', says: 'absent required arg: --scope' },
        { key: 'absentGrain', says: 'absent required arg: --grain' },
        { key: 'invalidGrain', says: 'invalid grain: bogus' },
        { key: 'alreadyBound', says: 'one route binds at a time' },
      ] as const;
      const MALFUNCTIONS = [
        {
          key: 'gitBroken',
          says: 'git malfunctioned while it probed the repo',
        },
        { key: 'probeBroken', says: 'could not probe the bound route' },
        { key: 'templatesAbsent', says: 'the templates dir is absent' },
        { key: 'templatesEmpty', says: 'no .stone/.guard templates found' },
        {
          key: 'templatesPartial',
          says: '3.verify.guard',
        },
        { key: 'mkdirBroken', says: 'could not create the route dir' },
        {
          key: 'rootBroken',
          says: 'git malfunctioned while it read the repo root',
        },
        { key: 'cpBroken', says: 'could not copy the route templates' },
        { key: 'cpAndRmBroken', says: 'could not copy the route templates' },
        {
          key: 'claimsBroken',
          says: 'could not stand up the gitignored claims path',
        },
        { key: 'recordBroken', says: 'could not write the scope record' },
        {
          key: 'clockBroken',
          says: "could not name today's route — the clock read broke",
        },
        {
          key: 'clockLies',
          says: "could not name today's route — the clock read broke",
        },
        {
          key: 'gitignoreBroken',
          says: 'could not stand up the gitignored claims path',
        },
      ] as const;

      when('[t0] the caller must fix an input', () => {
        CONSTRAINTS.map((thisCase) =>
          then(`${thisCase.key}: a constraint (exit 2), named, snapped`, () => {
            const run = scene[thisCase.key];
            expect(run.exitCode).toBe(2);
            expect(run.stdout).toContain('🐈 belay that...');
            expect(run.stdout).toContain(thisCase.says);
            expect(run.masked).toMatchSnapshot();
          }),
        );
      });

      when('[t1] the system broke', () => {
        MALFUNCTIONS.map((thisCase) =>
          then(
            `${thisCase.key}: a malfunction (exit 1), named, snapped`,
            () => {
              const run = scene[thisCase.key];
              expect(run.exitCode).toBe(1);
              expect(run.stdout).toContain('🐈 wet paws...');
              expect(run.stdout).toContain(thisCase.says);
              expect(
                asMkdirVendorMasked({ out: run.masked }),
              ).toMatchSnapshot();
            },
          ),
        );
      });

      when('[t3] the route dir create meets a file where a dir must go', () => {
        then(
          'the fix names the collision, never a permissions check that cannot clear it',
          () => {
            expect(scene.mkdirBroken.stdout).toContain(
              'fix: a file stands where the route path needs a dir — move or remove it',
            );
            expect(scene.mkdirBroken.stdout).not.toContain(
              'permissions, free space',
            );
          },
        );
      });

      when('[t2] a scaffold fails after its route dir was made', () => {
        then('the partial route is removed, so a retry starts clean', () => {
          expect(scene.templatesEmpty.routesLeft).toEqual([]);
          expect(scene.templatesPartial.routesLeft).toEqual([]);
          expect(scene.templatesPartial.stdout).toContain(
            'the partial route was removed; a retry starts clean',
          );
          expect(scene.cpBroken.routesLeft).toEqual([]);
          expect(scene.claimsBroken.routesLeft).toEqual([]);
          expect(scene.recordBroken.routesLeft).toEqual([]);
          expect(scene.gitignoreBroken.routesLeft).toEqual([]);
          // a clock break names no route at all, so none was made
          expect(scene.clockBroken.routesLeft).toEqual([]);
          expect(scene.clockBroken.stdout).toContain(
            'get_route_day: date broke (rc=1)',
          );
          expect(scene.clockLies.stdout).toContain(
            'get_route_day: date gave no YYYY_MM_DD: not-a-date',
          );
        });

        then(
          'a removal that fails names the leftover route, never claims a clean retry',
          () => {
            expect(scene.cpAndRmBroken.routesLeft).toHaveLength(1);
            // labelled, as every halt item is: the eye scans for the label, never a bare class
            expect(scene.cpAndRmBroken.stdout).toContain(
              'cleanup: 💥 MalfunctionError: the partial route could not be removed',
            );
            expect(scene.cpAndRmBroken.stdout).toContain(
              'remove it before a retry',
            );
            expect(scene.cpAndRmBroken.stdout).not.toContain(
              'a retry starts clean',
            );
          },
        );
      });
    },
  );

  given('[case25] the main skill meets a broken install or no repo', () => {
    const scene = useBeforeAll(async () => {
      const skillRoot = genSkillCopy({ damage: 'init-absent' });
      const asMasked = (out: string) => out.split(skillRoot).join('<skills>');
      const dir = setupHabitat({ slug: 'redteam-main-broken' });
      const initSub = runRoleSkill(
        {
          skillPath: join(skillRoot, SKILL),
          args: 'init --scope . --grain leak',
          cwd: dir,
        },
        { env: { PATH: PATH_WITHOUT_RHX } },
      );
      const apply = runRoleSkill(
        {
          skillPath: join(skillRoot, SKILL),
          args: '--scope . --grain leak --mode apply',
          cwd: dir,
        },
        { env: { PATH: genGuardianStubBinPath() } },
      );
      const initHelp = runRoleSkill(
        { skillPath: join(skillRoot, SKILL), args: 'init --help', cwd: dir },
        { env: { PATH: PATH_WITHOUT_RHX } },
      );
      const notRepo = runGuardianSkill(
        {
          skill: SKILL,
          args: '--scope . --grain leak --mode apply',
          cwd: genTempDir({ slug: 'redteam-not-a-repo' }),
        },
        { env: { PATH: genGuardianStubBinPath() } },
      );
      // init.sh present but not executable: both entry points halt on the same guard
      const noexecRoot = genSkillCopy({ damage: 'init-noexec' });
      const asNoexecMasked = (out: string) =>
        out.split(noexecRoot).join('<skills>');
      const noexecInit = runRoleSkill(
        {
          skillPath: join(noexecRoot, SKILL),
          args: 'init --scope . --grain leak',
          cwd: dir,
        },
        { env: { PATH: PATH_WITHOUT_RHX } },
      );
      const noexecApply = runRoleSkill(
        {
          skillPath: join(noexecRoot, SKILL),
          args: '--scope . --grain leak --mode apply',
          cwd: dir,
        },
        { env: { PATH: genGuardianStubBinPath() } },
      );
      return {
        noexecInit: {
          ...noexecInit,
          masked: asNoexecMasked(noexecInit.stdout),
        },
        noexecApply: {
          ...noexecApply,
          masked: asNoexecMasked(noexecApply.stdout),
        },
        initSub: { ...initSub, masked: asMasked(initSub.stdout) },
        apply: { ...apply, masked: asMasked(apply.stdout) },
        initHelp: { ...initHelp, masked: asMasked(initHelp.stdout) },
        notRepo,
      };
    });

    when('[t3] init.sh is absent and the init help page is asked', () => {
      then('it halts (exit 1), names the broken install and its fix', () => {
        expect(scene.initHelp.exitCode).toBe(1);
        expect(scene.initHelp.stdout).toContain('the skill install is broken');
        expect(scene.initHelp.stdout).toContain(
          'fix: reinstall the role package',
        );
        expect(scene.initHelp.masked).toMatchSnapshot();
      });
    });

    when('[t0] init.sh is absent and the init subcommand runs', () => {
      then('it halts (exit 1) and names the broken install', () => {
        expect(scene.initSub.exitCode).toBe(1);
        expect(scene.initSub.stdout).toContain('the skill install is broken');
        expect(scene.initSub.masked).toMatchSnapshot();
      });
    });

    when('[t1] init.sh is absent and apply must scaffold', () => {
      then('it halts (exit 1) and names the broken install', () => {
        expect(scene.apply.exitCode).toBe(1);
        expect(scene.apply.stdout).toContain(
          'the route scaffold (init.sh) is absent or not executable',
        );
        expect(scene.apply.masked).toMatchSnapshot();
      });
    });

    when('[t4] init.sh is present but not executable', () => {
      then('init and apply each halt (exit 1) on the install guard', () => {
        [scene.noexecInit, scene.noexecApply].map((run) => {
          expect(run.exitCode).toBe(1);
          expect(run.stdout).toContain(
            'the route scaffold (init.sh) is absent or not executable',
          );
        });
        // one snapshot per render, so the render audit reads each as its own
        expect(scene.noexecInit.masked).toMatchSnapshot();
        expect(scene.noexecApply.masked).toMatchSnapshot();
      });
    });

    when('[t2] apply runs outside a git repository', () => {
      then('it belays (exit 2) before any plan or probe', () => {
        expect(scene.notRepo.exitCode).toBe(2);
        expect(scene.notRepo.stdout).toContain('not in a git repository');
        expect(scene.notRepo.stdout).not.toContain('chartin course');
        expect(scene.notRepo.stdout).toMatchSnapshot();
      });
    });
  });

  given(
    '[case26] the vision journey: init, then plan + apply at 6 peers / 3 cycles',
    () => {
      // init records the default 3 peers / 1 cycle and binds; plan prints the 6/3 cost; apply
      // must reuse the bound route (same scope + grain) and adopt the 6/3 the plan printed
      const scene = useBeforeAll(async () => {
        const dir = setupHabitat({ slug: 'redteam-journey' });
        const env = { PATH: genGuardianStubBinPath() };
        const run = (args: string) =>
          runGuardianSkill({ skill: SKILL, args, cwd: dir }, { env });
        const init = run('init --scope . --grain all');
        const plan = run(
          '--scope . --grain all --peers 6 --budget 3 --mode plan',
        );
        const apply = run(
          '--scope . --grain all --peers 6 --budget 3 --mode apply',
        );
        return {
          init,
          plan,
          apply,
          scopeRecord: readFileSync(
            join(findRouteDir(dir), '0.scope.md'),
            'utf-8',
          ),
        };
      });

      when('[t0] the three commands run in order', () => {
        then('init binds the route (exit 0)', () => {
          expect(scene.init.exitCode).toBe(0);
          expect(scene.init.stdout).toContain('bound to branch main');
        });

        then('plan prints the 6/3 cost (exit 0)', () => {
          expect(scene.plan.exitCode).toBe(0);
          expect(scene.plan.stdout).toContain('up to 54 peer-dispatch runs');
        });

        then('apply reuses the bound route and adopts 6/3 (exit 0)', () => {
          expect(scene.apply.exitCode).toBe(0);
          expect(scene.apply.stdout).toContain(
            'reused the bound route; peers=6 budget=3 adopted',
          );
          expect(scene.scopeRecord).toContain('- peers: 6');
          expect(scene.scopeRecord).toContain('- budget: 3');
          expect(maskRouteDate(scene.apply.stdout)).toMatchSnapshot();
        });
      });
    },
  );

  given('[case27] init and apply run from a subtree', () => {
    // the route must land at the repo root, where route.drive looks, and name the surface
    // from the root — never `src/.behavior/`, never a reuse that reads a healthy route as gone
    const scene = useBeforeAll(async () => {
      const dir = setupHabitat({ slug: 'redteam-subtree' });
      const src = join(dir, 'src');
      mkdirSync(src, { recursive: true });
      writeFileSync(join(src, 'a.ts'), 'export const a = 1;\n');
      const env = { PATH: genGuardianStubBinPath() };
      const init = runGuardianSkill(
        { skill: INIT, args: '--scope . --grain leak', cwd: src },
        { env },
      );
      const apply = runGuardianSkill(
        { skill: SKILL, args: '--scope . --grain leak --mode apply', cwd: src },
        { env },
      );
      const route = findRouteDir(dir);
      return {
        init,
        apply,
        route,
        scopeRecord: readFileSync(join(route, '0.scope.md'), 'utf-8'),
        nestedBehavior: existsSync(join(src, '.behavior')),
      };
    });

    when('[t0] init runs from src/ with --scope .', () => {
      then('the route lands at the repo root and records scope=src', () => {
        expect(scene.init.exitCode).toBe(0);
        expect(basename(scene.route)).toContain('.scope=src');
        expect(scene.scopeRecord).toContain('- scope: src');
        expect(scene.nestedBehavior).toBe(false);
        expect(maskRouteDate(scene.init.stdout)).toMatchSnapshot();
      });
    });

    when('[t1] apply runs from src/ against that bound route', () => {
      then('it reuses the healthy route (exit 0)', () => {
        expect(scene.apply.exitCode).toBe(0);
        expect(scene.apply.stdout).toContain('reused the bound route');
        expect(maskRouteDate(scene.apply.stdout)).toMatchSnapshot();
      });
    });
  });

  given('[case28] apply --skip-route-bind runs twice on one day', () => {
    // the second run meets init's clobber refusal; that is a constraint the caller fixes
    // (drive or remove the route), so apply keeps its sense: exit 2, never a malfunction
    const scene = useBeforeAll(async () => {
      const dir = setupHabitat({ slug: 'redteam-skip-rerun' });
      const env = { PATH: genGuardianStubBinPath() };
      const run = () =>
        runGuardianSkill(
          {
            skill: SKILL,
            args: '--scope . --grain leak --mode apply --skip-route-bind',
            cwd: dir,
          },
          { env },
        );
      return { first: run(), second: run() };
    });

    when('[t0] the same apply runs again', () => {
      then('the first scaffolds (exit 0)', () => {
        expect(scene.first.exitCode).toBe(0);
      });

      then(
        'the second belays as a constraint (exit 2) and names the route',
        () => {
          expect(scene.second.exitCode).toBe(2);
          expect(scene.second.stdout).toContain('already stands today');
          expect(scene.second.stdout).toContain(
            'blocked: ✋ ConstraintError: the scaffold did not land clean',
          );
          expect(maskRouteDate(scene.second.stdout)).toMatchSnapshot();
        },
      );
    });
  });

  given(
    '[case35] distinct sweeps each get their own route; an identical sweep collides',
    () => {
      // the slug folds the grain + a subtree token so two same-day sweeps of different surfaces
      // each get a route; only an identical third sweep meets the clobber refusal
      const scene = useBeforeAll(async () => {
        const dir = setupHabitat({ slug: 'redteam-same-day' });
        mkdirSync(join(dir, 'src'));
        const init = (args: string) =>
          runGuardianSkill(
            { skill: INIT, args: `${args} --skip-route-bind`, cwd: dir },
            { env: { PATH: PATH_WITHOUT_RHX } },
          );
        const rootLeak = init('--scope . --grain leak');
        const rootInfil = init('--scope . --grain infil');
        const srcLeak = init('--scope src --grain leak');
        const rootLeakAgain = init('--scope . --grain leak');
        const routes = readdirSync(join(dir, '.behavior')).sort();
        return { dir, rootLeak, rootInfil, srcLeak, rootLeakAgain, routes };
      });

      when('[t0] the grain or the scope differs', () => {
        then('each sweep scaffolds its own route (exit 0)', () => {
          expect(scene.rootLeak.exitCode).toBe(0);
          expect(scene.rootInfil.exitCode).toBe(0);
          expect(scene.srcLeak.exitCode).toBe(0);
          expect(scene.routes).toHaveLength(3);
        });

        // one snapshot per render: the repo-wide render audit grades each entry as one render
        (['rootLeak', 'rootInfil', 'srcLeak'] as const).map((key) =>
          then(`${key}: its init render is pinned whole`, () => {
            expect(scene[key].exitCode).toBe(0);
            expect(scene[key].stdout).toContain('route:');
            expect(maskRouteDate(scene[key].stdout)).toMatchSnapshot();
          }),
        );

        then('each route holds its own claims path', () => {
          scene.routes.map((route) =>
            expect(
              existsSync(
                join(scene.dir, '.behavior', route, '.claims', '.gitignore'),
              ),
            ).toBe(true),
          );
          expect(
            scene.routes.map((route) => maskRouteDate(`.behavior/${route}`)),
          ).toMatchSnapshot();
        });
      });

      when('[t1] an identical sweep runs again the same day', () => {
        then(
          'it belays the clobber (exit 2) and the three routes stand',
          () => {
            expect(scene.rootLeakAgain.exitCode).toBe(2);
            expect(scene.rootLeakAgain.stdout).toContain(
              'a route for this grain + scope already stands today',
            );
            expect(readdirSync(join(scene.dir, '.behavior'))).toHaveLength(3);
          },
        );
      });
    },
  );
});

describe('security.habitat.redteam (halt renders)', () => {
  given('[case30] apply halts loud when a system part breaks', () => {
    // each apply halt is a render an operator reads; each is driven for real (a broken tool
    // on PATH, a stub knob that breaks the one call it targets, a damaged install) and snapped
    const runApply = (input: {
      args: string;
      cwd: string;
      skillRoot: string | null;
      env: Record<string, string>;
    }) => {
      const run =
        input.skillRoot === null
          ? runGuardianSkill(
              { skill: SKILL, args: input.args, cwd: input.cwd },
              { env: input.env },
            )
          : runRoleSkill(
              {
                skillPath: join(input.skillRoot, SKILL),
                args: input.args,
                cwd: input.cwd,
              },
              { env: input.env },
            );
      const masked = maskRouteDate(
        maskSkillPath({ out: run.stdout, skillRoot: input.skillRoot }),
      );
      return { ...run, masked };
    };
    const APPLY = '--scope . --grain leak --mode apply';
    const FOREIGN = '.behavior/v2026_01_01.some-other-feature';

    const scene = useBeforeAll(async () => {
      // a bound route, healthy on disk, that the reuse path adopts into
      const adoptDir = setupHabitat({ slug: 'redteam-apply-adopt' });
      runGuardianSkill(
        {
          skill: INIT,
          args: '--scope . --grain leak --skip-route-bind',
          cwd: adoptDir,
        },
        { env: { PATH: PATH_WITHOUT_RHX } },
      );
      const adoptRoute = join('.behavior', basename(findRouteDir(adoptDir)));

      // a bound route whose scope record holds a count no drive can take
      const invalidDir = setupHabitat({ slug: 'redteam-apply-invalid-count' });
      runGuardianSkill(
        {
          skill: INIT,
          args: '--scope . --grain leak --skip-route-bind',
          cwd: invalidDir,
        },
        { env: { PATH: PATH_WITHOUT_RHX } },
      );
      const invalidRoute = findRouteDir(invalidDir);
      writeFileSync(
        join(invalidRoute, '0.scope.md'),
        readFileSync(join(invalidRoute, '0.scope.md'), 'utf-8').replace(
          '- peers: 3',
          '- peers: 0',
        ),
      );
      // a bound route whose scope record stands but lacks one field: a one-line edit, never a rebind
      const fieldAbsentDir = setupHabitat({
        slug: 'redteam-apply-field-absent',
      });
      runGuardianSkill(
        {
          skill: INIT,
          args: '--scope . --grain leak --skip-route-bind',
          cwd: fieldAbsentDir,
        },
        { env: { PATH: PATH_WITHOUT_RHX } },
      );
      const fieldAbsentRoute = findRouteDir(fieldAbsentDir);
      writeFileSync(
        join(fieldAbsentRoute, '0.scope.md'),
        readFileSync(join(fieldAbsentRoute, '0.scope.md'), 'utf-8').replace(
          '- peers: 3\n',
          '',
        ),
      );

      // a bound route whose record is whole, read by a grep that breaks: a retry, never a rebind
      const fieldReadBrokeDir = setupHabitat({
        slug: 'redteam-apply-field-read-broke',
      });
      runGuardianSkill(
        {
          skill: INIT,
          args: '--scope . --grain leak --skip-route-bind',
          cwd: fieldReadBrokeDir,
        },
        { env: { PATH: PATH_WITHOUT_RHX } },
      );
      const fieldReadBrokeRoute = findRouteDir(fieldReadBrokeDir);

      return {
        fieldAbsent: runApply({
          args: APPLY,
          cwd: fieldAbsentDir,
          skillRoot: null,
          env: {
            PATH: genGuardianStubBinPath(),
            STUB_BOUND_ROUTE: join('.behavior', basename(fieldAbsentRoute)),
          },
        }),
        fieldReadBroke: runApply({
          args: APPLY,
          cwd: fieldReadBrokeDir,
          skillRoot: null,
          env: {
            PATH: `${genBrokenToolBin({ tool: 'grep', exitCode: 2, failOn: '- peers: ' })}:${genGuardianStubBinPath()}`,
            STUB_BOUND_ROUTE: join('.behavior', basename(fieldReadBrokeRoute)),
          },
        }),
        invalidCount: runApply({
          args: APPLY,
          cwd: invalidDir,
          skillRoot: null,
          env: {
            PATH: genGuardianStubBinPath(),
            STUB_BOUND_ROUTE: join('.behavior', basename(invalidRoute)),
          },
        }),
        // the halt's own remedy: pass both counts, and the request's counts override the record
        invalidCountFixed: (() => {
          const run = runApply({
            args: `${APPLY} --peers 3 --budget 2`,
            cwd: invalidDir,
            skillRoot: null,
            env: {
              PATH: genGuardianStubBinPath(),
              STUB_BOUND_ROUTE: join('.behavior', basename(invalidRoute)),
            },
          });
          return {
            ...run,
            record: readFileSync(join(invalidRoute, '0.scope.md'), 'utf-8'),
          };
        })(),
        initRenderBroken: runApply({
          args: `${APPLY} --skip-route-bind`,
          cwd: setupHabitat({ slug: 'redteam-apply-render-broken' }),
          skillRoot: null,
          env: {
            PATH: `${genBrokenToolBin({ tool: 'grep', exitCode: 2, failOnStdin: '─ route: ' })}:${genGuardianStubBinPath()}`,
          },
        }),
        skipBindPartial: runApply({
          args: `${APPLY} --skip-route-bind`,
          cwd: setupHabitat({ slug: 'redteam-apply-partial' }),
          skillRoot: genSkillCopy({ damage: 'init-partial' }),
          env: { PATH: genGuardianStubBinPath() },
        }),
        gitProbeBroken: runApply({
          args: APPLY,
          cwd: setupHabitat({ slug: 'redteam-apply-git' }),
          skillRoot: null,
          env: {
            PATH: `${genBrokenToolBin({ tool: 'git', exitCode: 1 })}:${genGuardianStubBinPath()}`,
          },
        }),
        rootBroken: runApply({
          args: APPLY,
          cwd: setupHabitat({ slug: 'redteam-apply-root' }),
          skillRoot: null,
          env: {
            PATH: `${genBrokenToolBin({ tool: 'git', exitCode: 1, failOn: 'show-toplevel' })}:${genGuardianStubBinPath()}`,
          },
        }),
        adoptBroken: runApply({
          args: `${APPLY} --budget 4`,
          cwd: adoptDir,
          skillRoot: null,
          env: {
            PATH: `${genBrokenToolBin({ tool: 'cat', exitCode: 1 })}:${genGuardianStubBinPath()}`,
            STUB_BOUND_ROUTE: adoptRoute,
          },
        }),
        skipBindAbsent: runApply({
          args: `${APPLY} --skip-route-bind`,
          cwd: setupHabitat({ slug: 'redteam-apply-noop' }),
          skillRoot: genSkillCopy({ damage: 'init-noop' }),
          env: { PATH: genGuardianStubBinPath() },
        }),
        // init renders a route line, yet no route dir stands at it: trust the disk, not the render
        skipBindGhost: runApply({
          args: `${APPLY} --skip-route-bind`,
          cwd: setupHabitat({ slug: 'redteam-apply-ghost' }),
          skillRoot: genSkillCopy({ damage: 'init-ghost' }),
          env: { PATH: genGuardianStubBinPath() },
        }),
        // a prior day's route for this very sweep stands, and today's init makes naught: the
        // handoff must never name the stale route as the one this run made
        skipBindStale: runApply({
          args: `${APPLY} --skip-route-bind`,
          cwd: genHabitatWithStaleRoute({ slug: 'redteam-apply-stale' }),
          skillRoot: genSkillCopy({ damage: 'init-noop' }),
          env: { PATH: genGuardianStubBinPath() },
        }),
        reprobeBroken: runApply({
          args: APPLY,
          cwd: setupHabitat({ slug: 'redteam-apply-reprobe-broken' }),
          skillRoot: null,
          env: { PATH: genGuardianStubBinPath(), STUB_BIND_GET_FAIL_ON: '4' },
        }),
        reprobeEmpty: runApply({
          args: APPLY,
          cwd: setupHabitat({ slug: 'redteam-apply-reprobe-empty' }),
          skillRoot: null,
          env: { PATH: genGuardianStubBinPath(), STUB_BIND_GET_EMPTY_ON: '4' },
        }),
        reprobeForeign: runApply({
          args: APPLY,
          cwd: setupHabitat({ slug: 'redteam-apply-reprobe-foreign' }),
          skillRoot: null,
          env: {
            PATH: genGuardianStubBinPath(),
            STUB_BIND_GET_FOREIGN_ON: '4',
            STUB_FOREIGN_ROUTE: FOREIGN,
          },
        }),
        // init makes and renders naught on the bound path: the run halts on "named no route",
        // never on a clock-derived route this run did not make
        reprobeNoRender: runApply({
          args: APPLY,
          cwd: setupHabitat({ slug: 'redteam-apply-reprobe-norender' }),
          skillRoot: genSkillCopy({ damage: 'init-noop' }),
          env: { PATH: genGuardianStubBinPath() },
        }),
        // the read of init's render breaks: the halt names the cause, never a guessed path
        reprobeRenderBroken: runApply({
          args: APPLY,
          cwd: setupHabitat({ slug: 'redteam-apply-reprobe-render-broken' }),
          skillRoot: null,
          env: {
            PATH: `${genBrokenToolBin({ tool: 'grep', exitCode: 2, failOnStdin: '─ route: ' })}:${genGuardianStubBinPath()}`,
            STUB_BIND_GET_EMPTY_ON: '4',
          },
        }),
        // a same-kind bind that landed in the window: never adopted as this run's route
        reprobeOtherRedteam: runApply({
          args: APPLY,
          cwd: setupHabitat({ slug: 'redteam-apply-reprobe-other' }),
          skillRoot: null,
          env: {
            PATH: genGuardianStubBinPath(),
            STUB_BIND_GET_FOREIGN_ON: '4',
            STUB_FOREIGN_ROUTE:
              '.behavior/v2026_01_01.guardian-redteam.grain=exfil',
          },
        }),
      };
    });

    const MALFUNCTIONS = [
      {
        key: 'fieldAbsent',
        says: "fix: set '- peers: <value>' in",
      },
      {
        key: 'fieldReadBroke',
        says: 'grep broke (rc=2)',
      },
      {
        key: 'invalidCount',
        says: "the bound route's scope record holds an invalid count",
      },
      {
        key: 'initRenderBroken',
        says: "could not read the route from init's render",
      },
      {
        key: 'skipBindPartial',
        says: 'a partial route cannot be driven to terminal',
      },
      {
        key: 'gitProbeBroken',
        says: 'git malfunctioned while it probed the repo',
      },
      {
        key: 'rootBroken',
        says: 'git malfunctioned while it read the repo root',
      },
      {
        key: 'adoptBroken',
        says: "could not adopt this request's peers + budget into the bound route",
      },
      {
        key: 'skipBindAbsent',
        says: 'init reported clean, but named no route that stands under .behavior/',
      },
      {
        key: 'skipBindStale',
        says: 'init reported clean, but named no route that stands under .behavior/',
      },
      {
        key: 'skipBindGhost',
        says: 'init reported clean, but named no route that stands under .behavior/',
      },
      {
        key: 'reprobeBroken',
        says: 'the scaffold landed, but the re-probe of the bound route broke',
      },
      {
        key: 'reprobeEmpty',
        says: 'the scaffold landed, but no redteam route reads back bound',
      },
      {
        key: 'reprobeNoRender',
        says: 'init reported clean, but named no route that stands under .behavior/',
      },
      {
        key: 'reprobeRenderBroken',
        says: "the route it made could not be read from init's render",
      },
      {
        key: 'reprobeOtherRedteam',
        says: 'reads back bound to another redteam route (a concurrent bind won)',
      },
    ] as const;

    when('[t0] the system broke', () => {
      MALFUNCTIONS.map((thisCase) =>
        then(`${thisCase.key}: a malfunction (exit 1), named, snapped`, () => {
          const run = scene[thisCase.key];
          expect(run.exitCode).toBe(1);
          expect(run.stdout).toContain('🐈 wet paws...');
          expect(run.stdout).toContain('halted: 💥 MalfunctionError');
          expect(run.stdout).toContain(thisCase.says);
          expect(run.masked).toMatchSnapshot();
        }),
      );

      then(
        'a lacked field names the in-place edit, a read break names the retry; neither offers the rebind',
        () => {
          // a rebind removes the route dir and the .claims/ it holds — wrong for either fault
          expect(scene.fieldAbsent.stdout).toContain(
            "could not read the bound route's scope record",
          );
          expect(scene.fieldAbsent.stdout).not.toContain('rhx route.bind.del');
          expect(scene.fieldReadBroke.stdout).toContain(
            'check the tool the cause names',
          );
          expect(scene.fieldReadBroke.stdout).not.toContain(
            'rhx route.bind.del',
          );
        },
      );
    });

    when(
      '[t1] a foreign bind lands between the scaffold and the re-probe',
      () => {
        then(
          'it belays as a constraint (exit 2) and names the foreign route',
          () => {
            expect(scene.reprobeForeign.exitCode).toBe(2);
            expect(scene.reprobeForeign.stdout).toContain(
              `a different route is bound to this branch: ${FOREIGN}`,
            );
            expect(scene.reprobeForeign.stdout).toContain(
              'blocked: ✋ ConstraintError',
            );
            expect(scene.reprobeForeign.masked).toMatchSnapshot();
          },
        );
      },
    );

    when('[t2] the invalid counts are passed fresh after the halt', () => {
      then('the halt clears and both counts are adopted (exit 0)', () => {
        expect(scene.invalidCountFixed.exitCode).toBe(0);
        expect(scene.invalidCountFixed.stdout).toContain(
          'peers=3 budget=2 adopted; was peers=0 budget=1)',
        );
        expect(scene.invalidCountFixed.record).toContain('- peers: 3');
        expect(scene.invalidCountFixed.record).toContain('- budget: 2');
        expect(maskRouteDate(scene.invalidCountFixed.stdout)).toMatchSnapshot();
      });
    });
  });

  given('[case31] init reads its bind back, and the read-back fails', () => {
    // a bind that did not take is a malfunction of a stated guarantee: each cause is named,
    // never collapsed into a false "bound"
    const runInitBind = (input: {
      slug: string;
      env: Record<string, string>;
    }) => {
      const run = runGuardianSkill(
        {
          skill: INIT,
          args: '--scope . --grain leak',
          cwd: setupHabitat({ slug: input.slug }),
        },
        { env: { PATH: genGuardianStubBinPath(), ...input.env } },
      );
      return { ...run, masked: maskRouteDate(run.stdout) };
    };

    const scene = useBeforeAll(async () => ({
      // get call 1 = init's probe, 2 = the read-back after the bind
      readbackFailed: runInitBind({
        slug: 'redteam-bind-readback-failed',
        env: { STUB_BIND_GET_FAIL_ON: '2' },
      }),
      notPersisted: runInitBind({
        slug: 'redteam-bind-not-persisted',
        env: { STUB_BIND_GET_EMPTY_ON: '2' },
      }),
      unparseable: runSourcedBash({
        expression:
          'extract_any_route_path() { echo "grep: simulated break" >&2; return 1; }; set_route_bind ".behavior/v2026_01_01.guardian-redteam.grain=leak" main',
        stdin: '',
        env: { PATH: genGuardianStubBinPath() },
      }),
    }));

    when('[t0] the read-back call itself fails', () => {
      then('init halts (exit 1) and names the read-back failure', () => {
        expect(scene.readbackFailed.exitCode).toBe(1);
        expect(scene.readbackFailed.stdout).toContain(
          'not bound: read-back failed; said: stub rhx: route.bind.get refused',
        );
        expect(scene.readbackFailed.stdout).not.toContain('bound to branch');
        expect(scene.readbackFailed.masked).toMatchSnapshot();
      });
    });

    when('[t1] the bind did not persist', () => {
      then('init halts (exit 1) and says to retry the bind', () => {
        expect(scene.notPersisted.exitCode).toBe(1);
        expect(scene.notPersisted.stdout).toContain(
          'not bound: the bind did not persist; the branch reads back bound to no route',
        );
        expect(scene.notPersisted.stdout).toContain(
          'fix: retry rhx route.bind.set --route',
        );
        expect(scene.notPersisted.masked).toMatchSnapshot();
      });
    });

    when('[t2] the read-back cannot be parsed', () => {
      then('the bind returns 1 and names the parse break', () => {
        expect(scene.unparseable.status).toBe(1);
        expect(scene.unparseable.stdout).toContain(
          'not bound: read-back unparseable; said: grep: simulated break',
        );
        expect(scene.unparseable.stdout).toMatchSnapshot();
      });
    });
  });

  given('[case32] two carries for one cycle race', () => {
    // a block write is check-then-append; the lock must hold two racers to one block, or the
    // cycle count the budget cap reads would inflate
    const scene = useBeforeAll(async () => {
      const dir = genTempDir({ slug: 'redteam-carry-race' });
      const route = join(dir, '.behavior', 'v2026_01_01.redteam-race');
      mkdirSync(join(route, '.claims'), { recursive: true });
      const run = runSourcedBash({
        expression:
          // each racer's status is witnessed: one failed carry exits the whole run non-zero
          'pids=(); for i in 1 2 3 4 5 6 7 8; do set_cycle_carry "$ROUTE" 1 3 "infil::launch-flag-control-channel" & pids+=("$!"); done; rc=0; for pid in "${pids[@]}"; do wait "$pid" || rc=1; done; exit "$rc"',
        stdin: '',
        env: { PATH: PATH_WITHOUT_RHX, ROUTE: route },
      });
      return {
        run,
        record: readFileSync(join(route, '.claims', '0.cycle.md'), 'utf-8'),
        lockLeft: existsSync(join(route, '.claims', '0.cycle.md.lock')),
      };
    });

    when('[t0] eight carries run at once', () => {
      then('the record holds one block for the cycle', () => {
        expect(scene.run.status).toBe(0);
        // one block also follows from seven starved racers; a time-out must redden it
        expect(scene.run.stderr).not.toContain('could not take the lock');
        expect(scene.run.stdout).not.toContain('could not take the lock');
        expect(scene.record.split('## cycle 1').length - 1).toBe(1);
        expect(
          scene.record.split(
            '- carried PENDING-REDETECT: infil::launch-flag-control-channel',
          ).length - 1,
        ).toBe(1);
      });

      then('the lock is released', () => {
        expect(scene.lockLeft).toBe(false);
      });
    });
  });

  given('[case36] the rewind-detect command meets a bad request', () => {
    // the gate writes into a route, so a request that names no route, no count, or a path
    // outside .behavior/ belays (exit 2) before any read or write, each with its fix
    const scene = useBeforeAll(async () => {
      const habitat = setupHabitat({ slug: 'redteam-rewind-request' });
      const outside = genTempDir({ slug: 'redteam-rewind-outside' });
      const run = (input: { args: string; cwd: string }) => {
        const result = runSourcedBash({
          expression: `cd "$CWD" && bash --noprofile --norc "$SKILL_SH" rewind-detect ${input.args}`,
          stdin: '',
          env: {
            SKILL_SH: join(__dirname, SKILL),
            CWD: input.cwd,
            PATH: genGuardianStubBinPath(),
          },
        });
        return {
          ...result,
          stdout: result.stdout.split(input.cwd).join('<habitat>'),
        };
      };
      return {
        absentRoute: run({ args: '--cycle 1', cwd: habitat }),
        absentCycle: run({
          args: '--route .behavior/v2026_01_01.x',
          cwd: habitat,
        }),
        invalidCycle: run({
          args: '--route .behavior/v2026_01_01.x --cycle abc',
          cwd: habitat,
        }),
        leadZeroCycle: run({
          args: '--route .behavior/v2026_01_01.x --cycle 01',
          cwd: habitat,
        }),
        overCapCycle: run({
          args: '--route .behavior/v2026_01_01.x --cycle 10000',
          cwd: habitat,
        }),
        outsideBehavior: run({
          args: '--route ../elsewhere --cycle 1',
          cwd: habitat,
        }),
        absentRouteDir: run({
          args: '--route .behavior/v2026_01_01.gone --cycle 1',
          cwd: habitat,
        }),
        notARepo: run({
          args: '--route .behavior/v2026_01_01.x --cycle 1',
          cwd: outside,
        }),
        // another skill's route stands on disk, with the same 2.detect stone
        foreignKind: (() => {
          const foreign = join(
            habitat,
            '.behavior',
            'v2026_01_01.cicd-deflake',
          );
          mkdirSync(join(foreign, '.claims'), { recursive: true });
          writeFileSync(join(foreign, '2.detect.stone'), '');
          writeFileSync(join(foreign, '0.scope.md'), '- budget: 3\n');
          const result = run({
            args: '--route .behavior/v2026_01_01.cicd-deflake --cycle 1',
            cwd: habitat,
          });
          return {
            ...result,
            claimsAfter: readdirSync(join(foreign, '.claims')),
          };
        })(),
        // a redteam route that went partial on disk (one stone left): no cycle is spent on it
        partialRoute: (() => {
          const partial = join(
            habitat,
            '.behavior',
            `v2026_01_01.${ROUTE_KIND}.partial`,
          );
          mkdirSync(join(partial, '.claims'), { recursive: true });
          writeFileSync(join(partial, '2.detect.stone'), '');
          writeFileSync(join(partial, '0.scope.md'), '- budget: 3\n');
          const result = run({
            args: `--route .behavior/v2026_01_01.${ROUTE_KIND}.partial --cycle 1`,
            cwd: habitat,
          });
          return {
            ...result,
            claimsAfter: readdirSync(join(partial, '.claims')),
          };
        })(),
        // the same route, spelled with a `./` lead and an end slash, as a shell completion writes it
        partialRouteDotSlash: run({
          args: `--route ./.behavior/v2026_01_01.${ROUTE_KIND}.partial/ --cycle 1`,
          cwd: habitat,
        }),
      };
    });

    when('[t2] the route is spelled with a ./ lead', () => {
      then(
        'it reads as the same route, never "not a route under .behavior/"',
        () => {
          expect(scene.partialRouteDotSlash.status).toBe(1);
          expect(scene.partialRouteDotSlash.stdout).not.toContain(
            'not a route under .behavior/',
          );
          expect(scene.partialRouteDotSlash.stdout).toEqual(
            scene.partialRoute.stdout,
          );
        },
      );
    });

    when('[t1] the route is a redteam route gone partial on disk', () => {
      then('it halts (exit 1), lists the absent files, writes naught', () => {
        expect(scene.partialRoute.status).toBe(1);
        expect(scene.partialRoute.stdout).toContain(
          'a partial route cannot be driven to terminal',
        );
        expect(scene.partialRoute.stdout).toContain(
          'fix: restore the absent files',
        );
        expect(scene.partialRoute.claimsAfter).toEqual([]);
        expect(scene.partialRoute.stdout).toMatchSnapshot();
      });
    });

    const CASES = [
      { key: 'absentRoute', says: 'absent required arg: --route' },
      { key: 'absentCycle', says: 'absent required arg: --cycle' },
      { key: 'invalidCycle', says: 'invalid --cycle: abc' },
      { key: 'leadZeroCycle', says: 'invalid --cycle: 01' },
      { key: 'overCapCycle', says: 'invalid --cycle: 10000' },
      {
        key: 'outsideBehavior',
        says: 'not a route under .behavior/: ../elsewhere',
      },
      {
        key: 'absentRouteDir',
        says: 'no route stands at .behavior/v2026_01_01.gone',
      },
      { key: 'notARepo', says: 'not in a git repository' },
      {
        key: 'foreignKind',
        says: 'not a guardian-redteam route: .behavior/v2026_01_01.cicd-deflake',
      },
    ] as const;

    when('[t0] each bad request is run', () => {
      CASES.map((thisCase) =>
        then(
          `${thisCase.key}: belays (exit 2), named, with its fix, snapped`,
          () => {
            const run = scene[thisCase.key];
            expect(run.status).toBe(2);
            expect(run.stdout).toContain(thisCase.says);
            expect(run.stdout).toContain('fix:');
            expect(run.stdout).toMatchSnapshot();
          },
        ),
      );

      then('a bad cycle never reads as an out-of-order cycle', () => {
        expect(scene.invalidCycle.stdout).not.toContain('out of order');
      });

      then('a bad cycle names the counted range it enforces', () => {
        expect(scene.leadZeroCycle.stdout).toContain(
          'fix: pass the cycle just walked as a count, 1 to 9999, no lead zero',
        );
      });

      then("another skill's route is left untouched: no cycle record", () => {
        expect(scene.foreignKind.claimsAfter).toEqual([]);
      });
    });
  });

  given(
    '[case37] a command meets a flag it does not read, or an empty lesson',
    () => {
      // a dropped flag reads as obeyed, so each command belays on a flag outside its own set; an
      // empty lesson is no lesson, so the gate belays with naught sent
      const scene = useBeforeAll(async () => {
        const habitat = setupHabitat({ slug: 'redteam-foreign-flag' });
        const radioLog = join(habitat, 'radio.log');
        writeFileSync(radioLog, '');
        const run = (input: { args: string; stdin: string }) => {
          const result = runSourcedBash({
            expression: `cd "$CWD" && bash --noprofile --norc "$SKILL_SH" ${input.args}`,
            stdin: input.stdin,
            env: {
              SKILL_SH: join(__dirname, SKILL),
              CWD: habitat,
              PATH: genGuardianStubBinPath(),
              STUB_RADIO_LOG: radioLog,
            },
          });
          return {
            ...result,
            stdout: result.stdout.split(habitat).join('<habitat>'),
          };
        };
        const runs = {
          dispatchWithRoute: run({
            args: "dispatch-lesson --title 'egress: allowlist' --route .behavior/v2026_01_01.x",
            stdin: 'an egress path with no allowlist',
          }),
          rewindWithTitle: run({
            args: "rewind-detect --route .behavior/v2026_01_01.x --cycle 1 --title 'x: y'",
            stdin: '',
          }),
          planWithCycle: run({
            args: '--scope . --grain leak --mode plan --cycle 2',
            stdin: '',
          }),
          initWithRoute: run({
            args: 'init --scope . --grain leak --skip-route-bind --route .behavior/v2026_01_01.x',
            stdin: '',
          }),
          emptyBody: run({
            args: "dispatch-lesson --title 'egress: allowlist'",
            stdin: '  \n\t\n',
          }),
          // init via this skill, with a bad sweep input: the same render init.sh gives direct
          initAbsentScope: run({
            args: 'init --grain leak --skip-route-bind',
            stdin: '',
          }),
          initInvalidGrain: run({
            args: 'init --scope . --grain sideways --skip-route-bind',
            stdin: '',
          }),
        };
        return {
          ...runs,
          sent: readFileSync(radioLog, 'utf-8'),
          behaviorMade: existsSync(join(habitat, '.behavior')),
        };
      });

      const CASES = [
        {
          key: 'dispatchWithRoute',
          says: 'flag not read by this command: --route',
        },
        {
          key: 'rewindWithTitle',
          says: 'flag not read by this command: --title',
        },
        {
          key: 'planWithCycle',
          says: 'flag not read by this command: --cycle',
        },
        {
          key: 'initWithRoute',
          says: 'flag not read by this command: --route',
        },
        { key: 'emptyBody', says: 'the lesson body is empty; naught was sent' },
        { key: 'initAbsentScope', says: 'absent required arg: --scope' },
        { key: 'initInvalidGrain', says: 'invalid grain: sideways' },
      ] as const;

      when('[t0] each request is run', () => {
        CASES.map((thisCase) =>
          then(
            `${thisCase.key}: belays (exit 2), named, with its fix, snapped`,
            () => {
              const run = scene[thisCase.key];
              expect(run.status).toBe(2);
              expect(run.stdout).toContain(thisCase.says);
              expect(run.stdout).toContain('fix:');
              expect(run.stdout).toMatchSnapshot();
            },
          ),
        );

        then('no lesson reached the radio, and no route was made', () => {
          expect(scene.sent).toEqual('');
          expect(scene.behaviorMade).toBe(false);
        });

        then(
          'an init slip via this skill renders under init, and points at init help',
          () => {
            [
              scene.initAbsentScope,
              scene.initInvalidGrain,
              scene.initWithRoute,
            ].map((run) => {
              expect(run.stdout).toContain(
                '🧿 security.habitat.redteam init\n',
              );
              expect(run.stdout).toContain(
                'hint: rhx security.habitat.redteam init --help',
              );
            });
          },
        );
      });
    },
  );

  given('[case41] the backup-before-rewrite gate, on real repos', () => {
    // the one deterministic rail under 4.repair's history rewrite: a dirty tree refuses, and a
    // clean one gets a backup branch at HEAD, read back, before any commit is rewritten
    const runGitIn = (input: { dir: string; args: string }): string =>
      String(
        execSync(
          `git -c user.name=Test -c user.email=human@example.com ${input.args}`,
          { cwd: input.dir, env: asEnvHermetic(), timeout: 60_000 },
        ),
      ).trim();
    const genHabitatWithCommit = (input: { slug: string }): string => {
      const dir = setupHabitat({ slug: input.slug });
      writeFileSync(join(dir, 'seed.txt'), 'seed\n');
      runGitIn({ dir, args: 'add seed.txt' });
      runGitIn({ dir, args: 'commit -q -m seed' });
      return dir;
    };
    const runGate = (input: { dir: string; args?: string }) =>
      runGuardianSkill(
        {
          skill: SKILL,
          args: `backup-before-rewrite${input.args ? ` ${input.args}` : ''}`,
          cwd: input.dir,
        },
        { env: { PATH: PATH_WITHOUT_RHX } },
      );
    const getBackupBranches = (input: { dir: string }): string[] =>
      runGitIn({
        dir: input.dir,
        args: 'for-each-ref "--format=%(refname)" refs/redteam-backup/',
      })
        .split('\n')
        .filter((line) => line.length > 0);
    const maskSha = (out: string): string =>
      out.replace(/\b[0-9a-f]{12}\b/g, '<sha12>');

    const scene = useBeforeAll(async () => {
      // a clean tree: the gate backs up, then a re-run at one HEAD finds the same backup
      const cleanDir = genHabitatWithCommit({ slug: 'redteam-backup-clean' });
      const head = runGitIn({ dir: cleanDir, args: 'rev-parse HEAD' });
      const clean = runGate({ dir: cleanDir });
      const rerun = runGate({ dir: cleanDir });
      const cleanBackups = getBackupBranches({ dir: cleanDir });
      const backupHead = runGitIn({
        dir: cleanDir,
        args: `rev-parse ${cleanBackups[0] ?? 'absent'}`,
      });

      // a push of every branch and tag to a remote never carries the backup, which still holds
      // the value a redact removed
      const remoteDir = genTempDir({ slug: 'redteam-backup-remote' });
      runGitIn({ dir: remoteDir, args: 'init -q --bare' });
      runGitIn({ dir: cleanDir, args: `push -q --all ${remoteDir}` });
      runGitIn({ dir: cleanDir, args: `push -q --tags ${remoteDir}` });
      const remoteRefs = runGitIn({
        dir: remoteDir,
        args: 'for-each-ref "--format=%(refname)"',
      });
      const localBranches = runGitIn({
        dir: cleanDir,
        args: 'branch "--format=%(refname:short)"',
      });

      // uncommitted work outside .behavior/: the rewrite is refused, no backup taken
      const dirtyDir = genHabitatWithCommit({ slug: 'redteam-backup-dirty' });
      writeFileSync(join(dirtyDir, 'work.ts'), 'unpushed work\n');
      const dirty = runGate({ dir: dirtyDir });
      const dirtyBackups = getBackupBranches({ dir: dirtyDir });

      // the drive's own route records under .behavior/ are no reason to refuse
      const routeOnlyDir = genHabitatWithCommit({
        slug: 'redteam-backup-route-only',
      });
      mkdirSync(
        join(routeOnlyDir, '.behavior', 'v2026_01_01.guardian-redteam'),
        {
          recursive: true,
        },
      );
      writeFileSync(
        join(
          routeOnlyDir,
          '.behavior',
          'v2026_01_01.guardian-redteam',
          '0.scope.md',
        ),
        '- scope: .\n',
      );
      const routeOnly = runGate({ dir: routeOnlyDir });

      // another route under .behavior/ is a human's work: dirty, it refuses the rewrite
      const otherRouteDir = genHabitatWithCommit({
        slug: 'redteam-backup-other-route',
      });
      mkdirSync(join(otherRouteDir, '.behavior', 'v2026_01_01.other-feature'), {
        recursive: true,
      });
      writeFileSync(
        join(
          otherRouteDir,
          '.behavior',
          'v2026_01_01.other-feature',
          '0.wish.md',
        ),
        'a human draft\n',
      );
      const otherRoute = runGate({ dir: otherRouteDir });
      const otherRouteBackups = getBackupBranches({ dir: otherRouteDir });

      // a detached HEAD names no branch to back up
      const detachedDir = genHabitatWithCommit({
        slug: 'redteam-backup-detached',
      });
      runGitIn({ dir: detachedDir, args: 'checkout -q --detach' });
      const detached = runGate({ dir: detachedDir });

      // a branch with no commit owes no rewrite
      const unbornDir = genTempDir({ slug: 'redteam-backup-unborn' });
      runGitIn({ dir: unbornDir, args: 'init -q -b main' });
      const unborn = runGate({ dir: unbornDir });

      // the gate reads no flag; one given belays, never drops
      const foreignFlag = runGate({ dir: cleanDir, args: '--route x' });

      // the gate's help page: the skill page, which names the gate and the stone that runs it
      const help = runGate({ dir: cleanDir, args: '--help' });

      // each malfunction arm: a real git on PATH that breaks at the one call the arm reads
      const runGateOnGitBroke = (input: {
        slug: string;
        failOn: string;
        exitCode: number;
        failOnCall?: number;
      }) =>
        runGuardianSkill(
          {
            skill: SKILL,
            args: 'backup-before-rewrite',
            cwd: genHabitatWithCommit({ slug: input.slug }),
          },
          {
            env: {
              PATH: `${genBrokenToolBin({ tool: 'git', exitCode: input.exitCode, failOn: input.failOn, failOnCall: input.failOnCall })}:${PATH_WITHOUT_RHX}`,
            },
          },
        );
      // outside a repo, and a git that breaks on the repo probe itself: the gate's first arm
      const notARepo = runGate({
        dir: genTempDir({ slug: 'redteam-backup-not-a-repo' }),
      });
      const probeBroke = runGateOnGitBroke({
        slug: 'redteam-backup-probe-broke',
        failOn: 'rev-parse --git-dir',
        exitCode: 128,
      });
      const branchBroke = runGateOnGitBroke({
        slug: 'redteam-backup-branch-broke',
        failOn: 'HEAD',
        exitCode: 128,
      });
      const headBroke = runGateOnGitBroke({
        slug: 'redteam-backup-head-broke',
        failOn: 'HEAD^{commit}',
        exitCode: 128,
      });
      const statusBroke = runGateOnGitBroke({
        slug: 'redteam-backup-status-broke',
        failOn: 'status',
        exitCode: 128,
      });
      const backupReadBroke = runGateOnGitBroke({
        slug: 'redteam-backup-read-broke',
        failOn: 'refs/redteam-backup',
        exitCode: 128,
      });
      // the first read finds no ref and the create lands; only the read-back after it breaks
      const backupReadBackBroke = runGateOnGitBroke({
        slug: 'redteam-backup-read-back-broke',
        failOn: '--quiet refs/redteam-backup',
        failOnCall: 2,
        exitCode: 128,
      });
      const backupWriteBroke = runGateOnGitBroke({
        slug: 'redteam-backup-write-broke',
        failOn: 'update-ref',
        exitCode: 1,
      });
      // an update-ref that reports success yet writes no ref: the read-back is checked, never trusted
      const backupUnheld = runGateOnGitBroke({
        slug: 'redteam-backup-unheld',
        failOn: 'update-ref',
        exitCode: 0,
      });

      // a full redact cycle: leak committed, backup taken, the leak commit rewritten away. the
      // stones' re-hunt form must find the value gone, though the backup still carries it
      const redactDir = genHabitatWithCommit({ slug: 'redteam-backup-redact' });
      writeFileSync(join(redactDir, 'leak.txt'), 'token=FAKE_LEAK_9f3a\n');
      runGitIn({ dir: redactDir, args: 'add leak.txt' });
      runGitIn({ dir: redactDir, args: 'commit -q -m leak' });
      const redactGate = runGate({ dir: redactDir });
      runGitIn({ dir: redactDir, args: 'reset -q --hard HEAD~1' });
      const reHuntAll = runGitIn({
        dir: redactDir,
        args: 'log --all -S FAKE_LEAK_9f3a --format=%H',
      });
      const reHuntStones = runGitIn({
        dir: redactDir,
        args: 'log "--exclude=refs/redteam-backup/*" --all -S FAKE_LEAK_9f3a --format=%H',
      });

      return {
        head,
        clean,
        rerun,
        cleanBackups,
        backupHead,
        remoteRefs,
        localBranches,
        dirty,
        dirtyBackups,
        routeOnly,
        otherRoute,
        otherRouteBackups,
        detached,
        unborn,
        foreignFlag,
        help,
        notARepo,
        probeBroke,
        branchBroke,
        headBroke,
        statusBroke,
        backupReadBroke,
        backupReadBackBroke,
        backupWriteBroke,
        backupUnheld,
        redactGate,
        reHuntAll,
        reHuntStones,
      };
    });

    when('[t0] the tree holds no uncommitted work', () => {
      then(
        'the gate takes a backup ref at HEAD, reads it back, and passes (exit 0)',
        () => {
          expect(scene.clean.exitCode).toBe(0);
          expect(scene.cleanBackups).toEqual([
            `refs/redteam-backup/main.${scene.head.slice(0, 12)}`,
          ]);
          expect(scene.backupHead).toEqual(scene.head);
          expect(scene.clean.stdout).toContain(
            'backed up — the rewrite may proceed on main',
          );
          expect(scene.clean.stdout).toContain(
            'restore: git reset --hard refs/redteam-backup/main.',
          );
          expect(maskSha(scene.clean.stdout)).toMatchSnapshot();
        },
      );
      then(
        'the backup is no branch, and a push of every branch and tag never carries it',
        () => {
          expect(scene.localBranches).toEqual('main');
          expect(scene.remoteRefs).toContain('refs/heads/main');
          expect(scene.remoteRefs).not.toContain('redteam-backup');
        },
      );
      then(
        'a re-run at the same HEAD finds its own backup: one branch, exit 0',
        () => {
          expect(scene.rerun.exitCode).toBe(0);
          expect(scene.cleanBackups).toHaveLength(1);
        },
      );
    });

    when('[t1] the tree holds uncommitted work outside .behavior/', () => {
      then(
        'the gate refuses the rewrite (exit 2), names the work, and takes no backup',
        () => {
          expect(scene.dirty.exitCode).toBe(2);
          expect(scene.dirty.stdout).toContain(
            'the tree holds uncommitted work; a rewrite over it can drop it',
          );
          expect(scene.dirty.stdout).toContain(
            'uncommitted outside the redteam route: 1 path, first: work.ts',
          );
          // the human reads the path, never git's porcelain status code
          expect(scene.dirty.stdout).not.toContain('?? work.ts');
          expect(scene.dirty.stdout).toContain('hand the rewrite to the human');
          expect(scene.dirtyBackups).toEqual([]);
          expect(scene.dirty.stdout).toMatchSnapshot();
        },
      );
      then(
        "another route's uncommitted draft under .behavior/ refuses it too: only the redteam route is exempt",
        () => {
          expect(scene.otherRoute.exitCode).toBe(2);
          expect(scene.otherRoute.stdout).toContain(
            'uncommitted outside the redteam route: 1 path, first: .behavior/v2026_01_01.other-feature/0.wish.md',
          );
          expect(scene.otherRouteBackups).toEqual([]);
        },
      );
    });

    when('[t2] only the route records under .behavior/ are uncommitted', () => {
      then(
        "the gate passes (exit 0): the drive's own records never block a rewrite",
        () => {
          expect(scene.routeOnly.exitCode).toBe(0);
          expect(scene.routeOnly.stdout).toContain(
            'backed up — the rewrite may proceed on main',
          );
          expect(maskSha(scene.routeOnly.stdout)).toMatchSnapshot();
        },
      );
    });

    when('[t3] no branch is checked out, or the branch holds no commit', () => {
      then('a detached HEAD belays (exit 2), named', () => {
        expect(scene.detached.exitCode).toBe(2);
        expect(scene.detached.stdout).toContain(
          'no branch is checked out (a detached HEAD)',
        );
        expect(scene.detached.stdout).toContain(
          'fix: check out the branch whose commits the rewrite touches, then re-run',
        );
        expect(scene.detached.stdout).toMatchSnapshot();
      });
      then('an unborn branch belays (exit 2): no commit, no rewrite', () => {
        expect(scene.unborn.exitCode).toBe(2);
        expect(scene.unborn.stdout).toContain('the branch holds no commit');
        expect(scene.unborn.stdout).toContain(
          'fix: skip the rewrite; redact the value in the tree alone',
        );
        expect(scene.unborn.stdout).toMatchSnapshot();
      });
    });

    when('[t6] git breaks at one call the gate reads', () => {
      const GIT_BROKE_CASES = [
        {
          key: 'probeBroke',
          says: 'git malfunctioned while it probed the repo',
        },
        { key: 'branchBroke', says: 'could not read the current branch' },
        { key: 'headBroke', says: 'could not read HEAD' },
        { key: 'statusBroke', says: "could not read the tree's status" },
        {
          key: 'backupReadBroke',
          says: 'could not read the backup ref refs/redteam-backup/main.',
        },
        {
          // a break on the read-back is a tool break, never misread as a ref that holds no commit
          key: 'backupReadBackBroke',
          says: 'could not read back the backup ref refs/redteam-backup/main.',
        },
        {
          key: 'backupWriteBroke',
          says: 'could not create the backup ref refs/redteam-backup/main.',
        },
        {
          key: 'backupUnheld',
          says: 'the backup ref does not read back at HEAD, so no rewrite',
        },
      ] as const;
      GIT_BROKE_CASES.map((thisCase) =>
        then(
          `${thisCase.key}: halts (exit 1), named, no rewrite allowed, snapped`,
          () => {
            const run = scene[thisCase.key];
            expect(run.exitCode).toBe(1);
            expect(run.stdout).toContain(thisCase.says);
            // the cause opens on its qualified class, as every halt's cause does
            expect(run.stdout).toContain('cause: 💥 MalfunctionError: ');
            expect(run.stdout).toContain('halted: 💥 MalfunctionError');
            expect(run.stdout).not.toContain('the rewrite may proceed');
            expect(maskSha(run.stdout)).toMatchSnapshot();
          },
        ),
      );
    });

    when('[t7] the gate is asked for --help', () => {
      then('it renders the skill page, which names the gate (exit 0)', () => {
        expect(scene.help.exitCode).toBe(0);
        expect(scene.help.stdout).toContain(
          'rhx security.habitat.redteam backup-before-rewrite',
        );
        expect(scene.help.stdout).toMatchSnapshot();
      });
    });

    when('[t8] the gate runs outside a git repo', () => {
      then(
        'it belays (exit 2), names the repo it needs, and takes no backup',
        () => {
          expect(scene.notARepo.exitCode).toBe(2);
          expect(scene.notARepo.stdout).toContain(
            '🧿 security.habitat.redteam backup-before-rewrite',
          );
          expect(scene.notARepo.stdout).toContain(
            'fix: run this from within a repo',
          );
          expect(scene.notARepo.stdout).toContain(
            'blocked: ✋ ConstraintError: not in a git repository',
          );
          expect(scene.notARepo.stdout).toMatchSnapshot();
        },
      );
    });

    when(
      '[t5] a redact rewrites the leak away after the gate took its backup',
      () => {
        then(
          'the backup still carries the value: a bare `--all` re-hunt finds it',
          () => {
            expect(scene.redactGate.exitCode).toBe(0);
            expect(scene.reHuntAll).not.toEqual('');
          },
        );
        then(
          "the stones' re-hunt form excludes the backup and finds the value gone, so the claim can CLOSE",
          () => {
            expect(scene.reHuntStones).toEqual('');
          },
        );
      },
    );

    when('[t4] a flag is given', () => {
      then('it belays (exit 2), never drops', () => {
        expect(scene.foreignFlag.exitCode).toBe(2);
        expect(scene.foreignFlag.stdout).toContain(
          'flag not read by this command: --route',
        );
        expect(scene.foreignFlag.stdout).toMatchSnapshot();
      });
    });
  });

  given('[case40] a parse slip names the command the caller typed', () => {
    // a slip the parse loop catches renders under the subcommand's own header and help page,
    // as every later belay of that command does; each flag's absent value has its own render
    const PARSE_CASES = [
      {
        key: 'initUnknown',
        args: 'init --scope . --grain all --bogus',
        header: '🧿 security.habitat.redteam init',
        hint: 'hint: rhx security.habitat.redteam init --help',
        says: 'unknown argument: --bogus',
      },
      {
        key: 'initJoined',
        args: 'init --scope=. --grain all',
        header: '🧿 security.habitat.redteam init',
        hint: 'hint: rhx security.habitat.redteam init --help',
        says: "flag and value joined by '=': --scope=.",
      },
      {
        key: 'initAbsentScope',
        args: 'init --scope --grain all',
        header: '🧿 security.habitat.redteam init',
        hint: 'hint: rhx security.habitat.redteam init --help',
        says: 'absent value for --scope',
      },
      {
        key: 'dispatchAbsentTitle',
        args: 'dispatch-lesson --title --route x',
        header: '🧿 security.habitat.redteam dispatch-lesson',
        hint: 'hint: rhx security.habitat.redteam help',
        says: 'absent value for --title',
      },
      {
        key: 'rewindAbsentRoute',
        args: 'rewind-detect --route --cycle 1',
        header: '🧿 security.habitat.redteam rewind-detect',
        hint: 'hint: rhx security.habitat.redteam help',
        says: 'absent value for --route',
      },
      {
        key: 'rewindAbsentCycle',
        args: 'rewind-detect --route x --cycle --title y',
        header: '🧿 security.habitat.redteam rewind-detect',
        hint: 'hint: rhx security.habitat.redteam help',
        says: 'absent value for --cycle',
      },
      {
        key: 'sweepAbsentPeers',
        args: '--scope . --grain all --peers --mode plan',
        header: '🧿 security.habitat.redteam',
        hint: 'hint: rhx security.habitat.redteam help',
        says: 'absent value for --peers',
      },
      {
        key: 'sweepAbsentBudget',
        args: '--scope . --grain all --budget --mode plan',
        header: '🧿 security.habitat.redteam',
        hint: 'hint: rhx security.habitat.redteam help',
        says: 'absent value for --budget',
      },
      {
        key: 'sweepAbsentMode',
        args: '--scope . --grain all --mode --peers 3',
        header: '🧿 security.habitat.redteam',
        hint: 'hint: rhx security.habitat.redteam help',
        says: 'absent value for --mode',
      },
      {
        key: 'titleValueInit',
        args: '--title init --scope . --grain all --mode plan',
        header: '🧿 security.habitat.redteam',
        hint: 'hint: rhx security.habitat.redteam help',
        says: 'flag not read by this command: --title',
      },
    ] as const;

    const scene = useBeforeAll(async () => {
      const dir = setupHabitat({ slug: 'redteam-parse-slips' });
      const run = (args: string) =>
        runGuardianSkill(
          { skill: SKILL, args, cwd: dir },
          { env: { PATH: PATH_WITHOUT_RHX } },
        );
      return {
        slips: PARSE_CASES.map((thisCase) => ({
          thisCase,
          run: run(thisCase.args),
        })),
        separatorAtEnd: run('--scope . --grain all --mode plan --'),
        separatorAtStart: run('-- --scope . --grain all --mode plan'),
        plain: run('--scope . --grain all --mode plan'),
        // init.sh parses its own argv when called direct; its separator arm must match the sweep's
        initSeparator: runGuardianSkill(
          {
            skill: INIT,
            args: '--scope . --grain all --skip-route-bind --',
            cwd: setupHabitat({ slug: 'redteam-init-separator' }),
          },
          { env: { PATH: genGuardianStubBinPath() } },
        ),
        initPlain: runGuardianSkill(
          {
            skill: INIT,
            args: '--scope . --grain all --skip-route-bind',
            cwd: setupHabitat({ slug: 'redteam-init-plain' }),
          },
          { env: { PATH: genGuardianStubBinPath() } },
        ),
        dispatchHelp: run('dispatch-lesson --help'),
        rewindHelp: run('rewind-detect --help'),
        // every documented help spelling, per gate: `help`, `--help`, `-h`, after the subcommand
        gateHelpSpellings: GATE_SUBCOMMANDS.flatMap((gate) =>
          ['help', '--help', '-h'].map((spell) => ({
            gate,
            spell,
            run: run(`${gate} ${spell}`),
          })),
        ),
        help: run('help'),
      };
    });

    when('[t0] each slip is parsed', () => {
      PARSE_CASES.map((thisCase, index) =>
        then(
          `${thisCase.key}: exit 2, under its own header + hint, snapped`,
          () => {
            const { run } = scene.slips[index]!;
            expect(run.exitCode).toBe(2);
            expect(run.stdout).toContain(`${thisCase.header}\n`);
            expect(run.stdout).toContain(thisCase.hint);
            expect(run.stdout).toContain(thisCase.says);
            expect(run.stdout).toMatchSnapshot();
          },
        ),
      );
    });

    when('[t1] a bare -- separator stands in the argv', () => {
      then(
        'it is dropped, never a slip: the plan renders as without it',
        () => {
          expect(scene.separatorAtEnd.exitCode).toBe(0);
          expect(scene.separatorAtStart.exitCode).toBe(0);
          expect(scene.separatorAtEnd.stdout).toEqual(scene.plain.stdout);
          expect(scene.separatorAtStart.stdout).toEqual(scene.plain.stdout);
        },
      );
      then(
        'init drops it too: it scaffolds (exit 0) with the same render as without it',
        () => {
          expect(scene.initSeparator.exitCode).toBe(0);
          expect(scene.initPlain.exitCode).toBe(0);
          expect(scene.initSeparator.stdout).not.toContain('unknown argument');
          expect(maskRouteDate(scene.initSeparator.stdout)).toEqual(
            maskRouteDate(scene.initPlain.stdout),
          );
        },
      );
    });

    when('[t2] a gate subcommand asks for help', () => {
      then('each renders the skill page (exit 0), as bare help does', () => {
        expect(scene.dispatchHelp.exitCode).toBe(0);
        expect(scene.rewindHelp.exitCode).toBe(0);
        expect(scene.dispatchHelp.stdout).toEqual(scene.help.stdout);
        expect(scene.rewindHelp.stdout).toEqual(scene.help.stdout);
      });
      then(
        'every help spelling of every gate renders that same page (exit 0)',
        () => {
          expect(scene.gateHelpSpellings).toHaveLength(9);
          scene.gateHelpSpellings.map(({ gate, spell, run }) => {
            expect({ gate, spell, exitCode: run.exitCode }).toEqual({
              gate,
              spell,
              exitCode: 0,
            });
            expect(run.stdout).toEqual(scene.help.stdout);
          });
        },
      );
    });

    when('[t3] a plan runs', () => {
      then(
        'it discloses the one act that leaves the habitat: the upstream lesson push',
        () => {
          expect(scene.plain.stdout).toContain(
            'publishes: 5.promote opens a public gh issue on ehmpathy/rhachet-roles-ghlitch per fullsun-safe lesson',
          );
        },
      );
      then(
        'it discloses the one destructive act inside the habitat: the history rewrite, backed up first',
        () => {
          expect(scene.plain.stdout).toContain(
            'rewrites: 4.repair edits the tree and rewrites each local unpushed commit that carries a leaked value',
          );
          expect(scene.plain.stdout).toContain(
            'each rewrite passes rhx security.habitat.redteam backup-before-rewrite first, which takes a backup ref (refs/redteam-backup/<branch>.<head-sha>, never pushed by --all) and refuses the rewrite when the tree holds uncommitted work',
          );
        },
      );
      then(
        'it discloses that a grounded route refuses a new --peers, so its own next step cannot surprise',
        () => {
          expect(scene.plain.stdout).toContain(
            'a new --peers is refused once 1.ground cuts the slices',
          );
        },
      );
    });
  });

  given('[case39] a gate run with a terminal on stdin (no pipe)', () => {
    // an operator who forgot the pipe meets a belay, never a gate that hangs on the terminal
    const scene = useBeforeAll(async () => {
      const habitat = setupHabitat({ slug: 'redteam-terminal-stdin' });
      const route = join(
        habitat,
        '.behavior',
        `v2026_01_01.${ROUTE_KIND}.loop`,
      );
      mkdirSync(join(route, '.claims'), { recursive: true });
      writeFileSync(join(route, '2.detect.stone'), 'detect\n');
      return {
        dispatch: runGuardianSkillOnTerminal({
          skill: SKILL,
          args: "dispatch-lesson --title 'egress: allowlist'",
          cwd: habitat,
        }),
        rewind: runGuardianSkillOnTerminal({
          skill: SKILL,
          args: `rewind-detect --route .behavior/v2026_01_01.${ROUTE_KIND}.loop --cycle 1`,
          cwd: habitat,
        }),
        claimsAfter: readdirSync(join(route, '.claims')),
      };
    });

    when('[t0] each gate runs on a terminal', () => {
      then('dispatch-lesson belays (exit 2), names the pipe, snapped', () => {
        expect(scene.dispatch.exitCode).toBe(2);
        expect(scene.dispatch.output).toContain(
          'no lesson body on stdin (stdin is a terminal)',
        );
        expect(scene.dispatch.output).toContain('fix: pipe the drafted lesson');
        expect(scene.dispatch.output).toMatchSnapshot();
      });

      then('rewind-detect belays (exit 2), names the pipe, snapped', () => {
        expect(scene.rewind.exitCode).toBe(2);
        expect(scene.rewind.output).toContain(
          'no carried keys on stdin (stdin is a terminal)',
        );
        expect(scene.rewind.output).toContain(
          'fix: pass the PENDING-REDETECT keys on stdin in a quoted heredoc',
        );
        expect(scene.rewind.output).toMatchSnapshot();
      });

      then('the route is unwritten', () => {
        expect(scene.claimsAfter).toEqual([]);
      });
    });
  });

  given('[case38] a two-cycle budget, and a retried cycle', () => {
    // the plan names what a budget of 2 re-detects, and the out-of-order fix names a retry
    const scene = useBeforeAll(async () => {
      const habitat = setupHabitat({ slug: 'redteam-budget-two' });
      return {
        plan: runGuardianSkill(
          {
            skill: SKILL,
            args: '--scope . --grain leak --budget 2 --mode plan',
            cwd: habitat,
          },
          { env: { PATH: PATH_WITHOUT_RHX } },
        ),
        fixAfterOne: runSourcedBash({
          expression: 'as_cycle_order_fix 1',
          stdin: '',
          env: {},
        }),
        fixAfterTwo: runSourcedBash({
          expression: 'as_cycle_order_fix 2',
          stdin: '',
          env: {},
        }),
        fixAfterNone: runSourcedBash({
          expression: 'as_cycle_order_fix 0',
          stdin: '',
          env: {},
        }),
      };
    });

    when('[t0] the plan prices a budget of 2', () => {
      then("it says cycle 2 re-detects cycle 1's repairs", () => {
        expect(scene.plan.exitCode).toBe(0);
        expect(scene.plan.stdout).toContain(
          "cycle 2 re-detects cycle 1's repairs; cycle 2's repairs stay PENDING-REDETECT",
        );
        expect(scene.plan.stdout).toMatchSnapshot();
      });
    });

    when('[t1] the out-of-order fix is read per record size', () => {
      then('an empty record allows only cycle 1', () => {
        expect(scene.fixAfterNone.stdout).toEqual('pass --cycle 1');
      });
      then('a record of N allows N (a retry) or N + 1', () => {
        expect(scene.fixAfterOne.stdout).toEqual(
          'pass --cycle 1 (a retry) or --cycle 2',
        );
        expect(scene.fixAfterTwo.stdout).toEqual(
          'pass --cycle 2 (a retry) or --cycle 3',
        );
      });
    });
  });

  given('[case33] a leaf operation meets a broken tool or a bad input', () => {
    // each leaf turns a break into a named failure, never a benign verdict ("no route", "no
    // field", "valid", a removal outside .behavior/); each is driven for real
    const GREP_BROKE = (failOn: string) =>
      `${genBrokenToolBin({ tool: 'grep', exitCode: 2, failOn })}:${PATH_WITHOUT_RHX}`;
    const COUNT_CASES = [
      { value: '1', valid: true },
      { value: '9999', valid: true },
      { value: '10000', valid: false },
      { value: '0', valid: false },
      { value: '07', valid: false },
      { value: 'n/a', valid: false },
    ];

    const scene = useBeforeAll(async () => {
      // a scope record that holds scope + grain only: a checked-in fixture, cloned
      const route = join(
        genTempDir({
          slug: 'redteam-leaf-scope',
          clone: join(
            __dirname,
            '.test',
            'assets',
            'habitat.with-scope-record-partial',
          ),
        }),
        '.behavior',
        'v2026_01_01.redteam-leaf',
      );
      const lockedDir = setupHabitat({ slug: 'redteam-leaf-locked' });
      mkdirSync(join(lockedDir, 'locked'));
      chmodSync(join(lockedDir, 'locked'), 0o600);

      // the clamp needs a dir this runner cannot enter; root (or a mode-blind fs) enters any
      // dir, so a green or red there would test the host, not the halt — fail loud instead
      const isLockedEnterable = ((): boolean => {
        try {
          accessSync(join(lockedDir, 'locked'), fsConstants.X_OK);
          return true;
        } catch (error) {
          // only a denied access proves the lock; any other error surfaces. node's fs errors
          // cross jest's realm, so the check reads the code, never `instanceof Error`
          if (
            typeof error === 'object' &&
            error !== null &&
            'code' in error &&
            error.code === 'EACCES'
          )
            return false;
          throw error;
        }
      })();
      if (isLockedEnterable)
        throw new ConstraintError(
          'the [t4] clamp needs a dir this runner cannot enter, but mode 0600 did not lock it',
          {
            hint: 'run the suite as a non-root user, on a fs that enforces unix mode bits',
          },
        );
      const lockedRuns = {
        plan: runGuardianSkill(
          {
            skill: SKILL,
            args: '--scope locked --grain leak --mode plan',
            cwd: lockedDir,
          },
          { env: { PATH: PATH_WITHOUT_RHX } },
        ),
        init: runGuardianSkill(
          {
            skill: INIT,
            args: '--scope locked --grain leak --skip-route-bind',
            cwd: lockedDir,
          },
          { env: { PATH: PATH_WITHOUT_RHX } },
        ),
      };
      chmodSync(join(lockedDir, 'locked'), 0o755);
      return {
        // the temp dir, so a snapped render masks it to `<dir>`
        lockedDir,
        extractRedteamBroke: runSourcedBash({
          expression: 'extract_redteam_route_path',
          stdin: `.behavior/v2026_01_01.${ROUTE_KIND}.grain=leak\n`,
          env: { PATH: GREP_BROKE('') },
        }),
        extractAnyBroke: runSourcedBash({
          expression: 'extract_any_route_path',
          stdin: '.behavior/v2026_01_01.some-feature\n',
          env: { PATH: GREP_BROKE('') },
        }),
        // the composed probe: rhx answers, then grep breaks on the read of its answer
        probeExtractBroke: runSourcedBash({
          expression: 'get_bound_route',
          stdin: '',
          env: {
            PATH: `${genBrokenToolBin({ tool: 'grep', exitCode: 2 })}:${genGuardianStubBinPath()}`,
            STUB_BOUND_ROUTE: `.behavior/v2026_01_01.${ROUTE_KIND}.grain=leak`,
          },
        }),
        // a stdin read that breaks: never "no lesson" nor "no keys"
        lessonStdinBroke: runSourcedBash({
          expression: 'dispatch_fullsun_lesson "a lesson title"',
          stdin: 'a generalized lesson body\n',
          env: {
            PATH: `${genBrokenToolBin({ tool: 'cat', exitCode: 1 })}:${PATH_WITHOUT_RHX}`,
          },
        }),
        keysStdinBroke: runSourcedBash({
          expression: 'set_detect_rewound_with_cycle_carry "$ROUTE" 1',
          stdin: 'channel+mechanism\n',
          env: {
            PATH: `${genBrokenToolBin({ tool: 'cat', exitCode: 1 })}:${PATH_WITHOUT_RHX}`,
            ROUTE: route,
          },
        }),
        // the carry lands, then its read-back breaks: never "every key held"
        carryReadBackBroke: (() => {
          const carryRoute = join(lockedDir, 'carry-route');
          mkdirSync(join(carryRoute, '.claims'), { recursive: true });
          return runSourcedBash({
            expression:
              'set_cycle_carry_confirmed "$ROUTE" 1 3 "channel+mechanism" after',
            stdin: '',
            env: {
              PATH: `${genBrokenToolBin({ tool: 'grep', exitCode: 2, failOn: 'carried PENDING-REDETECT' })}:${PATH_WITHOUT_RHX}`,
              ROUTE: carryRoute,
            },
          });
        })(),
        fieldAbsent: runSourcedBash({
          expression: 'get_route_scope_field "$ROUTE" budget',
          stdin: '',
          env: { PATH: PATH_WITHOUT_RHX, ROUTE: route },
        }),
        fieldReadBroke: runSourcedBash({
          expression: 'get_route_scope_field "$ROUTE" grain',
          stdin: '',
          env: { PATH: GREP_BROKE('- grain: '), ROUTE: route },
        }),
        counts: COUNT_CASES.map((thisCase) => ({
          thisCase,
          run: runSourcedBash({
            expression: 'is_positive_integer "$VALUE"',
            stdin: '',
            env: { PATH: PATH_WITHOUT_RHX, VALUE: thisCase.value },
          }),
        })),
        delOutside: runSourcedBash({
          expression: 'del_route_dir "$TARGET"',
          stdin: '',
          env: { PATH: PATH_WITHOUT_RHX, TARGET: lockedDir },
        }),
        blockReadBroke: runSourcedBash({
          expression: 'has_cycle_block "$RECORD" 1',
          stdin: '',
          env: {
            PATH: GREP_BROKE('## cycle 1'),
            RECORD: genCycleRecordFile({
              dir: lockedDir,
              name: 'block.md',
              body: '## cycle 1\n',
            }),
          },
        }),
        countReadBroke: runSourcedBash({
          expression: 'get_cycle_count "$RECORD"',
          stdin: '',
          env: {
            PATH: GREP_BROKE('^## cycle '),
            RECORD: genCycleRecordFile({
              dir: lockedDir,
              name: 'count.md',
              body: '## cycle 1\n',
            }),
          },
        }),
        lineReadBroke: runSourcedBash({
          expression: 'has_cycle_line "$RECORD" 1 "- rewound: yes"',
          stdin: '',
          env: {
            PATH: GREP_BROKE('- rewound: yes'),
            RECORD: genCycleRecordFile({
              dir: lockedDir,
              name: 'line.md',
              body: '## cycle 1\n- rewound: yes\n',
            }),
          },
        }),
        // the one reader that cuts a block forks awk; a break there must never read as an empty block
        blockCutBroke: (() => {
          const run = runSourcedBash({
            expression: 'get_cycle_block "$RECORD" 1',
            stdin: '',
            env: {
              PATH: `${genBrokenToolBin({ tool: 'awk', exitCode: 2 })}:${PATH_WITHOUT_RHX}`,
              RECORD: genCycleRecordFile({
                dir: lockedDir,
                name: 'cut.md',
                body: '## cycle 1\n- spent: 1 / 3\n',
              }),
            },
          });
          return { ...run, stderr: run.stderr.split(lockedDir).join('<dir>') };
        })(),
        // a grep that exits 0 yet prints no number: the count is unread, never zero
        countNotRead: (() => {
          const run = runSourcedBash({
            expression: 'get_cycle_count "$RECORD"',
            stdin: '',
            env: {
              PATH: `${genBrokenToolBin({ tool: 'grep', exitCode: 0, failOn: '^## cycle ' })}:${PATH_WITHOUT_RHX}`,
              RECORD: genCycleRecordFile({
                dir: lockedDir,
                name: 'unread.md',
                body: '## cycle 1\n',
              }),
            },
          });
          return { ...run, stderr: run.stderr.split(lockedDir).join('<dir>') };
        })(),
        // a grain or stone added to its single source with no prompt / purpose renders loud
        grainPromptAbsent: runSourcedBash({
          expression: 'as_grain_prompt supply',
          stdin: '',
          env: { PATH: PATH_WITHOUT_RHX },
        }),
        stonePurposeAbsent: runSourcedBash({
          expression: 'as_stone_purpose 6.retire',
          stdin: '',
          env: { PATH: PATH_WITHOUT_RHX },
        }),
        // cycle 2's block stands and cycle 1's does not: a carry for cycle 1 would land out of order
        carryNotLast: (() => {
          const record = genCycleRecordFile({
            dir: lockedDir,
            name: 'carry.md',
            body: '## cycle 2\n- spent: 2 / 3\n',
          });
          const run = runSourcedBash({
            expression:
              'set_cycle_carry_block "$RECORD" 1 3 "infil::open-port"',
            stdin: '',
            env: { PATH: PATH_WITHOUT_RHX, RECORD: record },
          });
          return {
            ...run,
            stdout: run.stdout.split(lockedDir).join('<dir>'),
            recordAfter: readFileSync(record, 'utf-8'),
          };
        })(),
        // pid 1 runs as root, so a non-root shell cannot signal it: alive, yet kill -0 fails
        holderUnsignalable: (() => {
          // the clamp needs a live pid this runner cannot signal; a root runner signals pid 1, so
          // a green or red there would test the uid, not the label — fail loud instead
          const probe = spawnSync(
            'bash',
            ['--noprofile', '--norc', '-c', 'kill -0 1'],
            { env: { ...asEnvHermetic(), PATH: PATH_WITHOUT_RHX } },
          );
          // a probe that never ran proves naught about the uid: name the spawn break as such
          if (probe.error || probe.status === null)
            throw new MalfunctionError(
              'the holderUnsignalable precondition probe (kill -0 1) did not run',
              {
                error: probe.error?.message ?? null,
                signal: probe.signal,
                hint: 'check that bash is on PATH and runnable',
              },
            );
          const isPidOneSignalable = probe.status === 0;
          if (isPidOneSignalable)
            throw new ConstraintError(
              'the holderUnsignalable clamp needs a live pid this runner cannot signal, but kill -0 1 took',
              { hint: 'run the suite as a non-root user' },
            );
          const lock = join(lockedDir, 'held.lock');
          mkdirSync(lock, { recursive: true });
          writeFileSync(join(lock, 'holder'), '1');
          const run = runSourcedBash({
            expression:
              'label="$(get_lock_holder_label "$LOCK")"; rc=$?; printf "rc=%s\\n%s\\n%s" "$rc" "$label" "$(as_lock_left_fix "could not take the lock $LOCK within ~5s; $label")"',
            stdin: '',
            env: { PATH: PATH_WITHOUT_RHX, LOCK: lock },
          });
          return { ...run, stdout: run.stdout.split(lockedDir).join('<dir>') };
        })(),
        // cycle 2 follows cycle 1, so an append for cycle 1 would land in cycle 2's block
        markerNotLast: (() => {
          const record = genCycleRecordFile({
            dir: lockedDir,
            name: 'last.md',
            body: '## cycle 1\n- spent: 1 / 3\n\n## cycle 2\n- spent: 2 / 3\n',
          });
          const run = runSourcedBash({
            expression: 'set_cycle_rewound_line "$RECORD" 1',
            stdin: '',
            env: { PATH: PATH_WITHOUT_RHX, RECORD: record },
          });
          return { ...run, recordAfter: readFileSync(record, 'utf-8') };
        })(),
        // an rm that reports success yet leaves the dir: the removal is checked, never trusted
        delStands: (() => {
          mkdirSync(join(lockedDir, '.behavior', 'v2026_01_01.stands'), {
            recursive: true,
          });
          return runSourcedBash({
            expression:
              'cd "$TARGET" && del_route_dir .behavior/v2026_01_01.stands',
            stdin: '',
            env: {
              PATH: `${genBrokenToolBin({ tool: 'rm', exitCode: 0 })}:${PATH_WITHOUT_RHX}`,
              TARGET: lockedDir,
            },
          });
        })(),
        // a route that lost one guard renders that stone alone, its neighbours with their guards
        stonesGuardAbsent: runSourcedBash({
          expression: 'print_route_stones "$ROUTE" ""',
          stdin: '',
          env: {
            PATH: PATH_WITHOUT_RHX,
            ROUTE: genRouteWithFileAbsent({
              from: join(__dirname, 'security.habitat.redteam', 'templates'),
              at: join(lockedDir, 'stones-partial'),
              absent: '3.verify.guard',
            }),
          },
        }),
        // a rival removed the dir right after mkdir refused: still contention, never a broken create
        extantRefusalGone: runSourcedBash({
          expression: 'is_dir_extant_refusal "$SAID" "$TARGET/gone.lock"',
          stdin: '',
          env: {
            PATH: PATH_WITHOUT_RHX,
            TARGET: lockedDir,
            SAID: 'mkdir: cannot create directory: File exists',
          },
        }),
        lockCreateBroke: runSourcedBash({
          expression:
            'gen_cycle_record_lock "$TARGET/absent-dir/0.cycle.md.lock"',
          stdin: '',
          env: { PATH: PATH_WITHOUT_RHX, TARGET: lockedDir },
        }),
        // a held lock forces the backoff; a clock that breaks there is named, never a time-out
        lockSleepBroke: (() => {
          const lock = join(lockedDir, 'sleep.lock');
          mkdirSync(lock, { recursive: true });
          writeFileSync(join(lock, 'holder'), '1');
          return runSourcedBash({
            expression: 'gen_cycle_record_lock "$LOCK"',
            stdin: '',
            env: {
              PATH: `${genBrokenToolBin({ tool: 'sleep', exitCode: 1 })}:${PATH_WITHOUT_RHX}`,
              LOCK: lock,
            },
          });
        })(),
        stonelessRoute: (() => {
          mkdirSync(join(lockedDir, '.stoneless'), { recursive: true });
          return runSourcedBash({
            expression: 'is_route_on_disk "$TARGET/.stoneless"',
            stdin: '',
            env: { PATH: PATH_WITHOUT_RHX, TARGET: lockedDir },
          });
        })(),
        // two spellings of one surface — a symlink and its target — canonicalize to one scope
        symlinkScope: (() => {
          mkdirSync(join(lockedDir, 'sym', 'real', 'foo'), { recursive: true });
          symlinkSync('real', join(lockedDir, 'sym', 'link'));
          writeFileSync(join(lockedDir, 'sym', 'real', 'a.ts'), '');
          symlinkSync('a.ts', join(lockedDir, 'sym', 'real', 'alias.ts'));
          return runSourcedBash({
            expression:
              'cd "$TARGET" && get_scope_from_repo_root sym/link/foo "$TARGET" && printf "\\n" && get_scope_from_repo_root sym/real/foo "$TARGET" && printf "\\n" && get_scope_from_repo_root sym/link/alias.ts "$TARGET" && printf "\\n" && get_scope_from_repo_root sym/real/a.ts "$TARGET"',
            stdin: '',
            env: { PATH: PATH_WITHOUT_RHX, TARGET: lockedDir },
          });
        })(),
        // a write that breaks, then a draft removal that breaks too: the leftover draft is named
        draftCleanupBroken: (() => {
          mkdirSync(join(lockedDir, 'drafts'), { recursive: true });
          const result = runSourcedBash({
            expression:
              'printf body | set_file_atomically "$TARGET/drafts/0.scope.md"',
            stdin: '',
            env: {
              PATH: `${genBrokenToolBin({ tool: 'mv', exitCode: 1, failOn: '.draft.' })}:${genBrokenToolBin({ tool: 'rm', exitCode: 1, failOn: '.draft.' })}:${PATH_WITHOUT_RHX}`,
              TARGET: lockedDir,
            },
          });
          return {
            ...result,
            masked: result.stdout
              .split(lockedDir)
              .join('<habitat>')
              .replace(/\.draft\.\d+/g, '.draft.<pid>'),
            drafts: readdirSync(join(lockedDir, 'drafts')).filter((name) =>
              name.includes('.draft.'),
            ),
          };
        })(),
        // a reopen probe whose read breaks halts on the cause, never reads as 'not reopened'
        ...(() => {
          const route = join(lockedDir, 'reopen-route');
          mkdirSync(join(route, '.claims'), { recursive: true });
          writeFileSync(
            join(route, '.claims', '0.cycle.md'),
            '## cycle 1\n- spent: 1 / 1\n- rewound: yes\n',
          );
          const probe = (failOn: string) =>
            runSourcedBash({
              expression:
                'rc=0; get_route_reopen_verdict "$ROUTE" || rc=$?; printf "\\nrc=%s want=%s" "$rc" "$PROMOTE_READ_BROKE"',
              stdin: '',
              env: { PATH: GREP_BROKE(failOn), ROUTE: route },
            });
          return {
            reopenCountBroke: probe('^## cycle '),
            reopenMarkerBroke: probe('rewound'),
          };
        })(),
        // the marker's later-block probe breaks: the marker is refused, the record untouched
        markerProbeBroke: (() => {
          const record = join(lockedDir, 'marker-probe.cycle.md');
          const body = '## cycle 1\n- spent: 1 / 2\n';
          writeFileSync(record, body);
          const result = runSourcedBash({
            expression: 'set_cycle_rewound_line "$RECORD" 1',
            stdin: '',
            env: { PATH: GREP_BROKE('## cycle 2'), RECORD: record },
          });
          return { ...result, bodyKept: readFileSync(record, 'utf8') === body };
        })(),
        // the literal flag lists, read as written: init's list must stay the sweep's less --mode
        flagLists: runSourcedBash({
          expression:
            'printf "%s\\n%s" "$FLAGS_READ_BY_SWEEP" "$FLAGS_READ_BY_INIT"',
          stdin: '',
          env: { PATH: PATH_WITHOUT_RHX },
        }),
        outsideScope: runSourcedBash({
          expression: 'as_repo_relative_scope /elsewhere/src /repo',
          stdin: '',
          env: { PATH: PATH_WITHOUT_RHX },
        }),
        delParent: runSourcedBash({
          expression: 'cd "$TARGET" && del_route_dir .behavior/..',
          stdin: '',
          env: { PATH: PATH_WITHOUT_RHX, TARGET: lockedDir },
        }),
        delNested: runSourcedBash({
          expression: 'cd "$TARGET" && del_route_dir .behavior/../locked',
          stdin: '',
          env: { PATH: PATH_WITHOUT_RHX, TARGET: lockedDir },
        }),
        lockedDirLeft: existsSync(join(lockedDir, 'locked')),
        lockedPlan: {
          ...lockedRuns.plan,
          masked: lockedRuns.plan.stdout.split(lockedDir).join('<habitat>'),
        },
        lockedInit: {
          ...lockedRuns.init,
          masked: lockedRuns.init.stdout.split(lockedDir).join('<habitat>'),
        },
        branchReadBroke: runGuardianSkill(
          {
            skill: INIT,
            args: '--scope . --grain leak',
            cwd: setupHabitat({ slug: 'redteam-leaf-branch' }),
          },
          {
            env: {
              // both branch reads name HEAD (symbolic-ref, then rev-parse); no other git call does
              PATH: `${genBrokenToolBin({ tool: 'git', exitCode: 1, failOn: 'HEAD' })}:${genGuardianStubBinPath()}`,
            },
          },
        ),
        // a repo before its first commit: HEAD is unborn, yet the branch has a name
        unbornBranch: runSourcedBash({
          expression:
            'git init -q -b main "$TARGET/unborn" && cd "$TARGET/unborn" && get_current_branch',
          stdin: '',
          env: { PATH: PATH_WITHOUT_RHX, TARGET: lockedDir },
        }),
      };
    });

    when('[t0] a grain or stone has no recorded prompt or purpose', () => {
      then('each renders a loud placeholder, never a dropped line', () => {
        expect(scene.grainPromptAbsent.stdout).toEqual(
          '(no prompt recorded for grain supply)',
        );
        expect(scene.stonePurposeAbsent.stdout).toEqual(
          '(no purpose recorded)',
        );
      });
    });

    when('[t1] grep breaks under a route extractor', () => {
      then(
        'each extractor fails (rc 1) with a named cause, never "no route"',
        () => {
          expect(scene.extractRedteamBroke.status).toBe(1);
          expect(scene.extractRedteamBroke.stderr).toContain(
            '💥 MalfunctionError: extract_redteam_route_path: grep broke (rc=2)',
          );
          expect(scene.extractAnyBroke.status).toBe(1);
          expect(scene.extractAnyBroke.stderr).toContain(
            '💥 MalfunctionError: extract_any_route_path: grep broke (rc=2)',
          );
          expect({
            extractRedteamBroke: scene.extractRedteamBroke.stderr,
            extractAnyBroke: scene.extractAnyBroke.stderr,
          }).toMatchSnapshot();
        },
      );

      then(
        'the composed bound-route probe names the extractor break (rc 1), never "none bound"',
        () => {
          expect(scene.probeExtractBroke.status).toBe(1);
          expect(scene.probeExtractBroke.stdout).toContain(
            '💥 MalfunctionError: ',
          );
          expect(scene.probeExtractBroke.stdout).toContain(
            'extract_redteam_route_path: grep broke (rc=2)',
          );
          expect(scene.probeExtractBroke.stdout).not.toContain('.behavior/');
          expect(scene.probeExtractBroke.stdout).toMatchSnapshot();
        },
      );
    });

    when('[t2] a stdin read or a carry read-back breaks', () => {
      then(
        'the lesson gate halts (rc 1), never "the lesson body is empty"',
        () => {
          expect(scene.lessonStdinBroke.status).toBe(1);
          expect(scene.lessonStdinBroke.stdout).toContain(
            'the lesson body could not be read from stdin; naught was sent',
          );
          expect(scene.lessonStdinBroke.stdout).not.toContain('is empty');
          expect(scene.lessonStdinBroke.stdout).toMatchSnapshot();
        },
      );
      then('the rewind halts (rc 1), never a carry of zero keys', () => {
        expect(scene.keysStdinBroke.status).toBe(1);
        expect(scene.keysStdinBroke.stdout).toContain(
          'not rewound: the carried keys could not be read from stdin',
        );
        expect(scene.keysStdinBroke.stdout).toMatchSnapshot();
      });
      then('the carry read-back halts (rc 1), never "every key held"', () => {
        expect(scene.carryReadBackBroke.status).toBe(1);
        expect(scene.carryReadBackBroke.stdout).toContain(
          'could not read the cycle record',
        );
        // the leaf's cause rides the verdict itself, never a stderr line the caller drops
        expect(scene.carryReadBackBroke.stdout).toContain(
          'has_cycle_line: grep broke (rc=2)',
        );
        expect(
          scene.carryReadBackBroke.stdout.split(scene.lockedDir).join('<dir>'),
        ).toMatchSnapshot();
      });
    });

    when('[t3] a cycle-record read or a lock create breaks', () => {
      then(
        'each surfaces its break (rc 1), never "absent" or a time-out',
        () => {
          expect(scene.blockReadBroke.status).toBe(1);
          expect(scene.blockReadBroke.stderr).toContain(
            '💥 MalfunctionError: has_cycle_block: grep broke (rc=2)',
          );
          expect(scene.countReadBroke.status).toBe(1);
          expect(scene.countReadBroke.stderr).toContain(
            '💥 MalfunctionError: get_cycle_count: grep broke (rc=2)',
          );
          expect(scene.lockCreateBroke.status).toBe(1);
          expect(scene.lockCreateBroke.stdout).toContain(
            '💥 MalfunctionError: could not create the lock',
          );
          expect(scene.lockCreateBroke.stdout).not.toContain('within ~5s');
          expect(scene.lockSleepBroke.status).toBe(1);
          expect(scene.lockSleepBroke.stdout).toContain(
            '💥 MalfunctionError: could not wait the lock backoff for',
          );
          expect(scene.lockSleepBroke.stdout).not.toContain('within ~5s');
          expect(scene.lineReadBroke.status).toBe(1);
          expect(scene.lineReadBroke.stderr).toContain(
            '💥 MalfunctionError: has_cycle_line: grep broke (rc=2)',
          );
          expect(
            Object.fromEntries(
              (
                ['blockReadBroke', 'countReadBroke', 'lineReadBroke'] as const
              ).map((key) => [
                key,
                scene[key].stderr.split(scene.lockedDir).join('<dir>'),
              ]),
            ),
          ).toMatchSnapshot();
        },
      );

      then(
        'a mkdir that refused for "File exists" reads as contention, even with the dir gone',
        () => {
          expect(scene.extantRefusalGone.status).toBe(0);
        },
      );

      then(
        'a route that lost one guard renders that stone alone, its neighbours paired, with the bare prefix it was given',
        () => {
          expect(scene.stonesGuardAbsent.status).toBe(0);
          expect(scene.stonesGuardAbsent.stdout).toContain('3.verify.stone\n');
          expect(scene.stonesGuardAbsent.stdout).not.toContain(
            '3.verify.stone / .guard',
          );
          expect(scene.stonesGuardAbsent.stdout).toContain(
            '2.detect.stone / .guard',
          );
          // an explicit empty prefix means no gutter, never the default indent
          expect(scene.stonesGuardAbsent.stdout.startsWith('├─ ')).toBe(true);
          expect(scene.stonesGuardAbsent.stdout).toMatchSnapshot();
        },
      );

      then(
        'a carry for a cycle a later block follows is refused (rc 1), the record untouched',
        () => {
          expect(scene.carryNotLast.status).toBe(1);
          expect(scene.carryNotLast.stdout).toContain(
            '💥 MalfunctionError: cycle 1 would land after cycle 2 in <dir>/rec/carry.md, out of order',
          );
          expect(scene.carryNotLast.recordAfter).toEqual(
            '## cycle 2\n- spent: 2 / 3\n',
          );
        },
      );

      then(
        'a lock holder this shell cannot signal is never offered for removal',
        () => {
          expect(scene.holderUnsignalable.stdout).toContain(
            'held by pid 1, which this shell cannot signal',
          );
          expect(scene.holderUnsignalable.stdout).toContain(
            'fix: do not remove <dir>/held.lock; wait for the drive that holds it to end, then re-run',
          );
          expect(scene.holderUnsignalable.stdout).not.toContain('rm -r');
          expect(scene.holderUnsignalable.stdout.split('\n')[0]).toEqual(
            'rc=3',
          );
          // the pid is named once: kill's own `(1) - ` echo of it is cut
          expect(scene.holderUnsignalable.stdout).toContain(
            'cannot signal; said: kill: Operation not permitted',
          );
        },
      );

      then(
        'a block cut that breaks (awk) surfaces its break (rc 1), snapped',
        () => {
          expect(scene.blockCutBroke.status).toBe(1);
          expect(scene.blockCutBroke.stderr).toContain(
            '💥 MalfunctionError: get_cycle_block: awk broke (rc=2)',
          );
          expect(scene.blockCutBroke.stderr).toMatchSnapshot();
        },
      );

      then(
        'a count read that prints no number is a break (rc 1), never zero cycles, snapped',
        () => {
          expect(scene.countNotRead.status).toBe(1);
          expect(scene.countNotRead.stdout).toEqual('');
          expect(scene.countNotRead.stderr).toContain(
            '💥 MalfunctionError: get_cycle_count: no count read from',
          );
          expect(scene.countNotRead.stderr).toMatchSnapshot();
        },
      );

      then(
        'a marker for a cycle a later block follows is refused (rc 1), the record untouched',
        () => {
          expect(scene.markerNotLast.status).toBe(1);
          expect(scene.markerNotLast.stdout).toContain(
            'cycle 1 is no longer the last block of',
          );
          expect(scene.markerNotLast.recordAfter).toEqual(
            '## cycle 1\n- spent: 1 / 3\n\n## cycle 2\n- spent: 2 / 3\n',
          );
        },
      );

      then(
        'a removal that reports success yet leaves the route dir is named (rc 1)',
        () => {
          expect(scene.delStands.status).toBe(1);
          expect(scene.delStands.stdout).toContain(
            '.behavior/v2026_01_01.stands still stands after the removal',
          );
        },
      );
    });

    when(
      '[t4] a route dir stands with no stones, or a scope sits outside the repo',
      () => {
        then('the stoneless dir is no route on disk', () => {
          expect(scene.stonelessRoute.status).toBe(1);
        });
        then(
          'a symlinked scope, dir or file, canonicalizes to its target, so one surface lands one route',
          () => {
            expect(scene.symlinkScope.status).toBe(0);
            expect(scene.symlinkScope.stdout.split('\n')).toEqual([
              'sym/real/foo',
              'sym/real/foo',
              'sym/real/a.ts',
              'sym/real/a.ts',
            ]);
          },
        );
        then(
          'a write whose draft removal breaks too names the leftover draft, so the debris is explained',
          () => {
            expect(scene.draftCleanupBroken.status).toBe(1);
            expect(scene.draftCleanupBroken.drafts).toHaveLength(1);
            expect(scene.draftCleanupBroken.masked).toContain(
              'could not remove the draft <habitat>/drafts/0.scope.md.draft.<pid>',
            );
            expect(scene.draftCleanupBroken.masked).toMatchSnapshot();
          },
        );
        then(
          'a reopen probe whose cycle count breaks halts as a read break, with the tool cause',
          () => {
            const [cause, rcLine] = scene.reopenCountBroke.stdout.split('\n');
            expect(rcLine).toMatch(/^rc=(\d+) want=\1$/);
            expect(cause).toContain('get_cycle_count');
          },
        );
        then(
          'a reopen probe whose marker read breaks halts as a read break and keeps the leaf cause',
          () => {
            const [cause, rcLine] = scene.reopenMarkerBroke.stdout.split('\n');
            expect(rcLine).toMatch(/^rc=(\d+) want=\1$/);
            expect(cause).toContain(
              'could not read the rewound marker of cycle 1',
            );
            expect(cause).toContain('grep');
          },
        );
        then(
          'a marker whose later-block probe breaks is refused, and the record stays byte-identical',
          () => {
            expect(scene.markerProbeBroke.status).toBe(1);
            expect(scene.markerProbeBroke.bodyKept).toBe(true);
          },
        );
        then(
          "init's literal flag list is the sweep's less --mode, so a new sweep flag reddens here until init lists it",
          () => {
            const [sweep, init] = scene.flagLists.stdout.split('\n');
            expect(init?.split(' ')).toEqual(
              sweep?.split(' ').filter((flag) => flag !== '--mode'),
            );
          },
        );
        then(
          'the outside scope keeps its absolute path, never a relative guess',
          () => {
            expect(scene.outsideScope.status).toBe(0);
            expect(scene.outsideScope.stdout).toEqual('/elsewhere/src');
          },
        );
      },
    );

    when('[t5] a scope record field is absent or its read breaks', () => {
      then('each verdict is named, never an empty value', () => {
        // each fault returns its own verdict, so the caller names a fitted remedy
        expect(scene.fieldAbsent.status).toBe(2);
        expect(scene.fieldAbsent.stdout).toContain('lacks its budget field');
        expect(scene.fieldReadBroke.status).toBe(3);
        expect(scene.fieldReadBroke.stdout).toContain('grep broke (rc=2)');
      });
    });

    when('[t6] a count is checked at its bounds', () => {
      COUNT_CASES.map((thisCase, index) =>
        then(
          `${thisCase.value} is ${thisCase.valid ? 'valid' : 'invalid'}`,
          () => {
            expect(scene.counts[index]!.run.status).toBe(
              thisCase.valid ? 0 : 1,
            );
          },
        ),
      );
    });

    when('[t7] each leaf failure render is read whole', () => {
      // a cause an operator reads inside a belay is pinned whole, so its class prefix, path, and
      // trailer cannot drift green behind a substring assert
      // each leaf pins its verdict code beside its bytes, so a drifted verdict reddens on the
      // assertion even after a snapshot regen (holderUnsignalable's printf exits 0; its rc is line 1)
      const LEAF_RENDERS = [
        { key: 'delOutside', status: 1 },
        { key: 'delParent', status: 1 },
        { key: 'delNested', status: 1 },
        { key: 'delStands', status: 1 },
        { key: 'carryNotLast', status: 1 },
        { key: 'markerNotLast', status: 1 },
        { key: 'lockCreateBroke', status: 1 },
        { key: 'lockSleepBroke', status: 1 },
        { key: 'fieldAbsent', status: 2 },
        { key: 'fieldReadBroke', status: 3 },
        { key: 'holderUnsignalable', status: 0 },
      ] as const;
      LEAF_RENDERS.map(({ key, status }) =>
        then(
          `${key}: exits ${status}, and its render matches the snapshot`,
          () => {
            expect(scene[key].status).toBe(status);
            expect(scene[key].stdout).not.toEqual('');
            // the temp habitat each scene runs in is host-specific; mask it up to `.behavior/`,
            // and mask mkdir's vendor phrase, which differs between GNU and BSD
            expect(
              asMkdirVendorMasked({
                out: scene[key].stdout
                  .split(scene.lockedDir)
                  .join('<dir>')
                  .replace(/\/\S*?\/(?=\.behavior\/)/g, '<habitat>/'),
              }),
            ).toMatchSnapshot();
          },
        ),
      );
    });

    when('[t8] a removal aims outside .behavior/', () => {
      then('it refuses and removes naught', () => {
        expect(scene.delOutside.status).toBe(1);
        expect(scene.delOutside.stdout).toContain(
          'is not a route under .behavior/',
        );
        expect(scene.lockedDirLeft).toBe(true);
      });
      then(
        'a `..` segment under .behavior/ is refused too, so the prefix cannot aim the removal out',
        () => {
          expect(scene.delParent.status).toBe(1);
          expect(scene.delParent.stdout).toContain(
            'refused: .behavior/.. is not a route under .behavior/',
          );
          expect(scene.delNested.status).toBe(1);
          expect(scene.delNested.stdout).toContain(
            'refused: .behavior/../locked is not a route under .behavior/',
          );
          expect(scene.lockedDirLeft).toBe(true);
        },
      );
    });

    when('[t9] the scope exists but cannot be entered', () => {
      then('plan and init each halt (exit 1) with the cause and a fix', () => {
        expect(scene.lockedPlan.exitCode).toBe(1);
        expect(scene.lockedPlan.stdout).toContain(
          'could not name the scope from the repo root',
        );
        expect(scene.lockedPlan.stdout).toContain(
          "fix: check the scope's permissions",
        );
        expect(scene.lockedPlan.masked).toMatchSnapshot();
        expect(scene.lockedInit.exitCode).toBe(1);
        expect(scene.lockedInit.stdout).toContain(
          'could not name the scope from the repo root',
        );
        expect(scene.lockedInit.masked).toMatchSnapshot();
      });
    });

    when('[t10] git breaks on the branch read before a bind', () => {
      then('init halts (exit 1) as not bound, with the cause', () => {
        expect(scene.branchReadBroke.exitCode).toBe(1);
        expect(scene.branchReadBroke.stdout).toContain(
          'not bound: could not read the current branch',
        );
        expect(scene.branchReadBroke.stdout).not.toContain('bound to branch');
        expect(maskRouteDate(scene.branchReadBroke.stdout)).toMatchSnapshot();
      });
      then('a repo with no commit yet still names its branch', () => {
        // rev-parse exits 128 on an unborn HEAD; the bind label must not dead-end there
        expect(scene.unbornBranch.status).toBe(0);
        expect(scene.unbornBranch.stdout).toEqual('main');
      });
    });
  });

  given(
    '[case34] apply reuses a bound route its request does not price',
    () => {
      // a bare re-run passes no --peers/--budget; it must keep the route's recorded cap, never
      // reset a live loop's one hard stop to a default
      const scene = useBeforeAll(async () => {
        const dir = setupHabitat({ slug: 'redteam-reuse-keep' });
        runGuardianSkill(
          {
            skill: INIT,
            args: '--scope . --grain all --peers 6 --budget 3 --skip-route-bind',
            cwd: dir,
          },
          { env: { PATH: PATH_WITHOUT_RHX } },
        );
        const route = findRouteDir(dir);
        const env = {
          PATH: genGuardianStubBinPath(),
          STUB_BOUND_ROUTE: join('.behavior', basename(route)),
        };
        const bare = runGuardianSkill(
          {
            skill: SKILL,
            args: '--scope . --grain all --mode apply',
            cwd: dir,
          },
          { env },
        );
        const recordAfterBare = readFileSync(
          join(route, '0.scope.md'),
          'utf-8',
        );
        const priced = runGuardianSkill(
          {
            skill: SKILL,
            args: '--scope . --grain all --budget 5 --mode apply',
            cwd: dir,
          },
          { env },
        );
        const recordAfterPriced = readFileSync(
          join(route, '0.scope.md'),
          'utf-8',
        );

        // the drive walks 1.ground, which cuts the slices and writes its yield once
        writeFileSync(
          join(route, '.claims', '1.ground.yield.md'),
          '# 1.ground — slices cut\n',
        );
        const widened = runGuardianSkill(
          {
            skill: SKILL,
            args: '--scope . --grain all --peers 9 --mode apply',
            cwd: dir,
          },
          { env },
        );
        const recordAfterWidened = readFileSync(
          join(route, '0.scope.md'),
          'utf-8',
        );
        const groundedBudget = runGuardianSkill(
          {
            skill: SKILL,
            args: '--scope . --grain all --budget 7 --mode apply',
            cwd: dir,
          },
          { env },
        );
        const recordAfterGroundedBudget = readFileSync(
          join(route, '0.scope.md'),
          'utf-8',
        );

        // the drive walks 5.promote, which ends the sweep: budget spent, a critical claim open
        writeFileSync(
          join(route, '.claims', '5.promote.yield.md'),
          '## the terminal verdict\n- state: budget-out-with-critical\n- decision: terminate + escalate "add budget"\n',
        );
        const finishedBare = runGuardianSkill(
          {
            skill: SKILL,
            args: '--scope . --grain all --mode apply',
            cwd: dir,
          },
          { env },
        );
        const recordAfterFinishedBare = readFileSync(
          join(route, '0.scope.md'),
          'utf-8',
        );
        // a sweep that ended held on a human: no budget or rewind closes it, so the fix names
        // the human acts, never a raised budget
        writeFileSync(
          join(route, '.claims', '5.promote.yield.md'),
          '## the terminal verdict\n- state: held-on-human\n- decision: terminate + escalate the human act\n',
        );
        const finishedHeld = runGuardianSkill(
          {
            skill: SKILL,
            args: '--scope . --grain all --mode apply',
            cwd: dir,
          },
          { env },
        );
        writeFileSync(
          join(route, '.claims', '5.promote.yield.md'),
          '## the terminal verdict\n- state: budget-out-with-critical\n- decision: terminate + escalate "add budget"\n',
        );
        const finishedReopen = runGuardianSkill(
          {
            skill: SKILL,
            args: '--scope . --grain all --budget 9 --mode apply',
            cwd: dir,
          },
          { env },
        );
        const recordAfterFinishedReopen = readFileSync(
          join(route, '0.scope.md'),
          'utf-8',
        );
        // the promote read breaks: a broken read must halt, never read as "not ended"
        const decisionReadBroke = runGuardianSkill(
          {
            skill: SKILL,
            args: '--scope . --grain all --mode apply',
            cwd: dir,
          },
          {
            env: {
              ...env,
              PATH: `${genBrokenToolBin({ tool: 'grep', exitCode: 2, failOn: '- decision: ' })}:${env.PATH}`,
            },
          },
        );
        // a promote yield with no decision line yet: the sweep reads as unended, so it hands off
        writeFileSync(
          join(route, '.claims', '5.promote.yield.md'),
          '## the terminal verdict\n- state: in progress\n',
        );
        const decisionAbsent = runGuardianSkill(
          {
            skill: SKILL,
            args: '--scope . --grain all --mode apply',
            cwd: dir,
          },
          { env },
        );
        // the reopen's rewind marked the last cycle; the promote yield still holds its terminate
        writeFileSync(
          join(route, '.claims', '5.promote.yield.md'),
          '## the terminal verdict\n- state: budget-out-with-critical\n- decision: terminate + escalate "add budget"\n',
        );
        writeFileSync(
          join(route, '.claims', '0.cycle.md'),
          '## cycle 1\n- spent: 1 / 9\n- rewound: yes\n',
        );
        const reopenedSince = runGuardianSkill(
          {
            skill: SKILL,
            args: '--scope . --grain all --mode apply',
            cwd: dir,
          },
          { env },
        );
        // the reopen probe's cycle read breaks: a broken read must halt, never read as "not reopened"
        const reopenReadBroke = runGuardianSkill(
          {
            skill: SKILL,
            args: '--scope . --grain all --mode apply',
            cwd: dir,
          },
          {
            env: {
              ...env,
              PATH: `${genBrokenToolBin({ tool: 'grep', exitCode: 2, failOn: '^## cycle ' })}:${env.PATH}`,
            },
          },
        );
        // a finished sweep whose record budget is damaged: the reopen compare must halt on the
        // record, never on bash arithmetic over a non-number
        rmSync(join(route, '.claims', '0.cycle.md'));
        writeFileSync(
          join(route, '0.scope.md'),
          readFileSync(join(route, '0.scope.md'), 'utf-8').replace(
            /^- budget: .*$/m,
            '- budget: n/a',
          ),
        );
        const finishedDamaged = runGuardianSkill(
          {
            skill: SKILL,
            args: '--scope . --grain all --budget 9 --mode apply',
            cwd: dir,
          },
          { env },
        );
        return {
          reopenedSince,
          reopenReadBroke,
          finishedDamaged,
          decisionReadBroke,
          decisionAbsent,
          bare,
          recordAfterBare,
          priced,
          recordAfterPriced,
          widened,
          recordAfterWidened,
          groundedBudget,
          recordAfterGroundedBudget,
          finishedBare,
          recordAfterFinishedBare,
          finishedHeld,
          finishedReopen,
          recordAfterFinishedReopen,
          drafts: readdirSync(route).filter((e) => e.includes('.draft.')),
        };
      });

      when('[t4] the route sweep has ended at its promote', () => {
        then(
          'a bare re-run belays (exit 2): it would adopt naught and drive naught, so no fresh sweep is implied',
          () => {
            expect(scene.finishedBare.exitCode).toBe(2);
            expect(scene.finishedBare.stdout).toContain(
              'this route\'s sweep already ended (its promote decided: terminate + escalate "add budget")',
            );
            expect(scene.finishedBare.stdout).toContain(
              'to sweep fresh, unbind (rhx route.bind.del), remove the route dir, and re-run',
            );
            expect(scene.finishedBare.stdout).not.toContain(
              'next: rhx route.drive',
            );
            expect(scene.recordAfterFinishedBare).toContain('- budget: 7');
            expect(maskRouteDate(scene.finishedBare.stdout)).toMatchSnapshot();
          },
        );
        then(
          'a sweep held on a human belays (exit 2) and names the human acts first, then the reopen',
          () => {
            expect(scene.finishedHeld.exitCode).toBe(2);
            expect(scene.finishedHeld.stdout).toContain(
              'no budget or rewind closes a claim held on a human',
            );
            expect(scene.finishedHeld.stdout).toContain('`human acts owed`');
            // the reopen comes only after the human acts land, so verify can close them
            expect(scene.finishedHeld.stdout).toContain(
              'first run each act under',
            );
            expect(scene.finishedHeld.stdout).toContain(
              'record each rotate output in .claims/rotate.proofs.md',
            );
            expect(maskRouteDate(scene.finishedHeld.stdout)).toMatchSnapshot();
          },
        );
        then(
          'a raised budget reopens it (exit 0), and the handoff names the rewind before the drive',
          () => {
            expect(scene.finishedReopen.exitCode).toBe(0);
            expect(scene.recordAfterFinishedReopen).toContain('- budget: 9');
            expect(scene.finishedReopen.stdout).toContain(
              'a drive alone walks naught; first reopen the loop with the rewind-detect its verdict names',
            );
            expect(
              maskRouteDate(scene.finishedReopen.stdout),
            ).toMatchSnapshot();
          },
        );
        then(
          'a promote read that breaks halts (exit 1) on its cause, never reads as an unended sweep',
          () => {
            expect(scene.decisionReadBroke.exitCode).toBe(1);
            expect(scene.decisionReadBroke.stdout).toContain(
              "could not read whether the bound route's sweep has ended",
            );
            expect(scene.decisionReadBroke.stdout).toContain('grep broke');
            expect(scene.decisionReadBroke.stdout).not.toContain(
              'anchors away!',
            );
            expect(
              maskRouteDate(scene.decisionReadBroke.stdout),
            ).toMatchSnapshot();
          },
        );
        then(
          'a finished sweep whose reopen probe cannot read the cycle record halts (exit 1) on the cause, never "already ended"',
          () => {
            expect(scene.reopenReadBroke.exitCode).toBe(1);
            expect(scene.reopenReadBroke.stdout).toContain(
              "could not read whether the bound route's sweep was reopened",
            );
            expect(scene.reopenReadBroke.stdout).toContain('grep broke');
            expect(scene.reopenReadBroke.stdout).not.toContain('already');
            expect(
              maskRouteDate(scene.reopenReadBroke.stdout),
            ).toMatchSnapshot();
          },
        );
        then(
          'a finished sweep with a damaged record budget halts (exit 1) on the record, never an arithmetic error',
          () => {
            expect(scene.finishedDamaged.exitCode).toBe(1);
            expect(scene.finishedDamaged.stdout).toContain(
              "the bound route's scope record holds an invalid count",
            );
            expect(scene.finishedDamaged.stdout).toContain('budget=n/a');
            expect(scene.finishedDamaged.stderr).not.toContain('division');
            expect(scene.finishedDamaged.stdout).not.toContain(
              're-run with --budget above n/a',
            );
            expect(
              maskRouteDate(scene.finishedDamaged.stdout),
            ).toMatchSnapshot();
          },
        );
        then(
          'a terminate that a rewind has since reopened reads as live: it hands off (exit 0), never "already ended"',
          () => {
            expect(scene.reopenedSince.exitCode).toBe(0);
            expect(scene.reopenedSince.stdout).toContain('anchors away!');
            expect(scene.reopenedSince.stdout).not.toContain('already ended');
          },
        );
        then(
          'a promote yield with no decision line reads as unended: it hands off (exit 0)',
          () => {
            expect(scene.decisionAbsent.exitCode).toBe(0);
            expect(scene.decisionAbsent.stdout).toContain('anchors away!');
            expect(scene.decisionAbsent.stdout).not.toContain('already ended');
          },
        );
      });

      when(
        '[t2] the route has grounded and the re-run passes a new --peers',
        () => {
          then(
            'it belays (exit 2): the slices are cut, so a new count would widen no sweep',
            () => {
              expect(scene.widened.exitCode).toBe(2);
              expect(scene.widened.stdout).toContain(
                'peers are fixed once 1.ground cuts the slices; this route grounded at peers=6',
              );
              expect(scene.widened.stdout).not.toContain('adopted');
              expect(scene.recordAfterWidened).toContain('- peers: 6');
              expect(maskRouteDate(scene.widened.stdout)).toMatchSnapshot();
            },
          );
        },
      );

      when(
        '[t3] the route has grounded and the re-run passes only --budget',
        () => {
          then(
            'the budget is adopted, since each rewind reads it fresh',
            () => {
              expect(scene.groundedBudget.exitCode).toBe(0);
              expect(scene.recordAfterGroundedBudget).toContain('- peers: 6');
              expect(scene.recordAfterGroundedBudget).toContain('- budget: 7');
              expect(scene.groundedBudget.stdout).toContain(
                'peers=6 budget=7 adopted; was peers=6 budget=5)',
              );
              expect(
                maskRouteDate(scene.groundedBudget.stdout),
              ).toMatchSnapshot();
            },
          );
        },
      );

      when('[t0] the re-run passes neither --peers nor --budget', () => {
        then(
          'the recorded peers + budget stand, and the plan prices them',
          () => {
            expect(scene.bare.exitCode).toBe(0);
            expect(scene.recordAfterBare).toContain('- peers: 6');
            expect(scene.recordAfterBare).toContain('- budget: 3');
            expect(scene.bare.stdout).toContain(
              'peers=6 budget=3 kept from its record',
            );
            expect(scene.bare.stdout).toContain('--peers 6 --budget 3');
            expect(maskRouteDate(scene.bare.stdout)).toMatchSnapshot();
          },
        );
      });

      when('[t1] the re-run passes only --budget', () => {
        then('the budget is adopted and the recorded peers stand', () => {
          expect(scene.priced.exitCode).toBe(0);
          expect(scene.recordAfterPriced).toContain('- peers: 6');
          expect(scene.recordAfterPriced).toContain('- budget: 5');
          expect(scene.priced.stdout).toContain(
            'peers=6 budget=5 adopted; was peers=6 budget=3)',
          );
          expect(scene.drafts).toEqual([]);
        });
      });
    },
  );
});

/**
 * .what = a fixture spawn's result, proven to have run
 * .why  = a spawn that never ran has a null status and an undefined pid; a fixture that read
 *         those as "gone" or "not signalable" would grade a broken host as a clean verdict
 */
const assureSpawnRan = <T extends ReturnType<typeof spawnSync>>(input: {
  run: T;
  what: string;
}): T => {
  if (input.run.error || input.run.status === null || !input.run.pid)
    throw new MalfunctionError('a fixture spawn did not run', {
      what: input.what,
      error: input.run.error?.message ?? null,
      signal: input.run.signal,
      hint: 'check that the tool is on PATH and runnable',
    });
  return input.run;
};

/**
 * .what = the redteam routes under a habitat's `.behavior/` (none when no such path stands)
 * .why  = a `.behavior` that is not a dir cannot be read for routes, so it throws rather than
 *         pass for "no routes left" (rule.forbid.failhide)
 */
const getRedteamRoutes = (input: { cwd: string }): string[] => {
  const behaviorDir = join(input.cwd, '.behavior');
  if (!existsSync(behaviorDir)) return [];
  if (!statSync(behaviorDir).isDirectory())
    throw new MalfunctionError(
      'the habitat .behavior is no dir, so its routes cannot be read',
      {
        behaviorDir,
        hint: 'a scene that stages .behavior as a file must not assert on routesLeft',
      },
    );
  return readdirSync(behaviorDir).filter((e) => e.includes(`.${ROUTE_KIND}`));
};

/**
 * .what = a temp habitat that holds a prior day's redteam route dir for the whole-repo leak
 *         sweep — its scope record only, no stone or guard, so it is no driveable route
 * .why  = a stale route dir of the same sweep must never stand in for one a run made today.
 *         the habitat is a checked-in fixture, cloned, so its shape is reviewable as files.
 *         a case that needs a whole route scaffolds one; this dir is not that route
 */
const genHabitatWithStaleRoute = (input: { slug: string }): string => {
  const dir = genTempDir({
    slug: input.slug,
    clone: join(__dirname, '.test', 'assets', 'habitat.with-stale-route'),
    git: true,
  });
  setHabitatBranchMain({ dir });
  return dir;
};

/**
 * .what = a temp copy of the guardian skills dir, with one part of the install damaged
 * .why  = a broken install is a real state an operator can meet (a partial checkout, a bad
 *         publish); a damaged copy drives the skill's install checks for real, no mock
 */
const genSkillCopy = (input: {
  damage:
    | 'templates-absent'
    | 'templates-empty'
    | 'templates-partial'
    | 'init-absent'
    | 'init-noexec'
    | 'init-noop'
    | 'init-partial'
    | 'init-ghost';
}): string => {
  const root = genTempDir({
    slug: `redteam-skill-${input.damage}`,
    clone: __dirname,
  });
  const skillDir = join(root, 'security.habitat.redteam');
  const templatesDir = join(skillDir, 'templates');
  chmodSync(join(skillDir, 'init.sh'), 0o755);
  if (input.damage === 'templates-absent')
    rmSync(templatesDir, { recursive: true });
  if (input.damage === 'templates-empty') {
    rmSync(templatesDir, { recursive: true });
    mkdirSync(templatesDir);
  }
  if (input.damage === 'templates-partial')
    rmSync(join(templatesDir, '3.verify.guard'));
  if (input.damage === 'init-absent') rmSync(join(skillDir, 'init.sh'));
  // the state a publish that drops the exec bit leaves: init.sh present, mode 0644
  if (input.damage === 'init-noexec')
    chmodSync(join(skillDir, 'init.sh'), 0o644);
  // an init that reports clean (exit 0) yet scaffolds naught: the caller must read the
  // route back from disk, never trust the exit code alone
  if (input.damage === 'init-noop')
    writeFileSync(join(skillDir, 'init.sh'), '#!/usr/bin/env bash\nexit 0\n');
  // an init that reports clean and names its route, yet leaves the route short of its stones:
  // the caller must confirm the whole required set, never the dir alone
  if (input.damage === 'init-partial')
    writeFileSync(
      join(skillDir, 'init.sh'),
      [
        '#!/usr/bin/env bash',
        `route=".behavior/v2020_02_02.${ROUTE_KIND}.grain=leak"`,
        'mkdir -p "$route" && : > "$route/1.ground.stone"',
        'echo "   ├─ route: $route/ ✨"',
        '',
      ].join('\n'),
    );
  // an init that reports clean and names a route it never made: the caller must trust the
  // disk, never the render
  if (input.damage === 'init-ghost')
    writeFileSync(
      join(skillDir, 'init.sh'),
      [
        '#!/usr/bin/env bash',
        `echo "   ├─ route: .behavior/v2020_02_02.${ROUTE_KIND}.grain=leak/ ✨"`,
        '',
      ].join('\n'),
    );
  return root;
};
