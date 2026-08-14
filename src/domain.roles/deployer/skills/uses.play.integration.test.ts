import { genTempDir, given, then, useBeforeAll, when } from 'test-fns';

import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

// fixture dir (relative to repo root) symlinked into each temp repo, so the
// skills find .agent/keyrack.yml#org and a package.json name — no adhoc mkdir.
const FIXTURE = 'src/domain.roles/deployer/skills/.test/assets';

/**
 * .what = integration tests for the *.uses prod-gate engine
 *         (deploy.uses, provision.uses) and the uses.check gate
 * .why = prove default-block prod, env-keyed grants, quota decrement +
 *        auto-revoke, scope precedence, meter independence, and the TTY
 *        human guard — all against the real shell skills, no mocks
 */

/**
 * .what = run a deployer skill from a temp repo; HOME=cwd isolates global/org
 *         meter state into the temp dir (never the real home)
 * .why = exercises the real src skill end-to-end against isolated state
 * .note = spawnSync (not execSync) so stdout AND stderr are captured on BOTH
 *         success and failure. uses.check emits its status (e.g. the cicd auth line,
 *         the quota-consumed note) on stderr even on exit 0 — execSync would discard
 *         that, so a success-path stderr assertion needs spawnSync.
 */
const runSkill = (
  input: {
    skill: string;
    args: string;
    cwd: string;
  },
  // `options`, not `input` — these tune HOW the run is staged rather than WHAT is run,
  // which is the one place an optional is sanctioned (rule.require.input-options-pattern;
  // rule.forbid.undefined-inputs exempts options, and forbids exactly the `asHuman?` /
  // `env?` shape these once had inside `input`).
  options?: {
    // false to keep the TTY guard live (spawnSync has no TTY, so the guard would block a
    // mutation). defaults to true.
    asHuman?: boolean;
    // env overrides applied over the ambient set — e.g. CI, so the cicd-gate path is
    // deterministic whether or not the test host itself sets it.
    env?: Record<string, string>;
  },
): { stdout: string; stderr: string; exitCode: number } => {
  const skillPath = `${__dirname}/${input.skill}`;

  // HOME=cwd routes ~/.rhachet/... global+org state into the temp repo.
  const env: Record<string, string> = {
    ...process.env,
    HOME: input.cwd,
    ...(options?.env ?? {}),
  };
  if (options?.asHuman ?? true) env.__I_AM_HUMAN = 'true';

  // the host's shell rc must not load into a run — an rc-defined FUNCTION or ALIAS beats
  // PATH outright, and BASH_ENV is the vector that carries one into a NON-interactive
  // bash. both levels are hardened (rule.require.hermetic-tests).
  delete env.BASH_ENV;

  const result = spawnSync(
    'bash',
    [
      '--noprofile',
      '--norc',
      '-c',
      `bash --noprofile --norc "${skillPath}" ${input.args}`,
    ],
    { encoding: 'utf-8', cwd: input.cwd, env },
  );

  // status is the exit code; null only when the process was killed by a signal,
  // which we never expect here — fail loud rather than mask it as a 0/2.
  if (result.status === null) {
    throw new Error(
      `skill ${input.skill} did not exit normally: ${result.error?.message ?? 'killed by signal'}`,
    );
  }

  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    exitCode: result.status,
  };
};

/**
 * .what = create an isolated git repo with an org-configured keyrack
 * .why = the engine reads .agent/keyrack.yml#org for org-scope policy; the
 *        consumer skills read package.json#name. both come from a fixture via
 *        genTempDir symlinks (no adhoc mkdir/writeFile).
 */
const setupRepo = (input: { slug: string }): string =>
  genTempDir({
    slug: input.slug,
    git: true,
    symlink: [
      { at: 'node_modules', to: 'node_modules' },
      { at: '.agent/keyrack.yml', to: `${FIXTURE}/keyrack.yml` },
      { at: 'package.json', to: `${FIXTURE}/package.json` },
      // provision.database reads its operator siblings (_.nest.sh, use.rds.capacity)
      // via $GIT_ROOT/src/domain.roles/operator/skills. the temp repo IS the git root,
      // so symlink that dir in — else the skill dies at the `source _.nest.sh` step
      // right after the gate, before it can proceed (case18 proves it proceeds PAST the
      // gate). skills in other cases (deploy.uses, uses.check) never read it, so this is
      // inert for them.
      {
        at: 'src/domain.roles/operator/skills',
        to: 'src/domain.roles/operator/skills',
      },
    ],
  });

describe('uses (deploy.uses + provision.uses prod gate)', () => {
  given('[case1] no grant — default block', () => {
    const scene = useBeforeAll(async () => {
      const dir = setupRepo({ slug: 'uses-default-block' });
      return {
        get: runSkill({ skill: 'deploy.uses.sh', args: 'get', cwd: dir }),
        prodCheck: runSkill({
          skill: 'uses._.check.sh',
          args: '--meter deploy.uses --env prod',
          cwd: dir,
        }),
        prepCheck: runSkill({
          skill: 'uses._.check.sh',
          args: '--meter deploy.uses --env prep',
          cwd: dir,
        }),
      };
    });

    when('[t0] get is run with no grant', () => {
      then('it exits 0 and reports local unset', () => {
        expect(scene.get.exitCode).toBe(0);
        expect(scene.get.stdout).toContain('local: unset');
      });

      then('the get output matches snapshot', () => {
        expect(scene.get.stdout).toMatchSnapshot();
      });
    });

    when('[t1] the prod gate is checked', () => {
      then('it blocks (exit 2) with a lock message', () => {
        expect(scene.prodCheck.exitCode).toBe(2);
        expect(scene.prodCheck.stdout + scene.prodCheck.stderr).toContain(
          'prod is locked',
        );
      });

      then('the gate-blocked output matches snapshot', () => {
        expect(
          scene.prodCheck.stdout + scene.prodCheck.stderr,
        ).toMatchSnapshot();
      });
    });

    when('[t2] a non-prod env is checked', () => {
      then('it passes ungated (exit 0)', () => {
        expect(scene.prepCheck.exitCode).toBe(0);
      });
    });
  });

  given('[case2] set --quant 1 — one-shot, auto-revoke', () => {
    const scene = useBeforeAll(async () => {
      const dir = setupRepo({ slug: 'uses-quota' });
      const grant = runSkill({
        skill: 'deploy.uses.sh',
        args: 'set --quant 1 --env prod',
        cwd: dir,
      });
      const first = runSkill({
        skill: 'uses._.check.sh',
        args: '--meter deploy.uses --env prod',
        cwd: dir,
      });
      const second = runSkill({
        skill: 'uses._.check.sh',
        args: '--meter deploy.uses --env prod',
        cwd: dir,
      });
      return { grant, first, second };
    });

    when('[t0] a human grants 1 prod use', () => {
      then('the grant succeeds (exit 0)', () => {
        expect(scene.grant.exitCode).toBe(0);
        expect(scene.grant.stdout).toContain('granted: 1');
      });

      then('the set output matches snapshot', () => {
        expect(scene.grant.stdout).toMatchSnapshot();
      });
    });

    when('[t1] the first prod op consumes the grant', () => {
      then('it passes (exit 0)', () => {
        expect(scene.first.exitCode).toBe(0);
      });

      then('it reports the consumption, with the count transition', () => {
        // the quota pass-path emitted no proven output at all before this: [t1] only
        // ever checked exit 0. that left the line a CI log actually shows — WHY a prod
        // write was permitted — unclamped, which is the same "positive path unproven"
        // gap that blocked this suite three times on the prior route.
        expect(scene.first.stderr).toContain(
          '   └─ authorized via quota grant (1 → 0 left, re-locked)',
        );
      });

      then('it reports it as an artifact block, like its kin arms', () => {
        // this arm used to answer with a bare `🐈 deploy.uses: prod use consumed ...`
        // one-liner while every kin authorization path rendered a header plus an item.
        // inside the prod-gate sub.bucket the composers frame this gate with, that
        // meant one bucket held a tree and the next held a sentence.
        expect(scene.first.stderr).toMatch(/^🦺 deploy\.uses --env prod\n/);
        expect(scene.first.stderr).not.toContain('🐈');
      });

      then('the gate emits no seam of its own', () => {
        // the gate never pads its own output: its composers frame the call in a
        // sub.bucket, which supplies the frame and the blank spacers, so a seam here
        // would render as a doubled gutter line inside that frame.
        expect(scene.first.stderr).toMatch(/re-locked\)\n$/);
        expect(scene.first.stderr).not.toMatch(/re-locked\)\n\n$/);
        // and no seam at the TOP either: the header is the first byte, so the frame's
        // own spacer is never doubled
        expect(scene.first.stderr).not.toMatch(/^\n/);
      });

      then('the consumption output matches snapshot', () => {
        expect(scene.first.stderr).toMatchSnapshot();
      });
    });

    when('[t2] a second prod op is attempted', () => {
      then('it is blocked — the grant auto-revoked (exit 2)', () => {
        expect(scene.second.exitCode).toBe(2);
      });
    });
  });

  given('[case3] allow — unlimited grant does not revoke', () => {
    const scene = useBeforeAll(async () => {
      const dir = setupRepo({ slug: 'uses-allow' });
      const grant = runSkill({
        skill: 'deploy.uses.sh',
        args: 'allow --env prod',
        cwd: dir,
      });
      const first = runSkill({
        skill: 'uses._.check.sh',
        args: '--meter deploy.uses --env prod',
        cwd: dir,
      });
      const second = runSkill({
        skill: 'uses._.check.sh',
        args: '--meter deploy.uses --env prod',
        cwd: dir,
      });
      return { grant, first, second };
    });

    when('[t0] a human grants unlimited prod access', () => {
      then('the grant succeeds (exit 0)', () => {
        expect(scene.grant.exitCode).toBe(0);
        expect(scene.grant.stdout).toContain('unlimited');
      });

      then('the allow output matches snapshot', () => {
        expect(scene.grant.stdout).toMatchSnapshot();
      });
    });

    when('[t1] repeated prod ops are attempted', () => {
      then('both pass — no revoke (exit 0)', () => {
        expect(scene.first.exitCode).toBe(0);
        expect(scene.second.exitCode).toBe(0);
      });
    });
  });

  given('[case4] block re-locks after allow', () => {
    const scene = useBeforeAll(async () => {
      const dir = setupRepo({ slug: 'uses-block' });
      runSkill({ skill: 'deploy.uses.sh', args: 'allow --env prod', cwd: dir });
      const blocked = runSkill({
        skill: 'deploy.uses.sh',
        args: 'block --env prod',
        cwd: dir,
      });
      const check = runSkill({
        skill: 'uses._.check.sh',
        args: '--meter deploy.uses --env prod',
        cwd: dir,
      });
      return { blocked, check };
    });

    when('[t0] a human blocks after a prior allow', () => {
      then('block succeeds and prod is locked again (exit 2)', () => {
        expect(scene.blocked.exitCode).toBe(0);
        expect(scene.check.exitCode).toBe(2);
      });

      then('the block output matches snapshot', () => {
        expect(scene.blocked.stdout).toMatchSnapshot();
      });
    });
  });

  given(
    '[case5] meters are independent (provision allowed, deploy not)',
    () => {
      const scene = useBeforeAll(async () => {
        const dir = setupRepo({ slug: 'uses-independence' });
        runSkill({
          skill: 'provision.uses.sh',
          args: 'allow --env prod',
          cwd: dir,
        });
        const provisionCheck = runSkill({
          skill: 'uses._.check.sh',
          args: '--meter provision.uses --env prod',
          cwd: dir,
        });
        const deployCheck = runSkill({
          skill: 'uses._.check.sh',
          args: '--meter deploy.uses --env prod',
          cwd: dir,
        });
        return { provisionCheck, deployCheck };
      });

      when('[t0] only provision.uses is granted for prod', () => {
        then('provision passes (exit 0)', () => {
          expect(scene.provisionCheck.exitCode).toBe(0);
        });

        then('deploy stays blocked (exit 2)', () => {
          expect(scene.deployCheck.exitCode).toBe(2);
        });
      });
    },
  );

  given('[case6] global freeze overrides a local allow', () => {
    const scene = useBeforeAll(async () => {
      const dir = setupRepo({ slug: 'uses-global' });
      runSkill({ skill: 'deploy.uses.sh', args: 'allow --env prod', cwd: dir });
      runSkill({
        skill: 'deploy.uses.sh',
        args: 'block --global',
        cwd: dir,
      });
      const check = runSkill({
        skill: 'uses._.check.sh',
        args: '--meter deploy.uses --env prod',
        cwd: dir,
      });
      return { check };
    });

    when('[t0] global is blocked despite a local allow', () => {
      then('the prod gate blocks (exit 2) with a global message', () => {
        expect(scene.check.exitCode).toBe(2);
        expect(scene.check.stdout + scene.check.stderr).toContain('global');
      });
    });
  });

  given(
    '[case7] org allow does NOT grant prod on its own — local is required',
    () => {
      const scene = useBeforeAll(async () => {
        const dir = setupRepo({ slug: 'uses-org-allow-alone' });
        // org is explicitly allowed (not frozen) but the repo has NO local grant
        runSkill({
          skill: 'deploy.uses.sh',
          args: 'allow --org ehmpathy',
          cwd: dir,
        });
        const check = runSkill({
          skill: 'uses._.check.sh',
          args: '--meter deploy.uses --env prod',
          cwd: dir,
        });
        return { check };
      });

      when('[t0] org is allowed but the repo has no local grant', () => {
        then(
          'the prod gate still BLOCKS (exit 2) — org allow does not grant',
          () => {
            expect(scene.check.exitCode).toBe(2);
          },
        );

        then('it tells the human to grant a local use', () => {
          expect(scene.check.stdout + scene.check.stderr).toContain(
            'set --quant 1 --env prod',
          );
        });
      });
    },
  );

  given(
    '[case7c] org allow + local allow → granted (local is the grant)',
    () => {
      const scene = useBeforeAll(async () => {
        const dir = setupRepo({ slug: 'uses-org-allow-plus-local' });
        runSkill({
          skill: 'deploy.uses.sh',
          args: 'allow --org ehmpathy',
          cwd: dir,
        });
        runSkill({
          skill: 'deploy.uses.sh',
          args: 'allow --env prod',
          cwd: dir,
        });
        const check = runSkill({
          skill: 'uses._.check.sh',
          args: '--meter deploy.uses --env prod',
          cwd: dir,
        });
        return { check };
      });

      when('[t0] org is allowed AND the repo has a local grant', () => {
        then(
          'the prod gate passes (exit 0) — the local grant permits it',
          () => {
            expect(scene.check.exitCode).toBe(0);
          },
        );
      });
    },
  );

  given(
    '[case7d] org allow lifts an @all freeze, but still needs a local grant',
    () => {
      const scene = useBeforeAll(async () => {
        const dir = setupRepo({ slug: 'uses-org-allow-overrides-all' });
        // org-wide freeze for everyone...
        runSkill({
          skill: 'deploy.uses.sh',
          args: 'block --org @all',
          cwd: dir,
        });
        // ...but this specific org's freeze is lifted
        runSkill({
          skill: 'deploy.uses.sh',
          args: 'allow --org ehmpathy',
          cwd: dir,
        });
        // case A: still no local grant
        const checkWithoutLocal = runSkill({
          skill: 'uses._.check.sh',
          args: '--meter deploy.uses --env prod',
          cwd: dir,
        });
        // case B: now add a local grant
        runSkill({
          skill: 'deploy.uses.sh',
          args: 'allow --env prod',
          cwd: dir,
        });
        const checkWithLocal = runSkill({
          skill: 'uses._.check.sh',
          args: '--meter deploy.uses --env prod',
          cwd: dir,
        });
        return { checkWithoutLocal, checkWithLocal };
      });

      when(
        '[t0] the @all freeze is off for this org but no local grant exists',
        () => {
          then(
            'it still BLOCKS (exit 2) — a cleared freeze does not grant',
            () => {
              expect(scene.checkWithoutLocal.exitCode).toBe(2);
            },
          );
        },
      );

      when('[t1] a local grant is then added', () => {
        then(
          'it passes (exit 0) — freeze cleared + local grant present',
          () => {
            expect(scene.checkWithLocal.exitCode).toBe(0);
          },
        );
      });
    },
  );

  given('[case7b] org block is a hard freeze — wins over a local allow', () => {
    const scene = useBeforeAll(async () => {
      const dir = setupRepo({ slug: 'uses-org-freeze' });
      // a repo grants itself a local allow...
      runSkill({ skill: 'deploy.uses.sh', args: 'allow --env prod', cwd: dir });
      // ...but the org sets a freeze (someone other than the actor)
      runSkill({
        skill: 'deploy.uses.sh',
        args: 'block --org @all',
        cwd: dir,
      });
      const check = runSkill({
        skill: 'uses._.check.sh',
        args: '--meter deploy.uses --env prod',
        cwd: dir,
      });
      return { check };
    });

    when('[t0] org freeze is set despite a local allow', () => {
      then('the local allow cannot bypass the org freeze (exit 2)', () => {
        expect(scene.check.exitCode).toBe(2);
      });

      then('the block names the org scope', () => {
        expect(scene.check.stdout + scene.check.stderr).toContain('prod');
      });
    });
  });

  given('[case8] only humans may grant (TTY guard)', () => {
    const scene = useBeforeAll(async () => {
      const dir = setupRepo({ slug: 'uses-tty-guard' });
      const result = runSkill(
        {
          skill: 'deploy.uses.sh',
          args: 'set --quant 1 --env prod',
          cwd: dir,
        },
        { asHuman: false },
      );
      return { result };
    });

    when('[t0] a non-human (no TTY) attempts to grant', () => {
      then('it is refused (exit 2) with a humans-only message', () => {
        expect(scene.result.exitCode).toBe(2);
        expect(scene.result.stdout + scene.result.stderr).toContain(
          'only humans',
        );
      });

      then('the TTY-guard refusal output matches snapshot', () => {
        expect(scene.result.stdout + scene.result.stderr).toMatchSnapshot();
      });
    });
  });

  given('[case9] help is supported', () => {
    const scene = useBeforeAll(async () => {
      const dir = setupRepo({ slug: 'uses-help' });
      return {
        deploy: runSkill({ skill: 'deploy.uses.sh', args: 'help', cwd: dir }),
        provision: runSkill({
          skill: 'provision.uses.sh',
          args: 'help',
          cwd: dir,
        }),
      };
    });

    when('[t0] help is requested', () => {
      then('deploy.uses shows help (exit 0)', () => {
        expect(scene.deploy.exitCode).toBe(0);
        expect(scene.deploy.stdout).toContain('deploy.uses');
      });

      then('deploy.uses help matches snapshot', () => {
        expect(scene.deploy.stdout).toMatchSnapshot();
      });

      then('provision.uses shows help and notes plan stays open', () => {
        expect(scene.provision.exitCode).toBe(0);
        expect(scene.provision.stdout).toContain('plan');
      });

      then('provision.uses help matches snapshot', () => {
        expect(scene.provision.stdout).toMatchSnapshot();
      });
    });
  });

  given(
    '[case10] a corrupt grant file fails loud, never a silent default',
    () => {
      const scene = useBeforeAll(async () => {
        const dir = setupRepo({ slug: 'uses-corrupt' });
        // grant first so the local state file exists, then corrupt its contents
        runSkill({
          skill: 'deploy.uses.sh',
          args: 'allow --env prod',
          cwd: dir,
        });
        writeFileSync(
          join(dir, '.meter', 'deploy.uses.jsonc'),
          '{ this is not json',
        );
        const check = runSkill({
          skill: 'uses._.check.sh',
          args: '--meter deploy.uses --env prod',
          cwd: dir,
        });
        return { check };
      });

      when('[t0] the prod gate reads a corrupt local grant file', () => {
        then(
          'it fails loud (exit 1 malfunction), not a silent allow/block',
          () => {
            expect(scene.check.exitCode).toBe(1);
          },
        );

        then('it names the corruption so a human can fix it', () => {
          expect(scene.check.stdout + scene.check.stderr).toContain('corrupt');
        });

        then('the corrupt-file malfunction output matches snapshot', () => {
          // the message names the bad file by absolute path, which is a volatile
          // temp dir per run; sanitize it to a stable placeholder so the snapshot
          // stays deterministic while it still captures the message format.
          const sanitized = (scene.check.stdout + scene.check.stderr).replace(
            /state file: .*\.meter\//,
            'state file: <repo>/.meter/',
          );
          expect(sanitized).toMatchSnapshot();
        });
      });
    },
  );

  given(
    '[case11] consumer skills honor the gate — blocked prod exits 2',
    () => {
      // proves the hookup: each consumer calls uses.check and propagates its
      // exit via `|| exit $?`. with no grant the gate blocks BEFORE any aws/
      // network work, so this is testable without credentials.
      const scene = useBeforeAll(async () => {
        const dir = setupRepo({ slug: 'uses-consumer-gate' });
        // declastruct takes a --wish, so its header echoes a per-run temp path; mask
        // it (wish before dir, so `<WISH>` wins over `<DIR>/resources.ts`) or the
        // snapshot pins one host's filesystem (rule.require.hermetic-tests).
        const wish = join(dir, 'resources.ts');
        writeFileSync(wish, 'export const resources = [];\n');
        const mask = (out: string): string =>
          out.split(wish).join('<WISH>').split(dir).join('<DIR>');
        return {
          mask,
          deploy: runSkill({
            skill: 'deploy.sh',
            args: '--env prod',
            cwd: dir,
          }),
          provisionDeclastruct: runSkill({
            skill: 'provision.declastruct.sh',
            args: `--wish ${wish} --env prod --mode apply`,
            cwd: dir,
          }),
          rollback: runSkill({
            skill: 'aws.cloudformation.rollback.sh',
            args: '--env prod',
            cwd: dir,
          }),
          provisionDb: runSkill({
            skill: 'provision.database.sh',
            args: '--which livedb --env prod --mode apply',
            cwd: dir,
          }),
          provisionDbSync: runSkill({
            skill: 'provision.database.sh',
            args: '--which livedb --env prod --mode sync --slug 2026_07_20.demo',
            cwd: dir,
          }),
          provisionTf: runSkill({
            skill: 'provision.terraform.sh',
            args: 'apply --env prod',
            cwd: dir,
          }),
        };
      });

      when('[t0] deploy.sh runs against prod with no grant', () => {
        then('it is blocked by the gate (exit 2)', () => {
          expect(scene.deploy.exitCode).toBe(2);
          expect(scene.deploy.stdout + scene.deploy.stderr).toContain(
            'prod is locked',
          );
        });

        then('the gate output matches snapshot', () => {
          expect(scene.deploy.stdout + scene.deploy.stderr).toMatchSnapshot();
        });
      });

      when('[t1] aws.cloudformation.rollback runs against prod', () => {
        then('it is blocked by the gate (exit 2)', () => {
          expect(scene.rollback.exitCode).toBe(2);
          expect(scene.rollback.stdout + scene.rollback.stderr).toContain(
            'prod is locked',
          );
        });

        then('the gate output matches snapshot', () => {
          // this render had NO snapshot while its [t0] and [t2b] siblings did — the
          // same "positive path unproven" asymmetry, one axis over. every composer
          // frames the gate in a bucket, so every composer's frame gets a clamp.
          expect(
            scene.rollback.stdout + scene.rollback.stderr,
          ).toMatchSnapshot();
        });
      });

      when('[t2] provision.database apply runs against prod', () => {
        then('it is blocked by the gate (exit 2)', () => {
          expect(scene.provisionDb.exitCode).toBe(2);
          expect(scene.provisionDb.stdout + scene.provisionDb.stderr).toContain(
            'provision.uses',
          );
        });

        then('the gate output matches snapshot', () => {
          expect(
            scene.provisionDb.stdout + scene.provisionDb.stderr,
          ).toMatchSnapshot();
        });
      });

      when('[t2b] provision.database sync runs against prod', () => {
        then(
          'it is blocked by the gate too (exit 2) — sync writes prod',
          () => {
            expect(scene.provisionDbSync.exitCode).toBe(2);
            expect(
              scene.provisionDbSync.stdout + scene.provisionDbSync.stderr,
            ).toContain('provision.uses');
          },
        );

        then('the gate output matches snapshot', () => {
          expect(
            scene.provisionDbSync.stdout + scene.provisionDbSync.stderr,
          ).toMatchSnapshot();
        });
      });

      when('[t3] provision.terraform apply runs against prod', () => {
        then('it is blocked by the gate (exit 2)', () => {
          expect(scene.provisionTf.exitCode).toBe(2);
          expect(scene.provisionTf.stdout + scene.provisionTf.stderr).toContain(
            'provision.uses',
          );
        });

        then('the gate output matches snapshot', () => {
          // terraform's header splits: `env` and `cmd` render above the gate, `dir`
          // waits on the directory lookup below it. so a blocked run shows the first
          // half of the tree and never reaches a filesystem path — which is also why
          // this snapshot needs no mask.
          expect(
            scene.provisionTf.stdout + scene.provisionTf.stderr,
          ).toMatchSnapshot();
        });
      });

      when('[t4] provision.declastruct apply runs against prod', () => {
        then('it is blocked by the gate (exit 2)', () => {
          expect(scene.provisionDeclastruct.exitCode).toBe(2);
          expect(
            scene.provisionDeclastruct.stdout +
              scene.provisionDeclastruct.stderr,
          ).toContain('provision.uses');
        });

        then('the gate output matches snapshot', () => {
          // the fifth composer, absent from this case entirely until now — so the
          // local-meter block of the one skill this route rewrote had no render
          // clamped anywhere.
          expect(
            scene.mask(
              scene.provisionDeclastruct.stdout +
                scene.provisionDeclastruct.stderr,
            ),
          ).toMatchSnapshot();
        });
      });
    },
  );

  given('[case12] org + global scope command outputs match snapshots', () => {
    const scene = useBeforeAll(async () => {
      const dir = setupRepo({ slug: 'uses-scope-outputs' });
      const orgAllow = runSkill({
        skill: 'deploy.uses.sh',
        args: 'allow --org ehmpathy',
        cwd: dir,
      });
      const orgBlock = runSkill({
        skill: 'deploy.uses.sh',
        args: 'block --org ahbode',
        cwd: dir,
      });
      const globalBlock = runSkill({
        skill: 'deploy.uses.sh',
        args: 'block --global',
        cwd: dir,
      });
      const get = runSkill({ skill: 'deploy.uses.sh', args: 'get', cwd: dir });
      return { orgAllow, orgBlock, globalBlock, get };
    });

    when('[t0] org and global policies are set', () => {
      then('org allow output matches snapshot (never grants prod)', () => {
        expect(scene.orgAllow.exitCode).toBe(0);
        expect(scene.orgAllow.stdout).toMatchSnapshot();
      });

      then('org block output matches snapshot (hard freeze)', () => {
        expect(scene.orgBlock.exitCode).toBe(0);
        expect(scene.orgBlock.stdout).toMatchSnapshot();
      });

      then('global block output matches snapshot', () => {
        expect(scene.globalBlock.exitCode).toBe(0);
        expect(scene.globalBlock.stdout).toMatchSnapshot();
      });

      then('get across all scopes matches snapshot', () => {
        expect(scene.get.exitCode).toBe(0);
        expect(scene.get.stdout).toMatchSnapshot();
      });
    });
  });

  given('[case13] plan stays open against prod — only apply is gated', () => {
    // a first-class vision requirement: `plan` against prod must NOT be gated;
    // only `apply` is. plan paths skip the gate, so with no grant they proceed
    // past it (and later fail on AWS/config). the proof: the gate's block
    // message is ABSENT — the skill never returns the gate's "prod is locked"
    // / "set --quant" hint, so plan was not blocked by the meter.
    const scene = useBeforeAll(async () => {
      const dir = setupRepo({ slug: 'uses-plan-open' });
      return {
        dbPlan: runSkill({
          skill: 'provision.database.sh',
          args: '--which livedb --env prod --mode plan',
          cwd: dir,
        }),
        tfPlan: runSkill({
          skill: 'provision.terraform.sh',
          args: 'plan --env prod',
          cwd: dir,
        }),
      };
    });

    when('[t0] provision.database plan runs against prod with no grant', () => {
      then('the prod gate does NOT block it (no gate hint)', () => {
        const out = scene.dbPlan.stdout + scene.dbPlan.stderr;
        expect(out).not.toContain('prod is locked');
        expect(out).not.toContain('set --quant 1 --env prod');
      });
    });

    when(
      '[t1] provision.terraform plan runs against prod with no grant',
      () => {
        then('the prod gate does NOT block it (no gate hint)', () => {
          const out = scene.tfPlan.stdout + scene.tfPlan.stderr;
          expect(out).not.toContain('prod is locked');
          expect(out).not.toContain('set --quant 1 --env prod');
        });
      },
    );
  });

  given(
    '[case14] constraint-error variants are snapped (negative paths)',
    () => {
      // a human who mistypes the command is a first-class caller experience. snap
      // the "belay that" constraint outputs so reviewers vibecheck them and drift
      // is caught. all are exit 2 (caller must fix).
      const scene = useBeforeAll(async () => {
        const dir = setupRepo({ slug: 'uses-constraint-errors' });
        return {
          absentEnv: runSkill({
            skill: 'deploy.uses.sh',
            args: 'set --quant 1',
            cwd: dir,
          }),
          absentQuant: runSkill({
            skill: 'deploy.uses.sh',
            args: 'set --env prod',
            cwd: dir,
          }),
          badQuant: runSkill({
            skill: 'deploy.uses.sh',
            args: 'set --quant abc --env prod',
            cwd: dir,
          }),
          absentOrg: runSkill({
            skill: 'deploy.uses.sh',
            args: 'allow --org',
            cwd: dir,
          }),
          unknownOpt: runSkill({
            skill: 'deploy.uses.sh',
            args: 'set --bogus x --env prod',
            cwd: dir,
          }),
        };
      });

      when('[t0] set is called without --env', () => {
        then('it is a constraint error (exit 2) and matches snapshot', () => {
          expect(scene.absentEnv.exitCode).toBe(2);
          expect(
            scene.absentEnv.stdout + scene.absentEnv.stderr,
          ).toMatchSnapshot();
        });
      });

      when('[t1] set is called without --quant', () => {
        then('it is a constraint error (exit 2) and matches snapshot', () => {
          expect(scene.absentQuant.exitCode).toBe(2);
          expect(
            scene.absentQuant.stdout + scene.absentQuant.stderr,
          ).toMatchSnapshot();
        });
      });

      when('[t2] set is called with a non-numeric --quant', () => {
        then('it is a constraint error (exit 2) and matches snapshot', () => {
          expect(scene.badQuant.exitCode).toBe(2);
          expect(
            scene.badQuant.stdout + scene.badQuant.stderr,
          ).toMatchSnapshot();
        });
      });

      when('[t3] allow --org is called without an org name', () => {
        then('it is a constraint error (exit 2) and matches snapshot', () => {
          expect(scene.absentOrg.exitCode).toBe(2);
          expect(
            scene.absentOrg.stdout + scene.absentOrg.stderr,
          ).toMatchSnapshot();
        });
      });

      when('[t4] an unknown option is passed', () => {
        then('it is a constraint error (exit 2) and matches snapshot', () => {
          expect(scene.unknownOpt.exitCode).toBe(2);
          expect(
            scene.unknownOpt.stdout + scene.unknownOpt.stderr,
          ).toMatchSnapshot();
        });
      });
    },
  );

  given('[case15] del clears local config — output snapped', () => {
    const scene = useBeforeAll(async () => {
      const dir = setupRepo({ slug: 'uses-del' });
      runSkill({ skill: 'deploy.uses.sh', args: 'allow --env prod', cwd: dir });
      const del = runSkill({
        skill: 'deploy.uses.sh',
        args: 'del --env prod',
        cwd: dir,
      });
      return { del };
    });

    when('[t0] del is run after a local grant', () => {
      then('it succeeds (exit 0) and matches snapshot', () => {
        expect(scene.del.exitCode).toBe(0);
        expect(scene.del.stdout).toMatchSnapshot();
      });
    });
  });

  given('[case16] provision.uses is its own contract — output snapped', () => {
    // provision.uses is a distinct public rhx command (not just deploy's twin).
    // even though it shares the engine, its wrapper wires --meter provision.uses
    // through, and a break there would go uncaught by deploy's snapshots. so snap
    // every output variant of the provision contract too.
    const scene = useBeforeAll(async () => {
      const dir = setupRepo({ slug: 'uses-provision-contract' });
      const getUnset = runSkill({
        skill: 'provision.uses.sh',
        args: 'get',
        cwd: dir,
      });
      const set = runSkill({
        skill: 'provision.uses.sh',
        args: 'set --quant 1 --env prod',
        cwd: dir,
      });
      const allow = runSkill({
        skill: 'provision.uses.sh',
        args: 'allow --env prod',
        cwd: dir,
      });
      const block = runSkill({
        skill: 'provision.uses.sh',
        args: 'block --env prod',
        cwd: dir,
      });
      const del = runSkill({
        skill: 'provision.uses.sh',
        args: 'del --env prod',
        cwd: dir,
      });
      const orgAllow = runSkill({
        skill: 'provision.uses.sh',
        args: 'allow --org ehmpathy',
        cwd: dir,
      });
      const globalBlock = runSkill({
        skill: 'provision.uses.sh',
        args: 'block --global',
        cwd: dir,
      });
      const gateBlocked = runSkill({
        skill: 'uses._.check.sh',
        args: '--meter provision.uses --env prod',
        cwd: dir,
      });
      const absentEnv = runSkill({
        skill: 'provision.uses.sh',
        args: 'set --quant 1',
        cwd: dir,
      });
      const ttyGuard = runSkill(
        {
          skill: 'provision.uses.sh',
          args: 'set --quant 1 --env prod',
          cwd: dir,
        },
        { asHuman: false },
      );
      return {
        getUnset,
        set,
        allow,
        block,
        del,
        orgAllow,
        globalBlock,
        gateBlocked,
        absentEnv,
        ttyGuard,
      };
    });

    when('[t0] provision.uses output variants are exercised', () => {
      then('get (unset) matches snapshot', () => {
        expect(scene.getUnset.exitCode).toBe(0);
        expect(scene.getUnset.stdout).toMatchSnapshot();
      });

      then('set matches snapshot', () => {
        expect(scene.set.exitCode).toBe(0);
        expect(scene.set.stdout).toMatchSnapshot();
      });

      then('allow matches snapshot', () => {
        expect(scene.allow.exitCode).toBe(0);
        expect(scene.allow.stdout).toMatchSnapshot();
      });

      then('block matches snapshot', () => {
        expect(scene.block.exitCode).toBe(0);
        expect(scene.block.stdout).toMatchSnapshot();
      });

      then('del matches snapshot', () => {
        expect(scene.del.exitCode).toBe(0);
        expect(scene.del.stdout).toMatchSnapshot();
      });

      then('org allow matches snapshot (never grants prod)', () => {
        expect(scene.orgAllow.exitCode).toBe(0);
        expect(scene.orgAllow.stdout).toMatchSnapshot();
      });

      then('global block matches snapshot', () => {
        expect(scene.globalBlock.exitCode).toBe(0);
        expect(scene.globalBlock.stdout).toMatchSnapshot();
      });

      then('gate-blocked matches snapshot', () => {
        expect(scene.gateBlocked.exitCode).toBe(2);
        expect(
          scene.gateBlocked.stdout + scene.gateBlocked.stderr,
        ).toMatchSnapshot();
      });

      then('constraint error (absent --env) matches snapshot', () => {
        expect(scene.absentEnv.exitCode).toBe(2);
        expect(
          scene.absentEnv.stdout + scene.absentEnv.stderr,
        ).toMatchSnapshot();
      });

      then('TTY guard refusal matches snapshot', () => {
        expect(scene.ttyGuard.exitCode).toBe(2);
        expect(scene.ttyGuard.stdout + scene.ttyGuard.stderr).toMatchSnapshot();
      });
    });
  });

  given(
    '[case17] --gate for-cicd defers the prod gate to CI (the CI-aware path)',
    () => {
      // the cicd gate is an explicit opt-in: in CI (CI=true) it defers prod-apply
      // authorization to the ambient github-environment approval and skips the local
      // human meter. the guard requires the ambient CI marker so a local shell that
      // passes --gate for-cicd by mistake can never skip the meter.
      //
      // --gate replaced --auth here so this gate skill speaks the SAME word as every
      // consumer skill, and no caller has to translate at the boundary
      // (rule.require.consistent-skill-contracts).
      const scene = useBeforeAll(async () => {
        const dir = setupRepo({ slug: 'uses-gate-cicd' });
        return {
          // in CI, --gate for-cicd → the gate passes with no local grant (exit 0)
          inCi: runSkill(
            {
              skill: 'uses._.check.sh',
              args: '--meter provision.uses --env prod --gate for-cicd',
              cwd: dir,
            },
            { env: { CI: 'true' } },
          ),
          // outside CI, --gate for-cicd → belay (exit 2), never a silent bypass
          outsideCi: runSkill(
            {
              skill: 'uses._.check.sh',
              args: '--meter provision.uses --env prod --gate for-cicd',
              cwd: dir,
            },
            { env: { CI: '' } },
          ),
          // a non-prod env with --gate for-cicd stays ungated regardless of CI (exit 0)
          prepInCi: runSkill(
            {
              skill: 'uses._.check.sh',
              args: '--meter provision.uses --env prep --gate for-cicd',
              cwd: dir,
            },
            { env: { CI: 'true' } },
          ),
          // an invalid --gate value is a constraint error (exit 2)
          badGate: runSkill(
            {
              skill: 'uses._.check.sh',
              args: '--meter provision.uses --env prod --gate bogus',
              cwd: dir,
            },
            { env: { CI: 'true' } },
          ),
          // the retired --auth as-cicd earns its own belay that names the replacement
          retiredAuth: runSkill(
            {
              skill: 'uses._.check.sh',
              args: '--meter provision.uses --env prod --auth as-cicd',
              cwd: dir,
            },
            { env: { CI: 'true' } },
          ),
          // the TRANSPOSED caller: they carried a kin skill's --auth value here. the
          // vision names this as a live cost of the family's split, so the belay must
          // hold for a value that was never this skill's — never just for as-cicd.
          transposedAuth: runSkill(
            {
              skill: 'uses._.check.sh',
              args: '--meter provision.uses --env prod --auth via-ambient',
              cwd: dir,
            },
            { env: { CI: 'true' } },
          ),
          // a TYPO'd gate flag. this is the general class the --auth arm above only
          // covered one instance of: a `*)` catch-all used to swallow it, so the run fell
          // through to the default gate and the caller read "prod is locked" with no clue
          // their flag was dropped — a prod-write authorization decision made by an
          // argument that was silently discarded (rule.forbid.failhide).
          typoGate: runSkill(
            {
              skill: 'uses._.check.sh',
              args: '--meter provision.uses --env prod --grate for-cicd',
              cwd: dir,
            },
            { env: { CI: 'true' } },
          ),
          // a bare --gate: the flag is last, so no value follows it. before the
          // require_val guard this set GATE="" and fell through to the ENUM belay, which
          // named the symptom (`invalid gate: `) and never the cause.
          bareGate: runSkill(
            {
              skill: 'uses._.check.sh',
              args: '--meter provision.uses --env prod --gate',
              cwd: dir,
            },
            { env: { CI: 'true' } },
          ),
          // the subtler shape: --gate EATS the next flag as its value. this one is worse
          // than a bare flag, because the run then belays about a flag the caller DID
          // supply correctly — a wrong-but-specific hint (rule.forbid.surprises).
          gateAteFlag: runSkill(
            {
              skill: 'uses._.check.sh',
              args: '--meter provision.uses --gate --env prod',
              cwd: dir,
            },
            { env: { CI: 'true' } },
          ),
        };
      });

      when('[t0] --gate for-cicd is used inside CI (CI=true)', () => {
        then('the gate passes without a local grant (exit 0)', () => {
          expect(scene.inCi.exitCode).toBe(0);
        });

        then('it emits a visible authorization line (never silent)', () => {
          // the defer to the github-environment approval must be visible in the CI
          // log — a silent prod authorization is a surprise. on stderr so a caller
          // that captures stdout to grep schema output stays unpolluted.
          expect(scene.inCi.stderr).toContain(
            'authorized via github-environment approval',
          );
        });

        then('the cicd-gate authorization line matches snapshot', () => {
          expect(scene.inCi.stderr).toMatchSnapshot();
        });
      });

      when('[t1] --gate for-cicd is used outside CI (CI absent)', () => {
        then(
          'it belays (exit 2) — the flag cannot bypass the meter locally',
          () => {
            expect(scene.outsideCi.exitCode).toBe(2);
            expect(scene.outsideCi.stdout + scene.outsideCi.stderr).toContain(
              'CI environment',
            );
          },
        );

        then('the cicd-gate belay output matches snapshot', () => {
          expect(
            scene.outsideCi.stdout + scene.outsideCi.stderr,
          ).toMatchSnapshot();
        });
      });

      when('[t2] --gate for-cicd is used on a non-prod env', () => {
        then('it stays ungated (exit 0) — non-prod is never gated', () => {
          expect(scene.prepInCi.exitCode).toBe(0);
        });

        then(
          'it short-circuits before the gate block (no cicd gate line)',
          () => {
            // non-prod exits at the ungated guard BEFORE the gate block, so the flag
            // never triggers a cicd deferral here — proven by the absence of the
            // authorization line. (silent-by-contract shared path, so naught to snap.)
            expect(scene.prepInCi.stderr).not.toContain(
              'authorized via github-environment approval',
            );
          },
        );
      });

      when('[t3] an invalid --gate value is passed', () => {
        then('it is a constraint error (exit 2)', () => {
          expect(scene.badGate.exitCode).toBe(2);
          const out = scene.badGate.stdout + scene.badGate.stderr;
          // names the axis AND the valid set, so the caller fixes it in one read. the
          // bare `--gate` this once asserted was weaker — that literal appears in the
          // unknown-flag belay too, so it could not tell the two belays apart.
          expect(out).toContain('invalid gate: bogus');
          expect(out).toContain('for-ehmpath or for-cicd');
        });

        then('the invalid-gate error output matches snapshot', () => {
          expect(scene.badGate.stdout + scene.badGate.stderr).toMatchSnapshot();
        });
      });

      when('[t4] the retired --auth as-cicd is passed', () => {
        then('it belays (exit 2) and names the replacement', () => {
          // a hardcut, never an alias: the retired value must send the caller to the
          // new word in one read, so the belay names --gate for-cicd outright rather
          // than emit a generic "invalid" that leaves them to hunt.
          expect(scene.retiredAuth.exitCode).toBe(2);
          const out = scene.retiredAuth.stdout + scene.retiredAuth.stderr;
          expect(out).toContain('retired');
          expect(out).toContain('--gate for-cicd');
        });

        then('it never silently authorizes the prod write', () => {
          // the sharp edge: a retired flag that fell through to the CI branch would
          // authorize a prod write on a word we no longer honor.
          expect(scene.retiredAuth.stderr).not.toContain(
            'authorized via github-environment approval',
          );
        });

        then('the retired-auth belay output matches snapshot', () => {
          expect(
            scene.retiredAuth.stdout + scene.retiredAuth.stderr,
          ).toMatchSnapshot();
        });
      });

      when('[t5] a TRANSPOSED --auth value from a kin skill is passed', () => {
        then('it belays (exit 2) without a fix for the wrong axis', () => {
          // the sharp edge: an answer of "use --gate for-cicd" would be a WRONG fix here
          // — via-ambient is an identity, and for-cicd is an approval. a wrong fix costs
          // more than a bare rejection (rule.forbid.surprises), so the belay names what
          // is true of the flag and leaves the axes distinct.
          expect(scene.transposedAuth.exitCode).toBe(2);
          const out = scene.transposedAuth.stdout + scene.transposedAuth.stderr;
          expect(out).toContain('retired flag: --auth');
          expect(out).toContain('for-ehmpath|for-cicd');
        });

        then('the transposed-auth belay output matches snapshot', () => {
          expect(
            scene.transposedAuth.stdout + scene.transposedAuth.stderr,
          ).toMatchSnapshot();
        });
      });

      when('[t6] a TYPO\u2019d flag is passed (--grate for --gate)', () => {
        then('it belays (exit 2), never silently discarded', () => {
          // the general class the [t4]/[t5] --auth arms each covered one instance of. a
          // `*)` catch-all used to swallow every unknown flag, which made a typo a
          // SILENT authorization decision: the run fell through to the default gate and
          // the caller read "prod is locked" with no clue their flag was dropped.
          expect(scene.typoGate.exitCode).toBe(2);
          const out = scene.typoGate.stdout + scene.typoGate.stderr;
          expect(out).toContain('unknown flag: --grate');
          expect(out).toContain('--gate');
        });

        then('it never silently authorizes the prod write', () => {
          expect(scene.typoGate.stderr).not.toContain(
            'authorized via github-environment approval',
          );
        });

        then('it never falls through to the default gate instead', () => {
          // the tell that separates a belay from the prior swallow: under the old
          // catch-all this same command reached the local meter and printed the lock
          // message. a run that belays at the flag never gets there.
          expect(scene.typoGate.stdout + scene.typoGate.stderr).not.toContain(
            'prod is locked',
          );
        });

        then('the unknown-flag belay output matches snapshot', () => {
          expect(
            scene.typoGate.stdout + scene.typoGate.stderr,
          ).toMatchSnapshot();
        });
      });

      when('[t7] --gate is passed with NO value (it is the last token)', () => {
        then('it belays about the CAUSE, not the symptom', () => {
          // before the require_val guard this set GATE="" and reached the enum belay,
          // which read `invalid gate: ` — a message whose blank tail is the only clue
          // that no value arrived. the guard names the absent value outright.
          expect(scene.bareGate.exitCode).toBe(2);
          const out = scene.bareGate.stdout + scene.bareGate.stderr;
          expect(out).toContain('absent value for --gate');
          expect(out).toContain('for-ehmpath, for-cicd');
          // the negative control: it must NOT reach the enum belay any more
          expect(out).not.toContain('invalid gate');
        });

        then('it never silently authorizes the prod write', () => {
          expect(scene.bareGate.stderr).not.toContain(
            'authorized via github-environment approval',
          );
        });

        then('the absent-value belay output matches snapshot', () => {
          expect(
            scene.bareGate.stdout + scene.bareGate.stderr,
          ).toMatchSnapshot();
        });
      });

      when('[t8] --gate EATS the next flag as its value', () => {
        then(
          'it belays about --gate, never about the flag it swallowed',
          () => {
            // the sharp edge: `--gate --env prod` would have set GATE="--env" and then
            // belayed that --env was absent — which aims the caller at a flag they supplied
            // correctly. a wrong-but-specific hint costs more than a right-but-general one.
            expect(scene.gateAteFlag.exitCode).toBe(2);
            const out = scene.gateAteFlag.stdout + scene.gateAteFlag.stderr;
            expect(out).toContain('absent value for --gate');
            expect(out).not.toContain('absent required args');
            expect(out).not.toContain('invalid gate');
          },
        );

        then('the swallowed-flag belay output matches snapshot', () => {
          expect(
            scene.gateAteFlag.stdout + scene.gateAteFlag.stderr,
          ).toMatchSnapshot();
        });
      });
    },
  );

  given(
    '[case18] provision.database --gate for-cicd wires the cicd gate through',
    () => {
      // proves the hookup end-to-end: provision.database passes --gate VERBATIM to
      // uses.check — the same word on both sides, so no translation happens at the
      // boundary (rule.require.consistent-skill-contracts). with --gate for-cicd +
      // CI=true, a prod apply is NOT blocked by the local meter — it clears the gate
      // and proceeds (later it fails on config, since this temp repo has no getConfig;
      // that later failure is out of scope here). the proof it cleared the gate: the
      // "chartin course" header prints only AFTER it.
      const scene = useBeforeAll(async () => {
        const dir = setupRepo({ slug: 'uses-db-gate-cicd' });
        return {
          applyInCi: runSkill(
            {
              skill: 'provision.database.sh',
              args: '--which livedb --env prod --mode apply --gate for-cicd',
              cwd: dir,
            },
            { env: { CI: 'true' } },
          ),
          applyOutsideCi: runSkill(
            {
              skill: 'provision.database.sh',
              args: '--which livedb --env prod --mode apply --gate for-cicd',
              cwd: dir,
            },
            { env: { CI: '' } },
          ),
        };
      });

      when('[t0] prod apply --gate for-cicd runs inside CI', () => {
        then('the local meter does NOT block it (no block hint)', () => {
          // the block hints — never present when the gate defers to CI. (the meter
          // name "provision.uses" DOES appear in the success authorization line, so we
          // assert on the block hints, not the meter name.)
          const out = scene.applyInCi.stdout + scene.applyInCi.stderr;
          expect(out).not.toContain('prod is locked');
          expect(out).not.toContain('set --quant');
        });

        then('it emits the cicd authorization line then proceeds', () => {
          // the auth line proves the gate deferred to CI. it arrives on STDOUT, not
          // stderr: the gate is framed by run_sub_bucket, which reads the child as
          // `2>&1` — a gutter cannot interleave two streams and hold their order.
          expect(scene.applyInCi.stdout).toContain(
            'authorized via github-environment approval',
          );
          // and the connectivity item proves it proceeded PAST the gate. `chartin
          // course` can no longer serve as that proof: the header now renders ahead
          // of the gate (so the gate can nest under it), so it shows on a blocked run
          // too. this item is printed only after the gate clears.
          expect(scene.applyInCi.stdout).toContain('lets get some sun...');
        });

        then(
          'the gate-cleared stdout head matches snapshot (volatile tail masked)',
          () => {
            // past the gate the skill prints its header + the "lets get some sun..."
            // connectivity branch, then opens the sub.bucket and reaches db connectivity
            // — which fails on this config-less temp repo with volatile temp-dir paths
            // (tsx internals, stack traces, a per-run temp path).
            //
            // cut just past the connectivity BRANCH LABEL, by its literal text. the child
            // output that follows it is volatile.
            //
            // the marker is the label, NOT a frame shape. it used to be the shape
            // `\n      ├─`, which worked only while the connectivity item was the tree's
            // `└─` close and thus the sole 6-space frame. once the schema run took over as
            // the close, that item became a `├─` and its frame moved to `   │  ` — the
            // same depth the GATE's frame already sits at. a shape marker then cuts at
            // whichever bucket comes first (the gate's), which silently truncates away the
            // one property this case exists to show: that the run proceeded PAST the gate.
            //
            // a literal label cannot collide that way. it is also self-checked below: an
            // absent marker throws rather than snapshot the whole volatile tail
            // (rule.forbid.failhide — a slice that silently no-ops is a failhide).
            const marker = '   ├─ lets get some sun...';
            const at = scene.applyInCi.stdout.indexOf(marker);
            if (at === -1)
              throw new Error(
                `slice marker absent from stdout: ${JSON.stringify(marker)}`,
              );
            const stdoutHead = scene.applyInCi.stdout.slice(
              0,
              at + marker.length,
            );
            expect(stdoutHead).toMatchSnapshot();
          },
        );
      });

      when('[t1] prod apply --gate for-cicd runs outside CI', () => {
        then('it belays at the gate (exit 2), never past it', () => {
          expect(scene.applyOutsideCi.exitCode).toBe(2);
          const out = scene.applyOutsideCi.stdout + scene.applyOutsideCi.stderr;
          expect(out).toContain('CI environment');
          // `chartin course` no longer proves the run stopped: the header renders
          // ahead of the gate now, so it shows on a blocked run too. the connectivity
          // item is the marker that only a CLEARED gate can reach.
          expect(out).not.toContain('lets get some sun...');
        });

        then('the passthrough belay output matches snapshot', () => {
          expect(
            scene.applyOutsideCi.stdout + scene.applyOutsideCi.stderr,
          ).toMatchSnapshot();
        });
      });
    },
  );

  given(
    '[case18b] every composer renders the gate-CLEARED frame the same way',
    () => {
      // the coverage this suite lacked. the gate-cleared render — the one that decides
      // a prod mutation is authorized — was snapped for provision.database ([case18])
      // and provision.declastruct ([case23]) only. deploy, aws.cloudformation.rollback
      // and provision.terraform had NO cleared render clamped anywhere, so their frame
      // could break unseen. one grant, all five, one shape.
      //
      // each composer's tail is volatile past the gate (keyrack, aws, a temp-dir path),
      // so each snapshot is sliced at the bucket close — the last deterministic line,
      // and the exact span this rule governs.
      const sliceThroughGate = (out: string): string => {
        const close = '   │  └─';
        const at = out.indexOf(close);
        return at === -1 ? out : out.slice(0, at + close.length);
      };

      const scene = useBeforeAll(async () => {
        const dir = setupRepo({ slug: 'uses-consumer-gate-cleared' });
        // one unlimited local grant clears the gate for every composer below
        runSkill({
          skill: 'deploy.uses.sh',
          args: 'allow --env prod',
          cwd: dir,
        });
        runSkill({
          skill: 'provision.uses.sh',
          args: 'allow --env prod',
          cwd: dir,
        });
        const wish = join(dir, 'resources.ts');
        writeFileSync(wish, 'export const resources = [];\n');
        const mask = (out: string): string =>
          out.split(wish).join('<WISH>').split(dir).join('<DIR>');
        return {
          mask,
          deploy: runSkill({
            skill: 'deploy.sh',
            args: '--env prod',
            cwd: dir,
          }),
          rollback: runSkill({
            skill: 'aws.cloudformation.rollback.sh',
            args: '--env prod',
            cwd: dir,
          }),
          provisionTf: runSkill({
            skill: 'provision.terraform.sh',
            args: 'apply --env prod',
            cwd: dir,
          }),
          provisionDeclastruct: runSkill({
            skill: 'provision.declastruct.sh',
            args: `--wish ${wish} --env prod --mode apply`,
            cwd: dir,
          }),
          // the fifth composer. its only cleared render was the for-cicd path
          // ([case18]), which authorizes through GITHUB and prints a different line.
          // the local-grant path — the one a human on a laptop takes — was unclamped
          // here, so provision.database was the one composer whose everyday cleared
          // frame no cross-composer assertion ever compared.
          provisionDatabase: runSkill({
            skill: 'provision.database.sh',
            args: '--which livedb --env prod --mode apply',
            cwd: dir,
          }),
        };
      });

      when('[t0] deploy clears the gate', () => {
        then('the cleared frame matches snapshot', () => {
          expect(sliceThroughGate(scene.deploy.stdout)).toMatchSnapshot();
        });
      });

      when('[t1] aws.cloudformation.rollback clears the gate', () => {
        then('the cleared frame matches snapshot', () => {
          expect(sliceThroughGate(scene.rollback.stdout)).toMatchSnapshot();
        });
      });

      when('[t2] provision.terraform clears the gate', () => {
        then('the cleared frame matches snapshot', () => {
          expect(sliceThroughGate(scene.provisionTf.stdout)).toMatchSnapshot();
        });
      });

      when('[t3] provision.declastruct clears the gate', () => {
        then('the cleared frame matches snapshot', () => {
          expect(
            scene.mask(sliceThroughGate(scene.provisionDeclastruct.stdout)),
          ).toMatchSnapshot();
        });
      });

      when('[t3b] provision.database clears the gate', () => {
        then('the cleared frame matches snapshot', () => {
          expect(
            sliceThroughGate(scene.provisionDatabase.stdout),
          ).toMatchSnapshot();
        });
      });

      when('[t4] the five frames are compared to each other', () => {
        then('every composer emits the identical bucket shape', () => {
          // rule.require.consistent-skill-contracts, at the render layer: the item
          // label, the frame, and the gutter must read the same on every composer.
          // a per-skill variant is exactly the dialect that rule forbids.
          // the meter differs by composer — deploy/rollback gate on `deploy.uses`,
          // the provisioners on `provision.uses` — but the FRAME must not.
          for (const { out, meter } of [
            { out: scene.deploy.stdout, meter: 'deploy.uses' },
            { out: scene.rollback.stdout, meter: 'deploy.uses' },
            { out: scene.provisionTf.stdout, meter: 'provision.uses' },
            { out: scene.provisionDeclastruct.stdout, meter: 'provision.uses' },
            { out: scene.provisionDatabase.stdout, meter: 'provision.uses' },
          ]) {
            expect(out).toContain('   ├─ check the gate...');
            expect(out).toContain('   │  ├─');
            expect(out).toContain(`   │  │  🦺 ${meter} --env prod`);
            expect(out).toContain(
              '   │  │     └─ authorized via local unlimited grant',
            );
            expect(out).toContain('   │  └─');
            // the negative control: never at column 0
            expect(out).not.toMatch(/^🦺 /m);
            // and the bucket is never EMPTY — a labeled item that frames no output is
            // the defect these snapshots caught on their first run.
            expect(out).not.toContain('   │  ├─\n   │  │\n   │  │\n   │  └─');
          }
        });
      });
    },
  );

  given('[case19] provision.database rejects a bad --gate', () => {
    // a bad --gate is a first-class caller mistake — fail fast (exit 2) and snap the
    // belay so reviewers vibecheck it and drift is caught. the stakes are higher than a
    // typical enum: a silently-ignored gate value decides whether a prod mutation is
    // authorized at all.
    //
    // the retired --auth rides alongside, because the two belays must stay distinct: a
    // caller who typed the OLD word needs the migration, while a caller who typo'd the
    // NEW word needs the valid set. one generic message would serve neither well.
    const scene = useBeforeAll(async () => {
      const dir = setupRepo({ slug: 'uses-db-bad-gate' });
      return {
        badGate: runSkill({
          skill: 'provision.database.sh',
          args: '--which livedb --env prod --mode apply --gate bogus',
          cwd: dir,
        }),
        retiredAuth: runSkill({
          skill: 'provision.database.sh',
          args: '--which livedb --env prod --mode apply --auth as-cicd',
          cwd: dir,
        }),
        // the TRANSPOSED caller: they carried provision.declastruct's --auth value over.
        // the vision names this as a live cost of the family's split, so the belay is
        // asserted for a value that was never this skill's — never just for as-cicd.
        transposedAuth: runSkill({
          skill: 'provision.database.sh',
          args: '--which livedb --env prod --mode apply --auth via-ambient',
          cwd: dir,
        }),
      };
    });

    when('[t0] an invalid --gate value is passed', () => {
      then('it is a constraint error (exit 2) and matches snapshot', () => {
        expect(scene.badGate.exitCode).toBe(2);
        expect(scene.badGate.stdout + scene.badGate.stderr).toContain(
          'invalid gate',
        );
        expect(scene.badGate.stdout + scene.badGate.stderr).toMatchSnapshot();
      });
    });

    when('[t1] the retired --auth as-cicd is passed', () => {
      then('it belays (exit 2) and names --gate as the replacement', () => {
        expect(scene.retiredAuth.exitCode).toBe(2);
        const out = scene.retiredAuth.stdout + scene.retiredAuth.stderr;
        expect(out).toContain('retired');
        expect(out).toContain('--gate for-cicd');
      });

      then('the retired-auth belay output matches snapshot', () => {
        expect(
          scene.retiredAuth.stdout + scene.retiredAuth.stderr,
        ).toMatchSnapshot();
      });
    });

    when('[t2] a TRANSPOSED --auth value from a kin skill is passed', () => {
      then('it belays (exit 2) without a fix for the wrong axis', () => {
        // the sharp edge: to answer "replace it with --gate for-cicd" here would hand a
        // caller a fix for a DIFFERENT axis — via-ambient names an identity, for-cicd an
        // approval. a wrong fix costs more than a bare rejection, so the belay states
        // what holds of the flag and keeps the axes distinct (rule.forbid.surprises).
        expect(scene.transposedAuth.exitCode).toBe(2);
        const out = scene.transposedAuth.stdout + scene.transposedAuth.stderr;
        expect(out).toContain('retired flag: --auth');
        expect(out).toContain('for-ehmpath|for-cicd');
      });

      then('the transposed-auth belay output matches snapshot', () => {
        expect(
          scene.transposedAuth.stdout + scene.transposedAuth.stderr,
        ).toMatchSnapshot();
      });
    });
  });

  given('[case20] provision.database help documents --gate', () => {
    // help is a contract surface too — snap it so the --gate option docs are
    // vibecheck-able and drift is caught.
    const scene = useBeforeAll(async () => {
      const dir = setupRepo({ slug: 'uses-db-help' });
      return {
        help: runSkill({
          skill: 'provision.database.sh',
          args: 'help',
          cwd: dir,
        }),
        // the SAME help, through the arg order rhachet actually produces. held on the
        // shared scene (not a nested one) precisely so [t1] can compare the two runs —
        // two kin scenes would each shadow `scene` and leave the comparison unable to
        // see both at once.
        helpViaRhxOrder: runSkill({
          skill: 'provision.database.sh',
          args: '--skill provision.database --repo ghlitch --role deployer help',
          cwd: dir,
        }),
      };
    });

    when('[t0] help is requested', () => {
      then('it documents --gate and its values (exit 0)', () => {
        expect(scene.help.exitCode).toBe(0);
        expect(scene.help.stdout).toContain('--gate');
        expect(scene.help.stdout).toContain('for-ehmpath');
        expect(scene.help.stdout).toContain('for-cicd');
      });

      then('the retired --auth is absent from the documented surface', () => {
        // a hardcut retires the word from the DOCS too. help that still listed --auth
        // would teach a new caller the retired word — the alias defect by another route
        // (rule.require.consistent-skill-contracts).
        expect(scene.help.stdout).not.toContain('--auth');
      });

      then('the help output matches snapshot', () => {
        expect(scene.help.stdout).toMatchSnapshot();
      });
    });

    when('[t1] help is requested through the REAL rhx arg order', () => {
      // the gap this closes: `rhx` prepends `--skill/--repo/--role` before a caller's own
      // args, so under a real invocation `$1` is `--skill`, never `help`. [t0] above drives
      // `bash <skill> help` directly, which is the ONE shape where a pre-loop `$1` check
      // could fire — so for as long as the skill carried a duplicate pre-loop help block,
      // [t0] exercised the DEAD copy while the one every real caller reached had zero
      // coverage. that is how a hand-synced pair of help texts survived four review rounds.
      //
      // this case drives the shape a human actually types (rule.require.skill-help,
      // rule.require.clamp-edge-cases).
      then('help still fires, with the same docs (exit 0)', () => {
        expect(scene.helpViaRhxOrder.exitCode).toBe(0);
        expect(scene.helpViaRhxOrder.stdout).toContain('--gate');
        expect(scene.helpViaRhxOrder.stdout).toContain('for-ehmpath');
        expect(scene.helpViaRhxOrder.stdout).toContain('for-cicd');
      });

      then('it is byte-identical to the direct-invocation help', () => {
        // the real point of the case, and it compares TWO DISTINCT runs — [t0]'s direct
        // `bash <skill> help` against this one's rhx-shaped args. two help texts that
        // merely both contain `--gate` could still differ on every other line; only
        // equality proves ONE declaration serves both shapes, so this goes red the moment
        // a second copy is reintroduced and edited.
        expect(scene.helpViaRhxOrder.stdout).toEqual(scene.help.stdout);
      });
    });
  });

  given(
    '[case21] provision.database sync — slug/mode constraint matrix',
    () => {
      // sync's contract makes the illegal states unrepresentable: --slug is
      // required for sync and forbidden elsewhere. these validations happen at the
      // arg boundary, before any db connectivity or the prod gate, so they are
      // testable without credentials. all are exit 2 (caller must fix).
      const scene = useBeforeAll(async () => {
        const dir = setupRepo({ slug: 'provision-db-sync-constraints' });
        return {
          syncNoSlug: runSkill({
            skill: 'provision.database.sh',
            args: '--which livedb --env prep --mode sync',
            cwd: dir,
          }),
          planWithSlug: runSkill({
            skill: 'provision.database.sh',
            args: '--which livedb --env prep --mode plan --slug 2026_07_20.demo',
            cwd: dir,
          }),
          applyWithSlug: runSkill({
            skill: 'provision.database.sh',
            args: '--which livedb --env prep --mode apply --slug 2026_07_20.demo',
            cwd: dir,
          }),
          typoMode: runSkill({
            skill: 'provision.database.sh',
            args: '--which livedb --env prep --mode snyc',
            cwd: dir,
          }),
          syncBareSlug: runSkill({
            skill: 'provision.database.sh',
            args: '--which livedb --env prep --mode sync --slug',
            cwd: dir,
          }),
          syncSlugAteFlag: runSkill({
            skill: 'provision.database.sh',
            args: '--which livedb --env prep --slug --mode sync',
            cwd: dir,
          }),
          help: runSkill({
            skill: 'provision.database.sh',
            args: 'help',
            cwd: dir,
          }),
        };
      });

      when('[t0] sync is called without --slug', () => {
        then('it is a constraint error (exit 2)', () => {
          expect(scene.syncNoSlug.exitCode).toBe(2);
          expect(scene.syncNoSlug.stdout + scene.syncNoSlug.stderr).toContain(
            '--slug',
          );
        });

        then('the constraint output matches snapshot', () => {
          expect(
            scene.syncNoSlug.stdout + scene.syncNoSlug.stderr,
          ).toMatchSnapshot();
        });
      });

      when('[t1] --slug is passed with --mode plan', () => {
        then('it is a constraint error (exit 2) — slug is sync-only', () => {
          expect(scene.planWithSlug.exitCode).toBe(2);
          expect(
            scene.planWithSlug.stdout + scene.planWithSlug.stderr,
          ).toContain('sync');
        });

        then('the constraint output matches snapshot', () => {
          expect(
            scene.planWithSlug.stdout + scene.planWithSlug.stderr,
          ).toMatchSnapshot();
        });
      });

      when('[t2] --slug is passed with --mode apply', () => {
        then('it is a constraint error (exit 2) — slug is sync-only', () => {
          expect(scene.applyWithSlug.exitCode).toBe(2);
          expect(
            scene.applyWithSlug.stdout + scene.applyWithSlug.stderr,
          ).toContain('sync');
        });

        then('the constraint output matches snapshot', () => {
          expect(
            scene.applyWithSlug.stdout + scene.applyWithSlug.stderr,
          ).toMatchSnapshot();
        });
      });

      when('[t4] --mode is mistyped (e.g. snyc)', () => {
        then('it is a constraint error (exit 2) — invalid mode', () => {
          expect(scene.typoMode.exitCode).toBe(2);
          expect(scene.typoMode.stdout + scene.typoMode.stderr).toContain(
            'invalid mode',
          );
        });

        then('the constraint output matches snapshot', () => {
          expect(
            scene.typoMode.stdout + scene.typoMode.stderr,
          ).toMatchSnapshot();
        });
      });

      when('[t5] sync is called with a bare --slug (no value)', () => {
        then('it is a constraint error (exit 2), not a set -u crash', () => {
          // a bare --slug at the end must fail the clean absent-arg check (exit 2),
          // never a raw bash "$2: unbound variable" crash (exit 1).
          expect(scene.syncBareSlug.exitCode).toBe(2);
          expect(
            scene.syncBareSlug.stdout + scene.syncBareSlug.stderr,
          ).toContain('--slug');
        });

        then('the constraint output matches snapshot', () => {
          expect(
            scene.syncBareSlug.stdout + scene.syncBareSlug.stderr,
          ).toMatchSnapshot();
        });
      });

      when('[t6] --slug is followed by a flag instead of a value', () => {
        then('the flag is not eaten as the slug — clean exit 2', () => {
          // `--slug --mode sync` must not capture "--mode" as the slug value and
          // slip past validation into a prod-write with a garbage key. the flag
          // check leaves SLUG empty, so the absent-arg check reports exit 2.
          expect(scene.syncSlugAteFlag.exitCode).toBe(2);
          expect(
            scene.syncSlugAteFlag.stdout + scene.syncSlugAteFlag.stderr,
          ).toContain('--slug');
        });

        then('the constraint output matches snapshot', () => {
          expect(
            scene.syncSlugAteFlag.stdout + scene.syncSlugAteFlag.stderr,
          ).toMatchSnapshot();
        });
      });

      when('[t3] help is requested', () => {
        then('it documents the sync mode and --slug (exit 0)', () => {
          // case20 owns the help snapshot; here we assert the sync/--slug docs
          // are present so a drop in that coverage fails loud.
          expect(scene.help.exitCode).toBe(0);
          expect(scene.help.stdout).toContain('sync');
          expect(scene.help.stdout).toContain('--slug');
        });
      });
    },
  );

  given('[case22] provision.database --gate guards its own value read', () => {
    // the crash path its kin `--slug` already guards. GATE carries a DEFAULT
    // (for-ehmpath), so an absent value cannot be caught by any later absent-arg check —
    // it is indistinguishable from an omitted flag. so it must belay at the READ, which
    // is what this proves. without the guard, a bare last-token `--gate` reads an unbound
    // "$2" and crashes raw under `set -u` instead of a clean exit 2
    // (rule.require.failloud).
    const scene = useBeforeAll(async () => {
      const dir = setupRepo({ slug: 'uses-db-gate-noval' });
      return {
        bareGate: runSkill({
          skill: 'provision.database.sh',
          args: '--which livedb --env prep --mode plan --gate',
          cwd: dir,
        }),
        gateAteFlag: runSkill({
          skill: 'provision.database.sh',
          args: '--which livedb --env prep --gate --mode plan',
          cwd: dir,
        }),
      };
    });

    when('[t0] --gate is the last token, with no value', () => {
      then('it belays cleanly (exit 2), never a raw bash crash', () => {
        expect(scene.bareGate.exitCode).toBe(2);
        const out = scene.bareGate.stdout + scene.bareGate.stderr;
        expect(out).toContain('absent value for --gate');
        // the tell that separates a belay from a crash: our own ghlitch frame is
        // present, and bash's unbound-variable text is absent.
        expect(out).toContain('belay that');
        expect(out).not.toContain('unbound variable');
      });

      then('the belay names the valid set, not just the symptom', () => {
        const out = scene.bareGate.stdout + scene.bareGate.stderr;
        expect(out).toContain('for-ehmpath');
        expect(out).toContain('for-cicd');
      });

      then('the belay output matches snapshot', () => {
        expect(scene.bareGate.stdout + scene.bareGate.stderr).toMatchSnapshot();
      });
    });

    when('[t1] --gate is followed by a flag instead of a value', () => {
      then('the flag is not eaten as the gate value — clean exit 2', () => {
        // `--gate --mode` must not adopt "--mode" as the gate. if it did, the run would
        // reach the enum guard with a garbage gate and, worse, lose the --mode it was
        // actually given. the flag check belays instead.
        expect(scene.gateAteFlag.exitCode).toBe(2);
        const out = scene.gateAteFlag.stdout + scene.gateAteFlag.stderr;
        expect(out).toContain('absent value for --gate');
        expect(out).not.toContain('invalid gate');
      });

      then('the belay output matches snapshot', () => {
        expect(
          scene.gateAteFlag.stdout + scene.gateAteFlag.stderr,
        ).toMatchSnapshot();
      });
    });
  });

  given(
    '[case23] provision.declastruct --gate for-cicd reaches the cicd gate',
    () => {
      // the kin proof to case18, for the skill this route is actually about. case18
      // covers provision.database; for provision.declastruct only the INVALID --gate
      // value was covered, so the valid path — the one that decides whether a prod
      // mutation is authorized at all — went unproven. that asymmetry is the exact class
      // of gap rule.require.consistent-skill-contracts exists to close.
      //
      // fully hermetic: the gate runs BEFORE the credential work and before the
      // plan-file check, so no keyrack unlock and no `npx declastruct` is ever reached.
      // the proof it CLEARED the gate is that the run advances to the next belay in line
      // (`plan not found`) rather than to a gate belay.
      const scene = useBeforeAll(async () => {
        const dir = setupRepo({ slug: 'uses-declastruct-gate-cicd' });
        const wish = join(dir, 'resources.ts');
        writeFileSync(wish, 'export const resources = [];\n');
        const args = `--wish ${wish} --env prod --mode apply --gate for-cicd`;
        // the per-run temp path is the only volatile text in the gate-cleared output;
        // mask it (wish before dir, so `<WISH>` wins over `<DIR>/resources.ts`) so the
        // positive render is snapable. mirrors case18's masked head.
        const mask = (out: string): string =>
          out.split(wish).join('<WISH>').split(dir).join('<DIR>');
        return {
          mask,
          applyInCi: runSkill(
            { skill: 'provision.declastruct.sh', args, cwd: dir },
            { env: { CI: 'true' } },
          ),
          applyOutsideCi: runSkill(
            { skill: 'provision.declastruct.sh', args, cwd: dir },
            { env: { CI: '' } },
          ),
          // the DEFAULT gate on the same prod write: no grant in this temp repo, so the
          // local meter blocks. proves for-cicd does real work rather than merely echo
          // what an omitted flag would have done anyway.
          applyDefaultGate: runSkill(
            {
              skill: 'provision.declastruct.sh',
              args: `--wish ${wish} --env prod --mode apply`,
              cwd: dir,
            },
            { env: { CI: 'true' } },
          ),
        };
      });

      when('[t0] a prod apply --gate for-cicd runs inside CI', () => {
        then('the local meter does NOT block it', () => {
          const out = scene.applyInCi.stdout + scene.applyInCi.stderr;
          expect(out).not.toContain('prod is locked');
          expect(out).not.toContain('set --quant');
        });

        then(
          'it emits the cicd authorization line, on the bucket stream',
          () => {
            // the gate speaks on STDERR when invoked directly ([case17]), but under a
            // composer it is framed by run_sub_bucket, which reads the child as `2>&1` —
            // a gutter cannot interleave two streams and preserve their order. so the
            // line arrives on the COMPOSER's stdout, carried at the bucket gutter.
            expect(scene.applyInCi.stdout).toContain(
              'authorized via github-environment approval',
            );
            // pin the stream itself: were the child ever streamed raw again, this line
            // would revert to stderr and the frame would be gone with it.
            expect(scene.applyInCi.stderr).not.toContain(
              'authorized via github-environment approval',
            );
          },
        );

        then('it advances PAST the gate to the next belay in line', () => {
          // `plan not found` sits immediately after the gate, so its presence is the
          // proof the gate cleared — and it arrives without any keyrack or aws call.
          expect(scene.applyInCi.exitCode).toBe(2);
          expect(scene.applyInCi.stdout).toContain('plan not found');
        });

        then(
          'the gate-CLEARED output matches snapshot (temp paths masked)',
          () => {
            // the positive render. [t1] (the belay) was snapped and this — the path that
            // decides whether a prod mutation is authorized at all — was not, while the
            // kin case this one names in its own header ([case18][t0]) DOES snap its
            // cleared path. that asymmetry is the same class of gap that blocked twice
            // already on this route, and a `toContain` trio cannot show a reviewer the
            // shape a CI operator actually reads.
            //
            // stderr first, because the authorization line is the whole point of the
            // case: a prod write cleared by github's approval rather than the local meter.
            const out = scene.mask(
              `${scene.applyInCi.stderr}${scene.applyInCi.stdout}`,
            );
            expect(out).toContain('authorized via github-environment approval');
            expect(out).toMatchSnapshot();
          },
        );

        then("the gate is framed in the composer's own sub.bucket", () => {
          // rule.require.nest-subskill-output-in-buckets: a composed ghlitch sub-skill
          // whose output reaches the terminal must be framed in the composer's
          // treestruct sub.bucket, under a labeled item — never streamed raw at column
          // 0 beside the composer's own header.
          const out = scene.mask(
            `${scene.applyInCi.stdout}${scene.applyInCi.stderr}`,
          );

          // the labeled branch item that hosts the bucket
          expect(out).toContain('   ├─ check the gate...');
          // the child's own header, carried at the bucket's gutter rather than column 0
          expect(out).toContain('   │  │  🦺 provision.uses --env prod');
          expect(out).toContain(
            '   │  │     └─ authorized via github-environment approval (CI)',
          );
          // the frame closes
          expect(out).toContain('   │  └─');

          // the negative control: the un-bucketed shape this replaces — the gate's
          // header at column 0. this is what reddens if run_sub_bucket is ever dropped.
          expect(out).not.toMatch(/^🦺 provision\.uses/m);
        });
      });

      when('[t1] the same prod apply runs outside CI', () => {
        then('it belays at the gate (exit 2), never past it', () => {
          expect(scene.applyOutsideCi.exitCode).toBe(2);
          const out = scene.applyOutsideCi.stdout + scene.applyOutsideCi.stderr;
          expect(out).toContain('CI environment');
          // it never reached the belay that sits after the gate
          expect(out).not.toContain('plan not found');
        });

        then('the gate belay output matches snapshot', () => {
          // masked, exactly as [t0] masks. the composer now prints its header ahead of
          // the gate (so the gate can nest under it), and that header echoes the wish
          // path — an absolute temp path that differs on every machine. an unmasked
          // snapshot here would pin one host's path as the expected bytes
          // (rule.require.hermetic-tests).
          expect(
            scene.mask(
              scene.applyOutsideCi.stdout + scene.applyOutsideCi.stderr,
            ),
          ).toMatchSnapshot();
        });
      });

      when(
        '[t2] the same prod apply omits --gate (default for-ehmpath)',
        () => {
          then('the local meter blocks it — the default is a real gate', () => {
            expect(scene.applyDefaultGate.exitCode).toBe(2);
            const out =
              scene.applyDefaultGate.stdout + scene.applyDefaultGate.stderr;
            expect(out).toContain('prod is locked');
            expect(out).not.toContain('plan not found');
          });
        },
      );
    },
  );

  given(
    '[case24] provision.database guards --which/--env/--mode value reads',
    () => {
      // case22 proved the guard for --gate. these three flags route through the SAME
      // require_val helper, and each carried only an absent-value check before this
      // route — so a flag handed in place of a value was adopted whole, and the run
      // belayed about the EATEN flag rather than the one at fault. `--which --env prep`
      // set WHICH='--env' and then reported `--env` absent: a wrong-but-specific hint,
      // which costs more than a right-but-general one (rule.forbid.surprises).
      //
      // covered here rather than left to --gate alone because the helper is shared: a
      // regression in it would surface on whichever flag a caller happened to fumble,
      // and only --gate would have caught it.
      const scene = useBeforeAll(async () => {
        const dir = setupRepo({ slug: 'uses-db-flag-eat' });
        return {
          whichAteEnv: runSkill({
            skill: 'provision.database.sh',
            args: '--which --env prep --mode plan',
            cwd: dir,
          }),
          envAteMode: runSkill({
            skill: 'provision.database.sh',
            args: '--which livedb --env --mode plan',
            cwd: dir,
          }),
          bareMode: runSkill({
            skill: 'provision.database.sh',
            args: '--which livedb --env prep --mode',
            cwd: dir,
          }),
        };
      });

      when('[t0] --which is handed --env instead of a value', () => {
        then('it belays and names --which, NOT the eaten --env', () => {
          expect(scene.whichAteEnv.exitCode).toBe(2);
          const out = scene.whichAteEnv.stdout + scene.whichAteEnv.stderr;
          expect(out).toContain('absent value for --which');
          // the control that gives the assert above its teeth: before the guard, this
          // very run reported `unknown option: prep` — the eaten flag's own value.
          expect(out).not.toContain('unknown option: prep');
          expect(out).not.toContain('absent required arg: --env');
        });

        then('the belay output matches snapshot', () => {
          expect(
            scene.whichAteEnv.stdout + scene.whichAteEnv.stderr,
          ).toMatchSnapshot();
        });
      });

      when('[t1] --env is handed --mode instead of a value', () => {
        then('it belays and names --env, NOT the eaten --mode', () => {
          expect(scene.envAteMode.exitCode).toBe(2);
          const out = scene.envAteMode.stdout + scene.envAteMode.stderr;
          expect(out).toContain('absent value for --env');
          expect(out).not.toContain('invalid env');
          expect(out).not.toContain('absent required arg: --mode');
        });

        then('the belay output matches snapshot', () => {
          expect(
            scene.envAteMode.stdout + scene.envAteMode.stderr,
          ).toMatchSnapshot();
        });
      });

      when('[t2] --mode is the last token, with no value', () => {
        then('it belays cleanly (exit 2), never a raw bash crash', () => {
          expect(scene.bareMode.exitCode).toBe(2);
          const out = scene.bareMode.stdout + scene.bareMode.stderr;
          expect(out).toContain('absent value for --mode');
          expect(out).toContain('belay that');
          expect(out).not.toContain('unbound variable');
        });

        then('the belay output matches snapshot', () => {
          expect(
            scene.bareMode.stdout + scene.bareMode.stderr,
          ).toMatchSnapshot();
        });
      });
    },
  );
});
