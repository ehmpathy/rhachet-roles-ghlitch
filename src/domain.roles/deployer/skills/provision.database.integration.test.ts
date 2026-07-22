import { genTempDir, given, then, useBeforeAll, when } from 'test-fns';

import { spawnSync } from 'node:child_process';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

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
  const result = spawnSync('bash', [USE_TESTDB], {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
  });
  if (result.status !== 0)
    throw new Error(
      `use.testdb did not provision the testdb (exit ${result.status})\n${result.stdout ?? ''}${result.stderr ?? ''}`,
    );
};

/**
 * .what = run provision.database.sh from a temp repo against the testdb
 * .why = exercises the real skill end-to-end: connectivity gate + schema run
 * .note = AWS_ACCESS_KEY_ID is set so the skill takes the CI/OIDC path and skips
 *         keyrack (no sso prompt); CI is unset so this is not the cicd-auth gate.
 */
const runProvisionDatabase = (input: {
  args: string;
  cwd: string;
}): { stdout: string; stderr: string; exitCode: number } => {
  const skillPath = `${__dirname}/provision.database.sh`;
  const env: Record<string, string> = {
    ...process.env,
    AWS_ACCESS_KEY_ID: 'test-skip-keyrack',
    AWS_SECRET_ACCESS_KEY: 'test-skip-keyrack',
  };
  const result = spawnSync(
    'bash',
    ['-c', `bash "${skillPath}" ${input.args}`],
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
  writeFileSync(
    join(schemaDir, 'plan.js'),
    `const { Client } = require('pg');
(async () => {
  const client = new Client(${JSON.stringify(TESTDB)});
  await client.connect();
  const { rows } = await client.query("select 'live' as source");
  await client.end();
  // stand in for sql-schema-control's real plan output: the no-op marker the
  // workflow greps for, plus a line carrying a live db read + the unique token.
  console.log('Everything is up to date');
  console.log('verified-live-db-read: source=' + rows[0].source + ' token=' + ${JSON.stringify(
    input.token,
  )});
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
`,
  );

  // package.json wires the schema command the skill invokes via npm run. a fixed
  // version keeps npm's run banner deterministic for the snapshot.
  writeFileSync(
    join(dir, 'package.json'),
    `${JSON.stringify(
      {
        name: 'svc-test',
        version: '0.0.0',
        scripts: { 'provision:schema:plan': 'node provision/schema/plan.js' },
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
    // mask the two genuinely non-deterministic bits so the FULL stdout is snapable:
    //   - the temp-dir path (npm prints it in its run banner) → <tmp>
    //   - the per-run token timestamp → <ts>
    // everything else is deterministic (turtle headers, connectivity, forwarded
    // schema output). mask the realpath first (npm resolves symlinks in the banner).
    const stdoutMasked = result.stdout
      .split(realpathSync(dir))
      .join('<tmp>')
      .split(dir)
      .join('<tmp>')
      .replace(/live-db-token-\d+/g, 'live-db-token-<ts>');
    return { result, token, dir, stdoutMasked };
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
});
