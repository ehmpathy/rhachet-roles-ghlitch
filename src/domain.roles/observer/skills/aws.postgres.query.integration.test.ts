import { genTempDir, given, then, useBeforeAll, when } from 'test-fns';

import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expectNoStrayLines } from '../../.test/expectNoStrayLines';
import { genStubBinPath, PATH_WITHOUT_RHX } from '../../.test/runRoleSkill';
import { runObserverSkill } from './.test/runObserverSkill';

/**
 * .what = render clamps for every critipath of the `aws.postgres.query` contract
 * .why  = this skill had NO test at all, across BOTH its halves. what the absence hid:
 *           1. `--sql` / `--format` / `--env` each did an unguarded `shift 2`, which bash
 *              refuses when one arg remains — so a flag in last position killed the run
 *              under `set -e` with exit 1 and NOT ONE line printed
 *           2. an unknown flag was silently swallowed and handed on to the typescript
 *              half, which skips any `--` token it does not know — so `--sq 'SELECT 1'`
 *              belayed about an absent `--sql` the caller had in fact supplied
 *           3. an unrecognized `--format` fell through to `table`, so a typo answered in
 *              a shape the caller never asked for
 *           4. the typescript half imported the database module BEFORE it validated its
 *              args, so an absent `--sql` reported the absent module instead
 *           5. its connection-error arm drew `└─` on BOTH of its two items, closing the
 *              tree twice in one block
 *           6. the credential `eval` was unguarded
 *
 * .note = the database is supplied as a REAL module written into the temp repo, at the
 *         exact path the skill's dynamic import reads. that is the skill's own documented
 *         extension point ("allows use in any repo with getDatabaseConnection"), so this
 *         is a fake — a simplified real implementation the real import really loads — and
 *         not a mock (rule.forbid.integration.mocks).
 */

const ARTIFACT = '🔮';

/**
 * .what = a `getDatabaseConnection` that answers with the rows a case wants
 * .why  = each shape drives a different arm of the render: rows drive the three format
 *         branches, an empty set drives `(0 rows)`, and a throw drives the connection-error
 *         belay whose double-`└─` was defect 5.
 */
const genDbModule = (input: {
  answers: 'rows' | 'empty' | 'refused';
}): string =>
  input.answers === 'refused'
    ? [
        'export const getDatabaseConnection = async () => {',
        "  throw new AggregateError([new Error('connect ECONNREFUSED 127.0.0.1:5432')]);",
        '};',
        '',
      ].join('\n')
    : [
        'export const getDatabaseConnection = async () => ({',
        `  query: async () => ({ rows: ${
          input.answers === 'rows'
            ? "[{ uuid: 'a-1', status: 'QUEUED' }, { uuid: 'b-2', status: 'DONE' }]"
            : '[]'
        } }),`,
        '  end: async () => undefined,',
        '});',
        '',
      ].join('\n');

const setupRepo = (input: {
  slug: string;
  db?: 'rows' | 'empty' | 'refused';
}): string => {
  const dir = genTempDir({
    slug: input.slug,
    git: true,
    symlink: [{ at: 'node_modules', to: 'node_modules' }],
  });

  if (input.db) {
    const at = join(dir, 'src/utils/database');
    mkdirSync(at, { recursive: true });
    writeFileSync(
      join(at, 'getDatabaseConnection.ts'),
      genDbModule({ answers: input.db }),
    );
  }

  return dir;
};

const runQuery = (
  input: { args: string; cwd: string },
  options?: { env?: Record<string, string> },
): { stdout: string; stderr: string; exitCode: number } =>
  runObserverSkill(
    { skill: 'aws.postgres.query.sh', args: input.args, cwd: input.cwd },
    { env: { PATH: PATH_WITHOUT_RHX, ...(options?.env ?? {}) } },
  );

/**
 * .what = the env that lets a case reach the typescript half, past the credential read
 * .why  = the stub bin answers `rhx keyrack get` and `aws configure export-credentials`;
 *         `STUB_REAL_NPX` hands the stub npx the genuine one so `npx tsx <the .ts>` runs
 *         for real; and `node` stays on PATH because npx is itself a node program.
 */
const genReachEnv = (input: { cwd: string }): Record<string, string> => ({
  PATH: `${genStubBinPath({ cwd: input.cwd })}:${dirname(
    execSync('which node', { encoding: 'utf-8' }).trim(),
  )}`,
  STUB_REAL_NPX: execSync('which npx', { encoding: 'utf-8' }).trim(),
});

describe('aws.postgres.query (contract renders)', () => {
  given('[case1] help is requested', () => {
    const scene = useBeforeAll(async () => {
      const dir = setupRepo({ slug: 'pg-query-help' });
      return {
        bare: runQuery({ args: 'help', cwd: dir }),
        long: runQuery({ args: '--help', cwd: dir }),
        short: runQuery({ args: '-h', cwd: dir }),
        viaRhx: runQuery({
          args: '--skill aws.postgres.query --repo ghlitch --role observer --help',
          cwd: dir,
        }),
      };
    });

    when('[t0] help is the first token', () => {
      then('the full help stdout matches snapshot (visual vibecheck)', () => {
        expect(scene.bare.exitCode).toEqual(0);
        expect(scene.bare.stdout).toMatchSnapshot();
      });
    });

    when('[t1] help arrives in any of its four shapes', () => {
      then('every shape answers with the SAME text', () => {
        expect(scene.long.stdout).toEqual(scene.bare.stdout);
        expect(scene.short.stdout).toEqual(scene.bare.stdout);
        expect(scene.viaRhx.stdout).toEqual(scene.bare.stdout);
      });

      then('every shape exits 0', () => {
        expect(scene.long.exitCode).toEqual(0);
        expect(scene.short.exitCode).toEqual(0);
        expect(scene.viaRhx.exitCode).toEqual(0);
      });
    });
  });

  given('[case2] argument constraints belay before any work is done', () => {
    const scene = useBeforeAll(async () => {
      const dir = setupRepo({ slug: 'pg-query-args' });
      return {
        noEnv: runQuery({ args: "--sql 'SELECT 1'", cwd: dir }),
        badEnv: runQuery({ args: "--env camp --sql 'SELECT 1'", cwd: dir }),
        badFormat: runQuery({
          args: "--env prep --sql 'SELECT 1' --format yaml",
          cwd: dir,
        }),
        unknown: runQuery({ args: "--sq 'SELECT 1' --env prep", cwd: dir }),
      };
    });

    when('[t0] --env is absent', () => {
      then('it is a constraint (exit 2) and matches snapshot', () => {
        expect(scene.noEnv.exitCode).toEqual(2);
        expect(scene.noEnv.stdout).toMatchSnapshot();
      });
    });

    when('[t1] --env names an env this skill does not serve', () => {
      then('it names the valid set and matches snapshot', () => {
        expect(scene.badEnv.exitCode).toEqual(2);
        expect(scene.badEnv.stdout).toMatchSnapshot();
      });
    });

    when('[t2] --format names a shape this skill cannot render', () => {
      /**
       * the dedicated control for defect 3. the typescript half defaults ANY unknown
       * format to `table`, so a typo used to answer 0 with output in a shape the caller
       * never asked for — a silent wrong answer, which is worse than a loud refusal.
       */
      then('it belays rather than fall back to table', () => {
        expect(scene.badFormat.exitCode).toEqual(2);
        expect(scene.badFormat.stdout).toMatchSnapshot();
      });
    });

    when('[t3] an unknown flag is passed', () => {
      /**
       * the dedicated control for defect 2. the `*)` arm used to shift the token away and
       * hand it on, so the run belayed about an ABSENT `--sql` — a flag the caller had in
       * fact supplied, one character wrong.
       */
      then('the belay names the flag the caller actually mistyped', () => {
        expect(scene.unknown.exitCode).toEqual(2);
        expect(scene.unknown.stdout).toContain('unknown argument: --sq');
        expect(scene.unknown.stdout).not.toContain(
          'absent required arg: --sql',
        );
        expect(scene.unknown.stdout).toMatchSnapshot();
      });
    });
  });

  given('[case3] a flag is passed with no value', () => {
    const scene = useBeforeAll(async () => {
      const dir = setupRepo({ slug: 'pg-query-noval' });
      return {
        env: runQuery({ args: '--env', cwd: dir }),
        sql: runQuery({ args: '--env prep --sql', cwd: dir }),
        format: runQuery({
          args: "--env prep --sql 'SELECT 1' --format",
          cwd: dir,
        }),
      };
    });

    when('[t0] --env is the last token', () => {
      then('it belays with the valid set, never a set -u crash', () => {
        expect(scene.env.exitCode).toEqual(2);
        expect(scene.env.stdout).toMatchSnapshot();
      });
    });

    when('[t1] a free-form flag is the last token', () => {
      /**
       * the dedicated control for defect 1, and the loudest one: `shift 2` with a single
       * arg remaining is an ERROR in bash, so under `set -e` the run died on the spot —
       * exit 1, stdout empty, stderr empty. a human saw a skill that did not one thing.
       */
      then('--sql belays rather than die silently', () => {
        expect(scene.sql.exitCode).toEqual(2);
        expect(scene.sql.stdout).not.toEqual('');
        expect(scene.sql.stdout).toMatchSnapshot();
      });
    });

    when('[t2] a flag with a closed value set is last', () => {
      then('--format names its set and matches snapshot', () => {
        expect(scene.format.exitCode).toEqual(2);
        expect(scene.format.stdout).toMatchSnapshot();
      });
    });
  });

  given('[case4] the credential read finds no profile', () => {
    const scene = useBeforeAll(async () => {
      const dir = setupRepo({ slug: 'pg-query-nocred' });
      return runQuery({ args: "--env prep --sql 'SELECT 1'", cwd: dir });
    });

    when('[t0] the keyrack answers empty', () => {
      then('it is a malfunction (exit 1) and matches snapshot', () => {
        expect(scene.exitCode).toEqual(1);
        expect(scene.stdout).toMatchSnapshot();
      });
    });
  });

  given('[case5] the query is run against a database', () => {
    const scene = useBeforeAll(async () => {
      const rows = setupRepo({ slug: 'pg-query-rows', db: 'rows' });
      const empty = setupRepo({ slug: 'pg-query-empty', db: 'empty' });
      return {
        json: runQuery(
          { args: "--env prep --sql 'SELECT 1' --format json", cwd: rows },
          { env: genReachEnv({ cwd: rows }) },
        ),
        csv: runQuery(
          { args: "--env prep --sql 'SELECT 1' --format csv", cwd: rows },
          { env: genReachEnv({ cwd: rows }) },
        ),
        empty: runQuery(
          { args: "--env prep --sql 'SELECT 1'", cwd: empty },
          { env: genReachEnv({ cwd: empty }) },
        ),
      };
    });

    when('[t0] --format json is asked for', () => {
      then('the FULL stdout matches snapshot (visual vibecheck)', () => {
        expect(scene.json.exitCode).toEqual(0);
        expect(scene.json.stdout).toMatchSnapshot();
      });

      /**
       * the split is the skill's forward contract, and it is a DECLARED one: `--format`
       * is the flag by which a caller asks for machine-readable output, so the data goes
       * to stdout at column 0 and every rendered line goes to stderr. that is why this
       * child is NOT framed in a bucket — the payload exemption applies here, and unlike
       * the four skills that merely claimed it, this one declares the signal
       * (rule.require.nest-subskill-output-in-buckets, `.the exemption`).
       */
      then('the payload is stdout-only, and the render is stderr-only', () => {
        expect(scene.json.stdout).not.toContain('🐈');
        expect(scene.json.stdout).not.toContain('🔮');
        expect(scene.json.stderr).toContain('🐈 smooth sailin!');
      });

      then('the render on stderr is a well-formed tree', () => {
        expect(scene.json.stderr).toMatchSnapshot();
        expectNoStrayLines({ out: scene.json.stderr, artifact: ARTIFACT });
      });
    });

    when('[t1] --format csv is asked for', () => {
      then('the FULL stdout matches snapshot (visual vibecheck)', () => {
        expect(scene.csv.exitCode).toEqual(0);
        expect(scene.csv.stdout).toMatchSnapshot();
      });

      then('the row count is stated in the close', () => {
        expect(scene.csv.stderr).toContain('   └─ rows: 2');
      });
    });

    when('[t2] the query matches no row', () => {
      then('the empty set is spoken, never left as silence', () => {
        expect(scene.empty.exitCode).toEqual(0);
        expect(scene.empty.stdout).toEqual('(0 rows)\n');
        expect(scene.empty.stderr).toContain('   └─ rows: 0');
      });
    });
  });

  given('[case6] the database refuses the connection', () => {
    const scene = useBeforeAll(async () => {
      const dir = setupRepo({ slug: 'pg-query-refused', db: 'refused' });
      return runQuery(
        { args: "--env prep --sql 'SELECT 1'", cwd: dir },
        { env: genReachEnv({ cwd: dir }) },
      );
    });

    when('[t0] the connection is refused', () => {
      then('it is a malfunction (exit 1) and matches snapshot', () => {
        expect(scene.exitCode).toEqual(1);
        expect(scene.stderr).toMatchSnapshot();
      });

      /**
       * the dedicated control for defect 5. both items used to be drawn with `└─`, which
       * closes the tree twice in one block — a snapshot alone shows it, but only a reader
       * who counts glyphs would notice.
       */
      then('the tree draws exactly ONE close', () => {
        const closes = scene.stderr
          .split('\n')
          .filter((line) => /^ {3}└─ /.test(line));
        expect(closes).toEqual(['   └─ hint: rhx use.rds.capacity']);
      });

      then('every line is a mascot, a header, or a tree item', () => {
        expectNoStrayLines({ out: scene.stderr, artifact: ARTIFACT });
      });
    });
  });

  given('[case7] --sql is omitted entirely', () => {
    const scene = useBeforeAll(async () => {
      // no database module in this repo, deliberately: the belay must name the ABSENT
      // ARG, never the absent module (defect 4)
      const dir = setupRepo({ slug: 'pg-query-nosql' });
      return runQuery(
        { args: '--env prep', cwd: dir },
        { env: genReachEnv({ cwd: dir }) },
      );
    });

    when('[t0] the typescript half is reached with no query', () => {
      then('it is a constraint (exit 2) and matches snapshot', () => {
        expect(scene.exitCode).toEqual(2);
        expect(scene.stderr).toMatchSnapshot();
      });

      /**
       * the dedicated control for defect 4. the database import used to run FIRST, so
       * this repo — which holds no such module — answered with an import error and exit
       * 1, sending the caller to fix a module when the real gap was a flag.
       */
      then('the belay names the absent ARG, never the absent module', () => {
        expect(scene.stderr).toContain('absent required arg: --sql');
        expect(scene.stderr).not.toContain('getDatabaseConnection');
      });
    });
  });
});
