import { genTempDir, given, then, useBeforeAll, when } from 'test-fns';

import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { PATH_WITHOUT_RHX } from '../../.test/runRoleSkill';
import {
  genGuardianStubBinPath,
  maskRouteDate,
  runGuardianSkill,
} from './.test/runGuardianSkill';

/**
 * .what = render + contract clamps for every critipath of the `security.habitat.redteam`
 *         cli — help, plan, init scaffold, apply handoff, and every belay
 * .why  = the skill shipped with its contract surface smoke-tested by hand and no committed
 *         coverage. a peer review blocked the build on exactly that: an invalid `--mode`
 *         once fell through both branches to a silent exit-0 (a friction hazard), and no
 *         snapshot pinned what an operator actually reads at each belay. this suite makes
 *         each path a committed render a reviewer can vibecheck and a drift reddens.
 *
 *         no mocks (rule.forbid.integration.mocks). the sweep is pure bash over a temp git
 *         habitat; `PATH_WITHOUT_RHX` holds the help/plan/init/belay paths hermetic, and a
 *         guardian-local stub `rhx` answers the one `route.bind.get` probe the apply path
 *         makes, so apply reaches its scaffold + honest-handoff branch with no bound route.
 */

const SKILL = 'security.habitat.redteam.sh';
const INIT = 'security.habitat.redteam/init.sh';

// read the route-kind token from output.sh's single source, never a hardcoded literal —
// so a rename of ROUTE_KIND reddens this suite loud rather than silently desyncs it.
const ROUTE_KIND = execSync(
  `bash -c 'source "${join(__dirname, 'security.habitat.redteam', 'output.sh')}"; printf "%s" "$ROUTE_KIND"'`,
)
  .toString()
  .trim();

const setupHabitat = (input: { slug: string }): string =>
  genTempDir({ slug: input.slug, git: true });

/** locate the scaffolded route dir (its slug carries today's date, the grain, and
 * — for a subtree sweep — a scope token; so match the ROUTE_KIND token ANYWHERE in the
 * slug, the same shape the shell's route probe uses). */
const findRouteDir = (cwd: string): string => {
  const behaviorDir = join(cwd, '.behavior');
  const entries = readdirSync(behaviorDir);
  const route = entries.find((e) => e.includes(`.${ROUTE_KIND}`));
  // throw, never fall back — a silent miss would let a scaffold assertion pass over a
  // habitat that was never scaffolded (rule.forbid.failhide).
  if (!route)
    throw new Error(
      `no ${ROUTE_KIND} route under ${behaviorDir}: [${entries.join(', ')}]`,
    );
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
      };
    });

    when('[t0] help is the first token', () => {
      then('it exits 0', () => {
        expect(scene.bare.exitCode).toBe(0);
      });

      then('the full help stdout matches snapshot (visual vibecheck)', () => {
        expect(scene.bare.stdout).toMatchSnapshot();
      });

      then('it carries the not-security-advice disclaimer', () => {
        expect(scene.bare.stdout).toContain('NOT professional security advice');
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
      };
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
          '18 peers × 3 cycle(s) = up to 54 peer-dispatch runs',
        );
      });

      then('all three grain prompts are emitted', () => {
        expect(scene.all.stdout).toContain('infil — "what reaches IN');
        expect(scene.all.stdout).toContain(
          'exfil — "by what channel could data leave',
        );
        expect(scene.all.stdout).toContain('leak  — "what value on this slice');
      });
    });

    when('[t1] a single grain defaults peers=3, budget=1', () => {
      then('it exits 0 and matches snapshot', () => {
        expect(scene.exfil.exitCode).toBe(0);
        expect(scene.exfil.stdout).toMatchSnapshot();
      });

      then('it emits one partition and only the exfil prompt', () => {
        expect(scene.exfil.stdout).toContain('1 partition(s)');
        expect(scene.exfil.stdout).toContain('exfil — "by what channel');
        expect(scene.exfil.stdout).not.toContain('infil — "what reaches IN');
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
        flagEatsFlag: run('--scope --grain all --mode plan'),
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
      // the blocker the peer review caught: an invalid --mode once fell through both the
      // plan and apply branches to a silent exit-0 "success" for a run that swept nil.
      // the enum guard now belays it — exit 2, never a no-op success.
      then('it belays (exit 2), never a silent exit-0 no-op', () => {
        expect(scene.invalidMode.exitCode).toBe(2);
        expect(scene.invalidMode.stdout).toContain('invalid --mode: bogus');
        expect(scene.invalidMode.stdout).toMatchSnapshot();
      });

      then('it does NOT emit a plan or a handoff for the bogus mode', () => {
        expect(scene.invalidMode.stdout).not.toContain('chartin course');
        expect(scene.invalidMode.stdout).not.toContain('the ward loop:');
      });
    });

    when('[t8] an unknown argument is passed', () => {
      then('it is a constraint (exit 2) and matches snapshot', () => {
        expect(scene.unknownArg.exitCode).toBe(2);
        expect(scene.unknownArg.stdout).toContain('unknown argument: --bogus');
        expect(scene.unknownArg.stdout).toMatchSnapshot();
      });
    });

    when('[t9] a flag stands where --scope value should be', () => {
      // require_val must belay about --scope, never let --grain be eaten as its value.
      then('it belays about --scope, not about --grain', () => {
        expect(scene.flagEatsFlag.exitCode).toBe(2);
        expect(scene.flagEatsFlag.stdout).toContain('absent value for --scope');
        expect(scene.flagEatsFlag.stdout).not.toContain('grain');
      });
    });
  });

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

        // prove the gitignore by BEHAVIOR, never by string alone: drop a claim yield into
        // .claims/ and confirm the temp git repo treats it as ignored. this is the security
        // linchpin the whole design leans on (a live claim must never publish) — a string
        // read of the .gitignore cannot prove git actually ignores a dropped claim.
        writeFileSync(
          join(route, '.claims/2.detect.yield.md'),
          '### claim: demo\n- grain: leak\n',
          'utf-8',
        );
        const claimIgnoreCheck = execSync(
          'git check-ignore .claims/2.detect.yield.md || echo NOT_IGNORED',
          { cwd: route, encoding: 'utf-8' },
        ).trim();
        // the flat shape above is not the shape 2.detect actually writes — the stone commits
        // per-grain-namespaced claims at `.claims/{grain}/{peer}.md` (nested). the unanchored
        // `*` covers nested paths, so this is not a live bug — but the whole design leans on
        // "a live claim never publishes", so prove the linchpin at the shape the loop REALLY
        // produces, never only the flat one (rule.require.behavior-intent-coverage).
        const nestedClaimIgnoreCheck = execSync(
          'mkdir -p .claims/leak && printf "x" > .claims/leak/peer-01.md && git check-ignore .claims/leak/peer-01.md || echo NOT_IGNORED',
          { cwd: route, encoding: 'utf-8' },
        ).trim();

        // a SUPPLIED --peers/--budget must persist into the scope record, never be
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

        // scope canonicalization: `--scope ./` must land the SAME route slug as
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
          // contract: promote must NAME the rewind command (the route is forward-only, so
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
              // 1.ground.guard was i004's single most-emphasized fix (the one stage
              // with zero enforcement). it is asserted explicitly here, never left to
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
            // git check-ignore echoes the path when it IS ignored, else our `|| echo`
            // fires. the security linchpin proven by behavior in the temp git repo.
            expect(scene.claimIgnoreCheck).toBe('.claims/2.detect.yield.md');
          },
        );

        then(
          'a NESTED per-grain claim (the shape 2.detect really writes) is git-ignored too',
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
          'the promote stone NAMES the concrete rewind command (the loop is inert prose without it)',
          () => {
            // the route is forward-only; "loop → go again" is unrunnable unless the stone
            // names the one command that walks it back. a plain string-content fact, as
            // testable as the scope-record assertion above.
            expect(scene.promoteStone).toContain(
              'rhx route.stone.set --stone 2.detect --as rewound',
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
          'the re-detect trust mechanism is WIRED: detect re-hunts the carried keys, verify flips them',
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
          'it lands the SAME route slug (no .scope= token) and records a canonical scope',
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
      // scaffold once, then a second time into the SAME habitat to prove idempotency belays
      const first = run('--scope . --grain all --skip-route-bind');
      // drop a sentinel into the first route's in-flight .claims/, THEN run a second init
      // against the same surface. the atomic clobber guard must refuse (exit 2) AND leave
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
        expect(scene.help.stdout).toMatchSnapshot();
      });
    });

    when('[t1] an unknown argument is passed to init', () => {
      // the nitpick the peer review raised: init.sh once swallowed an unknown flag silently
      // and scaffolded under the default grain. it now belays, consistent with the parent.
      then('it belays (exit 2), never scaffolds under a wrong default', () => {
        expect(scene.unknownArg.exitCode).toBe(2);
        expect(scene.unknownArg.stdout).toContain('unknown argument: --bogus');
        // snap the init belay render too, so a drift in what an operator sees on a
        // direct-invocation block reddens like the main-skill belays (case3).
        expect(scene.unknownArg.stdout).toMatchSnapshot();
      });
    });

    when('[t2] --grain is given no value', () => {
      // the paired nitpick: --scope/--grain once took $2 unguarded, so a flag became the
      // value. require_init_val now belays loud.
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

    when('[t7] a route for today already exists', () => {
      then('the first scaffold succeeds', () => {
        expect(scene.first.exitCode).toBe(0);
      });

      then('the second refuses to clobber (exit 2)', () => {
        expect(scene.second.exitCode).toBe(2);
        expect(scene.second.stdout).toContain('already exists');
        // snap the clobber-refusal render (date-masked — the route slug carries
        // today's date) so this blocked state vibechecks like the rest.
        expect(maskRouteDate(scene.second.stdout)).toMatchSnapshot();
      });

      then(
        "the refused second init leaves the first route's in-flight .claims/ untouched",
        () => {
          // the TOCTOU guarantee: the atomic clobber guard refuses BEFORE any scaffold
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
        // the guardian stub answers `rhx route.bind.get` with EMPTY (no route bound), so apply
        // reaches its scaffold branch; --skip-route-bind keeps the scaffold unbound, so the
        // honest "NOT bound — bind before you drive" handoff is the branch observed.
        const run = runGuardianSkill(
          {
            skill: SKILL,
            args: '--scope . --grain exfil --mode apply --skip-route-bind',
            cwd: dir,
          },
          { env: { PATH: genGuardianStubBinPath({ cwd: dir }) } },
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

        then('it reports the route scaffolded but NOT bound', () => {
          expect(scene.run.stdout).toContain('scaffolded, NOT bound');
        });

        then(
          'it refuses to promise a drive the unbound route cannot take',
          () => {
            expect(scene.run.stdout).toContain('the route is NOT bound');
            expect(scene.run.stdout).toContain('rhx route.bind.set --route');
            expect(scene.run.stdout).toContain(
              'then drive it: rhx route.drive',
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
        const stubPath = genGuardianStubBinPath({ cwd: dir });
        const runReuse = (grain: string) =>
          runGuardianSkill(
            {
              skill: SKILL,
              args: `--scope . --grain ${grain} --mode apply --skip-route-bind`,
              cwd: dir,
            },
            { env: { PATH: stubPath, STUB_BOUND_ROUTE: routeRel } },
          );
        // capture mismatch + match FIRST, while 0.scope.md is intact
        const mismatch = runReuse('infil'); // grain differs from the bound route's leak
        const match = runReuse('leak'); // grain matches — the reuse is honored
        // a bind STRING that points at a route dir that was never created (a deleted dir,
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
              STUB_BOUND_ROUTE:
                '.behavior/v2026_01_01.guardian-redteam.grain=leak',
            },
          },
        );
        // then remove the record and re-run — drives the exit-1 malfunction halt in
        // assert_bound_route_matches_request (it cannot read the record to compare).
        rmSync(join(route, '0.scope.md'));
        const unreadableRecord = runReuse('leak');
        return {
          mismatch,
          match,
          absentOnDisk,
          unreadableRecord,
        };
      });

      when('[t0] the request grain differs from the bound route', () => {
        // the r009.b2 fix: apply must NOT silently drive the wrong surface. it belays,
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

      when("[t2] the bound route's scope record cannot be read", () => {
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

      when('[t3] the bind persists but its route dir is gone from disk', () => {
        // is_route_on_disk guards the reuse handoff: a bind STRING can outlive its route
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
        // the vision's PRIMARY invocation shape is `--mode apply` directly (never `init`
        // first). apply builds its own INIT_ARGS at a SEPARATE call site from the init
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
          { env: { PATH: genGuardianStubBinPath({ cwd: dir }) } },
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
    '[case10] a PARTIAL scaffold is caught — init verifies the COMPLETE required set, not merely a non-empty copy',
    () => {
      // the r007.b1 fix: init only fail-fasted on a ZERO-file copy. a partial copy (a bad
      // glob, an unreadable or absent template, a damaged install that drops some-but-not-all
      // files) still copied SOME files, passed the zero-check, printed clean success, bound
      // the route, and handed the operator off to `rhx route.drive` against a route that
      // lacks a stone/guard — a hidden-state hazard that fails the drive partway for an
      // invisible reason. the fix verifies the required set via `get_route_absent_files`.
      const scene = useBeforeAll(async () => {
        const dir = setupHabitat({ slug: 'redteam-partial-scaffold' });
        // a real init lands the COMPLETE required set — the positive control that ties
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
        const outputSh = join(
          __dirname,
          'security.habitat.redteam',
          'output.sh',
        );
        // exercise the detection unit init's halt rests on, directly. before the fix this
        // function is absent, so the command errors and the clamp reddens (teeth).
        const absentOf = (routeDir: string): string =>
          execSync(
            `bash -c 'source "${outputSh}"; get_route_absent_files "${routeDir}"'`,
          )
            .toString()
            .trim();
        // a partial route: the complete set, minus one required guard.
        const partial = join(dir, '.partial-route');
        execSync(
          `bash -c 'mkdir -p "${partial}"; cp "${completeRoute}"/*.stone "${completeRoute}"/*.guard "${partial}/"; rm "${partial}/3.verify.guard"'`,
        );
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
      // route.bind.set per STUB_BIND_RC, so both the stated bind contract AND the
      // exit-1-on-bind-failure guarantee are pinned.
      const scene = useBeforeAll(async () => {
        const okDir = setupHabitat({ slug: 'redteam-init-bind-ok' });
        const failDir = setupHabitat({ slug: 'redteam-init-bind-fail' });
        const bindOk = runGuardianSkill(
          { skill: INIT, args: '--scope . --grain all', cwd: okDir },
          { env: { PATH: genGuardianStubBinPath({ cwd: okDir }) } },
        );
        const bindFail = runGuardianSkill(
          { skill: INIT, args: '--scope . --grain all', cwd: failDir },
          {
            env: {
              PATH: genGuardianStubBinPath({ cwd: failDir }),
              STUB_BIND_RC: '1',
            },
          },
        );
        return { bindOk, bindFail };
      });

      when('[t0] the bind takes', () => {
        then('init exits 0 and reports the route bound to the branch', () => {
          expect(scene.bindOk.exitCode).toBe(0);
          expect(scene.bindOk.stdout).toContain('bound to branch');
          expect(maskRouteDate(scene.bindOk.stdout)).toMatchSnapshot();
        });
      });

      when('[t1] the requested bind does not take', () => {
        then('init halts (exit 1) and names the bind as NOT taken', () => {
          expect(scene.bindFail.exitCode).toBe(1);
          expect(scene.bindFail.stdout).toContain('NOT bound');
          expect(scene.bindFail.stdout).toContain('the bind did not take');
          expect(maskRouteDate(scene.bindFail.stdout)).toMatchSnapshot();
        });
      });
    },
  );

  given(
    '[case12] the promote stone + guard carry the safety phrases the loop rests on (a prose-drift clamp)',
    () => {
      // the promote stone is an agent-driven PROSE stone — no deterministic exec path runs
      // it, so a render-audit is the only floor under a silent prose regression (the same
      // backstop cicd.deflake / declapract.upgrade rely on). a peer review (r10) named three
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
      }));

      when(
        '[t0] the fullsun-safe gate + its deterministic backstop are read',
        () => {
          then(
            'the stone names the fullsun-safe gate and the scanner backstop',
            () => {
              // the dispatch tool is itself an exfil channel; a live claim must never leave.
              // the gate is the judgment; the scanner is the FLOOR under it (necessary, not
              // sufficient) — both must survive, or the exfil irony the wish names re-opens.
              expect(scene.promoteStone).toContain('the fullsun-safe gate');
              expect(scene.promoteStone).toContain(
                'scan_for_live_claim_markers',
              );
              expect(scene.promoteStone).toContain('the scan is a FLOOR');
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
    },
  );

  given(
    '[case13] apply reuse halts loud on a PARTIALLY-deleted bound route (the complete-set check, not merely non-empty)',
    () => {
      // the r007.b1 fix, reuse-branch twin of case10. is_route_on_disk proves the dir + at
      // least one stone survive; it does NOT prove the COMPLETE required set. a bound route
      // that lost one required file after bind (a checkout change, a manual cleanup) passed
      // is_route_on_disk AND the scope-record assert (which reads only 0.scope.md), so apply
      // exited 0 and promised a drive that walks an incomplete route and fails partway for an
      // invisible reason. the fix reuses get_route_absent_files on the reuse path. WITHOUT it
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
        // drop ONE required guard while 0.scope.md + the other stones survive, so the run
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
              PATH: genGuardianStubBinPath({ cwd: dir }),
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
    '[case14] apply scaffolds AND really binds a fresh route (the vision PRIMARY shape — no --skip-route-bind)',
    () => {
      // the r008.b1 gap: the headline contract + day-in-the-life both run `--mode apply`
      // directly, and the normal success path is no-route-bound → scaffold → a REAL bind
      // takes → the re-probe returns the new route → apply reports "scaffolded + bound a
      // fresh route" (exit 0). every OTHER apply case drives --skip-route-bind (case6/8/9/13),
      // so this ROUTE_STATE and the re-probe-after-real-bind logic were never exercised. the
      // stub models real bind persistence via STUB_BIND_STATE_FILE: the FIRST probe (and
      // init's own rebind check) read an absent file = none bound; init's route.bind.set
      // writes the bound path; the re-probe reads it back = bound. teeth: if the re-probe
      // logic regressed to "scaffolded, NOT bound" (or dropped the re-probe), this reddens.
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
              PATH: genGuardianStubBinPath({ cwd: dir }),
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
    '[case15] apply scaffolds but the bind FAILS (init exits non-zero — the halt render)',
    () => {
      // the apply orchestrator halts when init exits non-zero: it surfaces init's own
      // output under a `print_nested_lines` gutter and closes on "halted: fix the cause
      // above" (exit 1). case11 pins init's OWN bind-failure render, but drives init.sh
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
              PATH: genGuardianStubBinPath({ cwd: dir }),
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
              expect(scene.run.stdout).toContain(
                'init did not cleanly scaffold a fresh route',
              );
              expect(scene.run.stdout).toContain(
                'halted: fix the cause above, then re-run',
              );
              expect(maskRouteDate(scene.run.stdout)).toMatchSnapshot();
            },
          );
        },
      );
    },
  );

  given('[case16] two scopes that differ ONLY by their path separator', () => {
    // as_route_scope_token folds a subtree path into a route-slug token. a naive
    // collapse maps every non-alnum/dot run to one dash, so `src/foo` and `src-foo`
    // would alias to the identical token `src-foo` — two different surfaces on one
    // route identity. this clamp forces the two tokens apart: it reddens under the
    // pre-fix collapse and passes under the `/ -> __` distinct-encode.
    const scopeToken = (scope: string): string =>
      execSync(
        `bash -c 'source "${join(
          __dirname,
          'security.habitat.redteam',
          'output.sh',
        )}"; as_route_scope_token "${scope}"'`,
      )
        .toString()
        .trim();

    const scene = useBeforeAll(async () => ({
      slashToken: scopeToken('src/foo'),
      dashToken: scopeToken('src-foo'),
    }));

    when('[t0] both are slugified into route-scope tokens', () => {
      then('the two surfaces yield DISTINCT tokens, never one alias', () => {
        expect(scene.slashToken).not.toEqual(scene.dashToken);
      });

      then('the separator is encoded distinctly (/ -> __)', () => {
        expect(scene.slashToken).toEqual('.scope=src__foo');
        expect(scene.dashToken).toEqual('.scope=src-foo');
      });
    });
  });
});
