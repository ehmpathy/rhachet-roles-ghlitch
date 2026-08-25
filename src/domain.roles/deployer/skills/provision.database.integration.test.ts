import { genTempDir, given, then, useBeforeAll, when } from 'test-fns';

import { spawnSync } from 'node:child_process';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { asEnvHermetic } from '../../.test/runRoleSkill';
import { maskRunnerBanner } from './.test/maskRunnerBanner';

/**
 * .what = connectivity + stdout-forwarding proof for provision.database
 * .why = Gap 2 asks that the schema plan/apply stdout (from sql-schema-control)
 *        reach the caller unmodified, so a workflow can `| tee` + grep it. this
 *        proves it end-to-end against a REAL local testdb: the skill's own
 *        connectivity gate (use.rds.capacity → pg_isready) must pass before the
 *        schema step runs, and a unique sentinel the schema step emits — derived
 *        from a real db query — must appear verbatim in the skill's stdout.
 * .note = requires docker (the testdb) + pg_isready on the host. both are the
 *         same deps the skill itself needs, so this is a fair hermetic proof.
 */

// the local testdb (provision/docker/testdb/docker-compose.yml): postgres 15 at
// localhost:7821, db ghlitch_testdb, user postgres.
const TESTDB = {
  host: 'localhost',
  port: 7821,
  user: 'postgres',
  password: 'a-secure-password',
  database: 'ghlitch_testdb',
} as const;

// repo root, from which the operator's use.testdb skill provisions the docker testdb.
const REPO_ROOT: string = join(__dirname, '../../../..');
const USE_TESTDB = join(
  REPO_ROOT,
  'src/domain.roles/operator/skills/use.testdb.sh',
);

/**
 * .what = ensure the local testdb is up via the operator's use.testdb skill
 * .why = testdb standup (findsert-fast happy path + self-heal on failure) is owned by
 *        use.testdb — the same graceful skill cicd's start:testdb step and local devs
 *        rely on. this test dogfoods that skill rather than a private copy of standup,
 *        so the self-heal logic lives in one place. a non-zero exit means the db could
 *        not be provisioned; throw so the proof never runs against an absent db.
 */
const ensureTestdb = (): void => {
  // the host's shell rc must not load into a run — an rc-defined FUNCTION or ALIAS beats
  // PATH outright (this developer's maps `npm` to `pnpm`), and BASH_ENV is the vector that
  // carries one into a NON-interactive bash (rule.require.hermetic-tests).
  const env = asEnvHermetic();

  const result = spawnSync('bash', ['--noprofile', '--norc', USE_TESTDB], {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
    env,
  });
  if (result.status !== 0)
    throw new Error(
      `use.testdb did not provision the testdb (exit ${result.status})\n${result.stdout ?? ''}${result.stderr ?? ''}`,
    );
};

/**
 * .what = run provision.database.sh from a temp repo against the testdb
 * .why = exercises the real skill end-to-end: connectivity gate + schema run
 * .note = AWS_ACCESS_KEY_ID is DECLARED, so the skill takes the static-credential path
 *         and skips keyrack (no sso prompt). CI is DECLARED absent by the hermetic base,
 *         so this is not the cicd-auth gate — it used to say so while a bare
 *         `...process.env` let a runner's own CI=true through, which would have swung the
 *         gate arm on cicd alone (rule.require.trust-but-verify).
 */
const runProvisionDatabase = (input: {
  args: string;
  cwd: string;
}): { stdout: string; stderr: string; exitCode: number } => {
  const skillPath = `${__dirname}/provision.database.sh`;
  // see ensureTestdb above — the rc must not load into either bash level
  // (rule.require.hermetic-tests).
  const env: Record<string, string | undefined> = {
    ...asEnvHermetic(),
    AWS_ACCESS_KEY_ID: 'test-skip-keyrack',
    AWS_SECRET_ACCESS_KEY: 'test-skip-keyrack',
  };

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
  if (result.status === null) {
    throw new Error(
      `skill did not exit normally: ${result.error?.message ?? 'killed by signal'}`,
    );
  }
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    exitCode: result.status,
  };
};

/**
 * .what = scaffold a temp repo whose getConfig points prep at the local testdb
 *         and whose provision:schema:plan connects to it and prints a unique token
 * .why = the skill reads getConfig for the tunnel target (localhost short-circuits
 *        the ssm tunnel) and runs `npm run provision:schema:plan`; a localhost
 *        target lets the connectivity gate hit the real testdb with no aws access.
 *        the unique token (a per-run value the fake schema command prints AFTER a
 *        live db query) is the proof: it exists nowhere in the skill, so when it
 *        appears in the skill's stdout, the skill forwarded the command's stdout.
 */
const setupRepo = (input: { slug: string; token: string }): string => {
  const dir = genTempDir({
    slug: input.slug,
    git: true,
    symlink: [
      { at: 'node_modules', to: 'node_modules' },
      // provision.database resolves its operator sibling (use.rds.capacity, which
      // opens the tunnel + awaits capacity) via $GIT_ROOT/src/domain.roles/operator/
      // skills. the temp repo IS the git root here, so symlink that dir in or the
      // connectivity step exits 127 (command not found).
      {
        at: 'src/domain.roles/operator/skills',
        to: 'src/domain.roles/operator/skills',
      },
    ],
  });

  // getConfig: prep target = the local testdb (host localhost short-circuits the
  // ssm tunnel, so no bastion/cluster/account is exercised on this path).
  const configDir = join(dir, 'src/utils/config');
  mkdirSync(configDir, { recursive: true });
  writeFileSync(
    join(configDir, 'getConfig.ts'),
    `export const getConfig = async () => ({
  database: {
    tunnel: {
      bastion: { exid: 'unused-on-localhost' },
      cluster: { name: 'unused-on-localhost' },
      local: { host: ${JSON.stringify(TESTDB.host)}, port: ${TESTDB.port} },
    },
  },
  aws: { account: 'unused-on-localhost' },
});
`,
  );

  // the schema step: connect to the real testdb, run a live query, and print BOTH
  // the real sql-schema-control no-op marker AND a unique per-run token. the token
  // exists NOWHERE in provision.database.sh — so its presence in the skill's stdout
  // proves the skill forwarded this command's stdout unmodified.
  const schemaDir = join(dir, 'provision/schema');
  mkdirSync(schemaDir, { recursive: true });

  // one stand-in per MODE. the skill invokes a DIFFERENT npm command for each of plan,
  // apply and sync, so a fixture that carries only `plan` leaves two of the three modes
  // unreachable — and two of the three renders unobserved.
  const genSchemaStandin = (of: { mode: string; withSlug: boolean }): string =>
    `const { Client } = require('pg');
(async () => {
  const client = new Client(${JSON.stringify(TESTDB)});
  await client.connect();
  const { rows } = await client.query("select 'live' as source");
  await client.end();
  // stand in for sql-schema-control's real ${of.mode} output: the no-op marker the
  // workflow greps for, plus a line carrying a live db read + the unique token.
  console.log('Everything is up to date');
  console.log('mode-under-test: ${of.mode}');
${
  of.withSlug
    ? `  // sync forwards --slug through npm's \`--\` passthrough; echo it back so the
  // snapshot proves the value survived BOTH hops rather than trust that it did.
  const at = process.argv.indexOf('--slug');
  console.log('slug-received: ' + (at === -1 ? '(absent)' : process.argv[at + 1]));
`
    : ''
}  console.log('verified-live-db-read: source=' + rows[0].source + ' token=' + ${JSON.stringify(
      input.token,
    )});
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
`;

  writeFileSync(
    join(schemaDir, 'plan.js'),
    genSchemaStandin({ mode: 'plan', withSlug: false }),
  );
  writeFileSync(
    join(schemaDir, 'apply.js'),
    genSchemaStandin({ mode: 'apply', withSlug: false }),
  );
  writeFileSync(
    join(schemaDir, 'sync.js'),
    genSchemaStandin({ mode: 'sync', withSlug: true }),
  );

  // .npmrc — make the fixture hermetic against WHICH package manager `npm run` lands on.
  //
  // the skill runs `npm run provision:schema:plan`. on a host whose shell redirects `npm`
  // to `pnpm` when no package-lock.json is present (a common dotfile), that becomes
  // `pnpm run` — and pnpm's pre-run deps-status check decides this fixture's symlinked
  // node_modules disagrees with its package.json, tries to PURGE it, and needs a tty to
  // confirm. with no tty it aborts:
  //
  //   ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY
  //
  // so the suite passed in CI (which sets CI=true, and pnpm skips the confirm) and failed
  // on a developer's machine — a host dependency the test never declared
  // (rule.require.hermetic-tests, rule.forbid.bare-host-deps).
  //
  // fixed at the cause rather than worked around: the fixture states its own intent, so
  // neither the host's npm-vs-pnpm choice nor the presence of CI can change the outcome.
  // NOT fixed by an env CI=true — this skill READS CI to decide its prod-write gate, so
  // that would silently rewrite the behavior under test (uses._.check.sh:78-85).
  //   verify-deps-before-run  the check itself is wrong here: node_modules is a deliberate
  //                           symlink to the repo root's, never a pnpm-managed install
  //   confirm-modules-purge   belt and braces, and the exact key pnpm's own error names
  // BOTH files, because pnpm moved these settings between majors: <=9 reads the kebab-case
  // keys from .npmrc, 10+ reads the camelCase keys from pnpm-workspace.yaml. corepack picks
  // the pnpm version from whatever `packageManager` it resolves, which for a temp dir under
  // /tmp is its own default — so the fixture cannot know which major it will meet, and
  // states its intent in both dialects rather than pin a version it does not control.
  writeFileSync(
    join(dir, '.npmrc'),
    ['verify-deps-before-run=false', 'confirm-modules-purge=false', ''].join(
      '\n',
    ),
  );
  writeFileSync(
    join(dir, 'pnpm-workspace.yaml'),
    ['verifyDepsBeforeRun: false', 'confirmModulesPurge: false', ''].join('\n'),
  );

  // package.json wires the schema command the skill invokes via npm run. a fixed
  // version keeps npm's run banner deterministic for the snapshot.
  writeFileSync(
    join(dir, 'package.json'),
    `${JSON.stringify(
      {
        name: 'svc-test',
        version: '0.0.0',
        scripts: {
          'provision:schema:plan': 'node provision/schema/plan.js',
          'provision:schema:apply': 'node provision/schema/apply.js',
          'provision:schema:sync': 'node provision/schema/sync.js',
        },
      },
      null,
      2,
    )}\n`,
  );

  return dir;
};

describe('provision.database (connectivity + stdout forwarding)', () => {
  const scene = useBeforeAll(async () => {
    ensureTestdb();
    // a unique per-run token so a stale/hardcoded match can never fake the proof.
    const token = `live-db-token-${Date.now()}`;
    const dir = setupRepo({ slug: 'provision-db-forwarding', token });
    const result = runProvisionDatabase({
      args: '--which livedb --env prep --mode plan',
      cwd: dir,
    });
    // the other two modes, against the same live testdb. each runs a different npm
    // command and prints a different header line, so each is its own render — and
    // neither had ever been observed by a test.
    const resultApply = runProvisionDatabase({
      args: '--which livedb --env prep --mode apply',
      cwd: dir,
    });
    const resultSync = runProvisionDatabase({
      args: '--which livedb --env prep --mode sync --slug 2026-08-10.add-index',
      cwd: dir,
    });
    // mask the non-deterministic bits so the FULL stdout is snapable:
    //   - the temp-dir path (npm prints it in its run banner) → <tmp>
    //   - the per-run token timestamp → <ts>
    //   - npm's run banner appends the package dir on some npm versions (local) but
    //     omits it on others (CI's npm 11) — strip that dir suffix so the banner is
    //     deterministic across npm versions, else the snapshot is npm-version-fragile.
    // all else is deterministic (turtle headers, connectivity, forwarded schema
    // output). mask the realpath first (npm resolves symlinks in the banner).
    const mask = (out: string): string =>
      maskRunnerBanner(
        out
          .split(realpathSync(dir))
          .join('<tmp>')
          .split(dir)
          .join('<tmp>')
          .replace(/live-db-token-\d+/g, 'live-db-token-<ts>'),
      );
    return {
      result,
      resultApply,
      resultSync,
      token,
      dir,
      mask,
      stdoutMasked: mask(result.stdout),
    };
  });

  given('[case1] a prep plan runs against the real testdb', () => {
    when('[t0] provision.database --mode plan is invoked', () => {
      then('it completes (exit 0) — the connectivity gate passed', () => {
        // reaching exit 0 means use.rds.capacity → pg_isready hit the testdb AND
        // the schema step ran; a dead db would have failed the gate before it.
        expect(scene.result.exitCode).toBe(0);
      });

      then('it reached the schema step (connectivity gate cleared)', () => {
        expect(scene.result.stdout).toContain('plan schema changes');
      });
    });

    when('[t1] the schema step emits its stdout', () => {
      then('the sql-schema-control no-op marker is forwarded verbatim', () => {
        // the workflow greps this exact string on ./plan.log to set
        // has-changes-planned — proof the marker survives the skill unmodified.
        expect(scene.result.stdout).toContain('Everything is up to date');
      });

      then('the unique live-db token is forwarded verbatim', () => {
        // the token is printed ONLY by the schema command (after a real db query)
        // and appears nowhere in provision.database.sh — its presence in the
        // skill's stdout proves the skill forwarded the command's stdout.
        expect(scene.result.stdout).toContain(
          `verified-live-db-read: source=live token=${scene.token}`,
        );
      });

      then(
        'the FULL skill stdout matches snapshot (temp path + token masked)',
        () => {
          // snapshot the ENTIRE stdout so the forwarded schema output is visible IN
          // CONTEXT — inside the skill's own turtle header, the real connectivity gate
          // (localhost tunnel short-circuit + `localhost:7821 - accepting connections`),
          // the npm run banner, and the trailing "smooth sailin". only the temp path
          // and per-run token are masked; the forwarded lines are shown verbatim.
          // guard against a failhide: the forwarded content must actually be present.
          expect(scene.stdoutMasked).toContain('Everything is up to date');
          expect(scene.stdoutMasked).toContain(
            'verified-live-db-read: source=live token=live-db-token-<ts>',
          );
          expect(scene.stdoutMasked).toMatchSnapshot();
        },
      );
    });
  });

  given('[case2] the same repo is provisioned with --mode apply', () => {
    // apply is the mode that MUTATES. it had no render clamped anywhere, so the one
    // path that actually changes a database was the least observed of the three.
    when('[t0] provision.database --mode apply is invoked', () => {
      then('it completes (exit 0) and reaches the apply step', () => {
        expect(scene.resultApply.exitCode).toBe(0);
        expect(scene.resultApply.stdout).toContain('apply schema changes');
      });

      then('it ran the APPLY command, never the plan one', () => {
        // the header line and the npm command are chosen by the same `if`, so a mode
        // that printed `apply` while it ran `plan` would look right and do the wrong
        // thing. the stand-in echoes which command actually executed.
        expect(scene.resultApply.stdout).toContain('mode-under-test: apply');
        expect(scene.resultApply.stdout).not.toContain('mode-under-test: plan');
      });

      then(
        'the FULL skill stdout matches snapshot (temp path + token masked)',
        () => {
          const out = scene.mask(scene.resultApply.stdout);
          expect(out).toContain('Everything is up to date');
          expect(out).toMatchSnapshot();
        },
      );
    });
  });

  given('[case3] the same repo is reconciled with --mode sync --slug', () => {
    // sync reconciles the changelog for a change applied out-of-band. it forwards
    // --slug through npm's `--` passthrough — two hops, neither of them clamped.
    when('[t0] provision.database --mode sync is invoked with a slug', () => {
      then('it completes (exit 0) and reaches the sync step', () => {
        expect(scene.resultSync.exitCode).toBe(0);
        expect(scene.resultSync.stdout).toContain(
          'sync changelog for change: 2026-08-10.add-index',
        );
      });

      then('the --slug value survives BOTH hops to the schema command', () => {
        // the skill -> `npm run ... -- --slug X` -> the command's argv. a slug dropped
        // at either hop would reconcile the WRONG change, silently, with an exit 0.
        expect(scene.resultSync.stdout).toContain(
          'slug-received: 2026-08-10.add-index',
        );
      });

      then('it ran the SYNC command, never plan or apply', () => {
        expect(scene.resultSync.stdout).toContain('mode-under-test: sync');
      });

      then(
        'the FULL skill stdout matches snapshot (temp path + token masked)',
        () => {
          expect(scene.mask(scene.resultSync.stdout)).toMatchSnapshot();
        },
      );
    });
  });

  given('[case4] the schema payload is FRAMED in a bucket', () => {
    // this case once asserted the OPPOSITE — that the schema payload must reach column 0
    // verbatim, because "CI pipes it to a log and greps it". that claim was inherited and
    // never checked, and the check found it false on both halves:
    //
    //   - no live caller: the org-wide search for `rhx provision.database` returns docs,
    //     dreams, and this suite — not one workflow invokes the skill
    //   - no PLANNED caller: the consolidation dream in declapract-typescript-ehmpathy
    //     names this exact gap as its blocker 3, and asks for an EXPLICIT signal (a
    //     `--tee <path>`, a stdout marker, or an exit code). the accidental column-0
    //     passthrough is what it wants replaced
    //
    // the old comment even said the bucket "is exactly the change a future reader would
    // make here in good faith" — which turned out to be the right instinct, guarded
    // against by an unverified claim.
    when('[t0] the schema payload reaches the caller', () => {
      then('every payload line sits BEHIND the bucket gutter', () => {
        for (const line of [
          'Everything is up to date',
          'mode-under-test: plan',
        ])
          expect(scene.result.stdout).toContain(`      │  ${line}`);

        // the negative control: and the marker does NOT survive at column 0. without it,
        // a double-render would satisfy the positive above and still be wrong.
        expect(scene.result.stdout).not.toMatch(/^Everything is up to date$/m);
      });

      then('the frame is drawn, and it is NOT empty', () => {
        // an empty frame promises work that never happened. assert open + close exist
        // AND that a content line sits between them.
        expect(scene.result.stdout).toContain('   └─ plan schema changes...');
        expect(scene.result.stdout).toContain('      ├─\n');
        expect(scene.result.stdout).not.toMatch(/ {6}├─\n {6}│\n {6}│\n {6}└─/);
      });

      then('BOTH children are framed, at their own depths', () => {
        // one run, two children, neither exempt: the ghlitch connectivity sub-skill under
        // a `├─` item at `   │  `, and the third-party schema run under the tree's `└─`
        // at `      `. the two depths are what prove two frames, not one merged bucket
        // (rule.require.nest-subskill-output-in-buckets — one per invocation).
        expect(scene.result.stdout).toMatch(
          /^ {3}│ {2}│ {2}🦺 use\.rds\.capacity/m,
        );
        expect(scene.result.stdout).toContain(
          '      │  Everything is up to date',
        );
      });
    });
  });
});
