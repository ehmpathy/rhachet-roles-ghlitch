import { genTempDir, given, then, useBeforeAll, when } from 'test-fns';

import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

// fixture dir (relative to repo root) symlinked into each temp repo, so the
// skills find .agent/keyrack.yml#org and a package.json name — no adhoc mkdir.
const FIXTURE = 'src/domain.roles/deployer/skills/__test_assets__';

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
const runSkill = (input: {
  skill: string;
  args: string;
  cwd: string;
  asHuman?: boolean;
  env?: Record<string, string>;
}): { stdout: string; stderr: string; exitCode: number } => {
  const skillPath = `${__dirname}/${input.skill}`;

  // HOME=cwd routes ~/.rhachet/... global+org state into the temp repo.
  // __I_AM_HUMAN bypasses the TTY guard for mutations (spawnSync has no TTY).
  // input.env overrides ambient values (e.g. CI) so the cicd-auth path is deterministic
  // regardless of whether the test host itself sets CI.
  const env: Record<string, string> = {
    ...process.env,
    HOME: input.cwd,
    ...(input.env ?? {}),
  };
  if (input.asHuman ?? true) env.__I_AM_HUMAN = 'true';

  const result = spawnSync(
    'bash',
    ['-c', `bash "${skillPath}" ${input.args}`],
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
      const result = runSkill({
        skill: 'deploy.uses.sh',
        args: 'set --quant 1 --env prod',
        cwd: dir,
        asHuman: false,
      });
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
        return {
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
          provisionDb: runSkill({
            skill: 'provision.database.sh',
            args: '--which livedb --env prod --mode apply',
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
      });

      when('[t2] provision.database apply runs against prod', () => {
        then('it is blocked by the gate (exit 2)', () => {
          expect(scene.provisionDb.exitCode).toBe(2);
          expect(scene.provisionDb.stdout + scene.provisionDb.stderr).toContain(
            'provision.uses',
          );
        });
      });

      when('[t3] provision.terraform apply runs against prod', () => {
        then('it is blocked by the gate (exit 2)', () => {
          expect(scene.provisionTf.exitCode).toBe(2);
          expect(scene.provisionTf.stdout + scene.provisionTf.stderr).toContain(
            'provision.uses',
          );
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
      const ttyGuard = runSkill({
        skill: 'provision.uses.sh',
        args: 'set --quant 1 --env prod',
        cwd: dir,
        asHuman: false,
      });
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
    '[case17] --auth as-cicd defers the prod gate to CI (the CI-aware path)',
    () => {
      // the cicd auth is an explicit opt-in: in CI (CI=true) it defers prod-apply
      // authorization to the ambient github-environment approval and skips the local
      // human meter. the guard requires the ambient CI marker so a local shell that
      // passes --auth as-cicd by mistake can never skip the meter.
      const scene = useBeforeAll(async () => {
        const dir = setupRepo({ slug: 'uses-auth-cicd' });
        return {
          // in CI, --auth as-cicd → the gate passes with no local grant (exit 0)
          inCi: runSkill({
            skill: 'uses._.check.sh',
            args: '--meter provision.uses --env prod --auth as-cicd',
            cwd: dir,
            env: { CI: 'true' },
          }),
          // outside CI, --auth as-cicd → belay (exit 2), never a silent bypass
          outsideCi: runSkill({
            skill: 'uses._.check.sh',
            args: '--meter provision.uses --env prod --auth as-cicd',
            cwd: dir,
            env: { CI: '' },
          }),
          // a non-prod env with --auth as-cicd stays ungated regardless of CI (exit 0)
          prepInCi: runSkill({
            skill: 'uses._.check.sh',
            args: '--meter provision.uses --env prep --auth as-cicd',
            cwd: dir,
            env: { CI: 'true' },
          }),
          // an invalid --auth value is a constraint error (exit 2)
          badAuth: runSkill({
            skill: 'uses._.check.sh',
            args: '--meter provision.uses --env prod --auth bogus',
            cwd: dir,
            env: { CI: 'true' },
          }),
        };
      });

      when('[t0] --auth as-cicd is used inside CI (CI=true)', () => {
        then('the gate passes without a local grant (exit 0)', () => {
          expect(scene.inCi.exitCode).toBe(0);
        });

        then('it emits a visible authorization line (never silent)', () => {
          // the defer to the github-environment approval must be visible in the CI
          // log — a silent prod authorization is a surprise. on stderr so a caller
          // capturing stdout to grep schema output stays unpolluted.
          expect(scene.inCi.stderr).toContain(
            'authorized via github-environment approval',
          );
        });

        then('the cicd-auth authorization line matches snapshot', () => {
          expect(scene.inCi.stderr).toMatchSnapshot();
        });
      });

      when('[t1] --auth as-cicd is used outside CI (CI absent)', () => {
        then(
          'it belays (exit 2) — the flag cannot bypass the meter locally',
          () => {
            expect(scene.outsideCi.exitCode).toBe(2);
            expect(scene.outsideCi.stdout + scene.outsideCi.stderr).toContain(
              'CI environment',
            );
          },
        );

        then('the cicd-auth belay output matches snapshot', () => {
          expect(
            scene.outsideCi.stdout + scene.outsideCi.stderr,
          ).toMatchSnapshot();
        });
      });

      when('[t2] --auth as-cicd is used on a non-prod env', () => {
        then('it stays ungated (exit 0) — non-prod is never gated', () => {
          expect(scene.prepInCi.exitCode).toBe(0);
        });

        then(
          'it short-circuits before the auth block (no cicd auth line)',
          () => {
            // non-prod exits at the ungated guard BEFORE the auth block, so the flag
            // never triggers a cicd deferral here — proven by the absence of the
            // authorization line. (silent-by-contract shared path, so nothing to snap.)
            expect(scene.prepInCi.stderr).not.toContain(
              'authorized via github-environment approval',
            );
          },
        );
      });

      when('[t3] an invalid --auth value is passed', () => {
        then('it is a constraint error (exit 2)', () => {
          expect(scene.badAuth.exitCode).toBe(2);
          expect(scene.badAuth.stdout + scene.badAuth.stderr).toContain(
            '--auth',
          );
        });

        then('the invalid-auth error output matches snapshot', () => {
          expect(scene.badAuth.stdout + scene.badAuth.stderr).toMatchSnapshot();
        });
      });
    },
  );

  given(
    '[case18] provision.database --auth as-cicd wires the cicd auth through',
    () => {
      // proves the hookup end-to-end: provision.database passes --auth through to
      // uses.check. with --auth as-cicd + CI=true, a prod apply is NOT blocked by the
      // local meter — it clears the gate and proceeds (later it fails on config, since
      // this temp repo has no getConfig; that later failure is out of scope here). the
      // proof it cleared the gate: the "chartin course" header prints only AFTER it.
      const scene = useBeforeAll(async () => {
        const dir = setupRepo({ slug: 'uses-db-auth-cicd' });
        return {
          applyInCi: runSkill({
            skill: 'provision.database.sh',
            args: '--which livedb --env prod --mode apply --auth as-cicd',
            cwd: dir,
            env: { CI: 'true' },
          }),
          applyOutsideCi: runSkill({
            skill: 'provision.database.sh',
            args: '--which livedb --env prod --mode apply --auth as-cicd',
            cwd: dir,
            env: { CI: '' },
          }),
        };
      });

      when('[t0] prod apply --auth as-cicd runs inside CI', () => {
        then('the local meter does NOT block it (no block hint)', () => {
          // the block hints — never present when the gate defers to CI. (the meter
          // name "provision.uses" DOES appear in the success authorization line, so we
          // assert on the block hints, not the meter name.)
          const out = scene.applyInCi.stdout + scene.applyInCi.stderr;
          expect(out).not.toContain('prod is locked');
          expect(out).not.toContain('set --quant');
        });

        then('it emits the cicd authorization line then proceeds', () => {
          // the auth line (stderr) proves the gate deferred to CI; "chartin course"
          // (stdout, only printed AFTER the gate) proves it proceeded past it.
          expect(scene.applyInCi.stderr).toContain(
            'authorized via github-environment approval',
          );
          expect(scene.applyInCi.stdout).toContain('chartin course');
        });

        then(
          'the gate-cleared stdout head matches snapshot (volatile tail masked)',
          () => {
            // past the gate the skill prints its header + the "lets get some sun..."
            // connectivity branch, then opens the sub.bucket and reaches db connectivity
            // — which fails on this config-less temp repo with volatile temp-dir paths.
            // slice at the sub.bucket open (the 6-space "├─" frame line, distinct from the
            // 3-space header branches) so the snapshot is the deterministic, cleanly
            // terminated head down to the "└─ lets get some sun..." branch. (the stderr
            // auth line is snapshotted by case17 t0 — identical — so it is not re-snapped.)
            const stdoutHead = scene.applyInCi.stdout.split('\n      ├─')[0];
            expect(stdoutHead).toMatchSnapshot();
          },
        );
      });

      when('[t1] prod apply --auth as-cicd runs outside CI', () => {
        then('it belays before the gate (exit 2), never past it', () => {
          expect(scene.applyOutsideCi.exitCode).toBe(2);
          const out = scene.applyOutsideCi.stdout + scene.applyOutsideCi.stderr;
          expect(out).toContain('CI environment');
          expect(out).not.toContain('chartin course');
        });

        then('the passthrough belay output matches snapshot', () => {
          expect(
            scene.applyOutsideCi.stdout + scene.applyOutsideCi.stderr,
          ).toMatchSnapshot();
        });
      });
    },
  );

  given('[case19] provision.database rejects a bad --auth', () => {
    // a bad --auth is a first-class caller mistake — fail fast (exit 2) and snap the
    // belay so reviewers vibecheck it and drift is caught.
    const scene = useBeforeAll(async () => {
      const dir = setupRepo({ slug: 'uses-db-bad-auth' });
      return {
        badAuth: runSkill({
          skill: 'provision.database.sh',
          args: '--which livedb --env prod --mode apply --auth bogus',
          cwd: dir,
        }),
      };
    });

    when('[t0] an invalid --auth value is passed', () => {
      then('it is a constraint error (exit 2) and matches snapshot', () => {
        expect(scene.badAuth.exitCode).toBe(2);
        expect(scene.badAuth.stdout + scene.badAuth.stderr).toContain(
          'invalid auth',
        );
        expect(scene.badAuth.stdout + scene.badAuth.stderr).toMatchSnapshot();
      });
    });
  });

  given('[case20] provision.database help documents --auth', () => {
    // help is a contract surface too — snap it so the --auth option docs are
    // vibecheck-able and drift is caught.
    const scene = useBeforeAll(async () => {
      const dir = setupRepo({ slug: 'uses-db-help' });
      return {
        help: runSkill({
          skill: 'provision.database.sh',
          args: 'help',
          cwd: dir,
        }),
      };
    });

    when('[t0] help is requested', () => {
      then('it documents --auth (exit 0)', () => {
        expect(scene.help.exitCode).toBe(0);
        expect(scene.help.stdout).toContain('--auth');
      });

      then('the help output matches snapshot', () => {
        expect(scene.help.stdout).toMatchSnapshot();
      });
    });
  });
});
