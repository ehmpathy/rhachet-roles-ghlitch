import { genTempDir, given, then, when } from 'test-fns';

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  ENV_VARS_HOST_SHAPED,
  PATH_WITHOUT_RHX,
  runRoleSkill,
} from './.test/runRoleSkill';

/**
 * .what = a repo-wide audit that every bash invocation in a test is hermetic
 *
 * .why  = a skill suite runs a real shell, so the host's shell rc can reach into it. an
 *         rc-defined FUNCTION or ALIAS beats PATH outright, which means a stub placed
 *         first on PATH still loses to one — PATH alone cannot close that door. this is
 *         not hypothetical here: a `.bash_aliases` that maps `npm` to `pnpm` once routed
 *         straight past a stub and died `127: pnpm: command not found`, and on a runner
 *         with no such rc the same case passed (rule.require.hermetic-tests).
 *
 * .why an AUDIT = the guard drifted exactly the way a per-file convention always drifts.
 *         the shared harness carried it, two bespoke runners carried it, and eight did
 *         not — and no test reddened, because the host that ran them happened to define
 *         none of the shadowed names. a partial matrix is invisible until the host
 *         changes. so grade the CLASS, not the instances, and let a suite added later
 *         enroll itself (the sweep-by-artifact discipline: enumerate the class, then
 *         subtract the exempt).
 *
 * .why here = it sits at the role root because it grades a contract every role's suite
 *         shares (rule.prefer.most-common-denominator).
 */

const repoRoot: string = join(__dirname, '..', '..');

/**
 * .what = one bash invocation found in a test file
 */
interface BashInvocation {
  file: string;
  text: string;
}

/**
 * .what = every `*.test.ts` under `src/`
 *
 * .why  = the audit must reach a suite its author never registered anywhere, so it walks
 *         the tree rather than read a list. a list is the allowlist failure this audit
 *         exists to prevent.
 */
const getAllTestFilesUnder = (input: { dir: string }): string[] =>
  readdirSync(input.dir, { withFileTypes: true }).flatMap((entry) => {
    const at = join(input.dir, entry.name);
    if (entry.isDirectory()) return getAllTestFilesUnder({ dir: at });
    return entry.name.endsWith('.test.ts') ? [at] : [];
  });

/**
 * .what = every `*.sh` skill under a directory
 *
 * .why  = the scrub list is checked AGAINST the skills, so the set of skills must be
 *         enumerated rather than listed. a list would go stale the moment a skill is
 *         added, which is the same allowlist failure the test-file walk above avoids.
 */
const getAllSkillFilesUnder = (input: { dir: string }): string[] =>
  readdirSync(input.dir, { withFileTypes: true }).flatMap((entry) => {
    const at = join(input.dir, entry.name);
    if (entry.isDirectory()) return getAllSkillFilesUnder({ dir: at });
    return entry.name.endsWith('.sh') ? [at] : [];
  });

/**
 * .what = the file's code, with comments dropped and whitespace flattened
 *
 * .why  = TWO defects in the first cut of this grader, both found the first time it ran.
 *
 *         it graded LINES, but an invocation spans them: `spawnSync(\n 'bash',\n
 *         ['--noprofile', ...]` puts the command token and its flags on different lines,
 *         so a correctly-hardened array-form call read as bare. flatten first, and the
 *         flags sit next to the token they belong to whichever way the call is written.
 *
 *         and it graded COMMENTS, so a prose mention of `bash <skill> help` counted as an
 *         invocation. drop them, or the audit reports offenders that do not exist —
 *         noise that trains a reader to skim its output.
 */
const asCodeFlattened = (input: { file: string }): string =>
  readFileSync(input.file, 'utf-8')
    .split('\n')
    .filter((line) => {
      const bare = line.trim();
      return !bare.startsWith('//') && !bare.startsWith('*');
    })
    .join(' ')
    .replace(/\s+/g, ' ');

/**
 * .what = every bash process a test starts
 *
 * .why  = it matches the WORD `bash` as a command token — the quote or backtick in front
 *         of it is what separates an invocation from an incidental mention. each match is
 *         then judged on the text that FOLLOWS it, because that is where the flags land in
 *         both shapes this repo uses: `'bash', ['--noprofile', ...]` and
 *         `` `bash --noprofile --norc "$skill"` ``.
 */
const getAllBashInvocations = (input: { file: string }): BashInvocation[] => {
  const code = asCodeFlattened({ file: input.file });
  const found: BashInvocation[] = [];
  for (const match of code.matchAll(/(['"`])bash(\1| )/g)) {
    const at = match.index ?? 0;
    // 60 chars is comfortably past `', ['--noprofile', '--norc',` in the array shape and
    // past `bash --noprofile` in the template shape, while staying short enough that it
    // cannot reach the NEXT invocation and borrow its flags.
    found.push({
      file: relative(repoRoot, input.file),
      text: code.slice(at, at + 60),
    });
  }
  return found;
};

describe('hermetic contract (every test that runs bash)', () => {
  const files = getAllTestFilesUnder({ dir: join(repoRoot, 'src') });
  const invocations = files.flatMap((file) => getAllBashInvocations({ file }));

  // the files that actually start a bash process, as opposed to every test file
  const runners = [...new Set(invocations.map((at) => at.file))].sort();

  given('[case1] the audit has a corpus to grade', () => {
    // a glob that matches zero files makes every assertion below pass vacuously, and the
    // green reads as proof of absence (rule.forbid.failhide). clamp the corpus first.
    when('[t0] the tree is walked', () => {
      then('it finds test files', () => {
        expect(files.length).toBeGreaterThan(20);
      });

      then('it finds bash invocations to grade', () => {
        expect(invocations.length).toBeGreaterThan(10);
      });

      then('it finds the runners across every role', () => {
        expect(runners.some((at) => at.includes('/deployer/'))).toEqual(true);
        expect(runners.some((at) => at.includes('/observer/'))).toEqual(true);
        expect(runners.some((at) => at.includes('/operator/'))).toEqual(true);
      });
    });
  });

  given('[case2] a bash process is started from a test', () => {
    when('[t0] every invocation is graded', () => {
      then('not one starts bash without --noprofile --norc', () => {
        // the flags close the rc vectors on the level they are passed to. a `bash -c`
        // that wraps an inner `bash <skill>` has TWO levels, and both are separate
        // invocations by this grader — so both must carry them.
        const bare = invocations.filter(
          (at) => !at.text.includes('--noprofile'),
        );
        expect(bare.map((at) => `${at.file} — ${at.text}`)).toEqual([]);
      });
    });
  });

  given('[case4] the HOST itself holds credentials, as a runner does', () => {
    // the third vector, and the one the flags above cannot close. PATH and the rc are
    // shut, yet ten skills still fork on `[[ -z "${AWS_ACCESS_KEY_ID:-}" ]]` and the prod
    // gate forks on `[[ "${CI:-}" != "true" ]]`. an sso laptop sets neither and a runner
    // sets both, so a render recorded on one host pinned an arm the other never takes.
    //
    // this is graded by RUN rather than by read, because the defect was never visible in
    // the harness source — every assertion in cases 1-3 passed while eight suites failed
    // on the runner.
    const skill = join(
      __dirname,
      'observer',
      'skills',
      'aws.ssm.param.check.sh',
    );

    /**
     * .what = run one skill with a set of variables forced into the AMBIENT environment
     * .why  = `options.env` cannot reproduce the defect: it lands AFTER the scrub, so it
     *         models a case that DECLARES a credential, never a host that happens to hold
     *         one. only a mutation of `process.env` stands in for the runner.
     */
    const runWithAmbient = (input: {
      ambient: Record<string, string>;
    }): string => {
      const restore = new Map<string, string | undefined>();
      for (const [name, value] of Object.entries(input.ambient)) {
        restore.set(name, process.env[name]);
        process.env[name] = value;
      }
      try {
        return runRoleSkill(
          {
            skillPath: skill,
            args: '--env prep --pattern "svc.*"',
            cwd: genTempDir({ slug: 'hermetic-ambient', git: true }),
          },
          { env: { PATH: PATH_WITHOUT_RHX } },
        ).stdout;
      } finally {
        for (const [name, value] of restore.entries()) {
          if (value === undefined) delete process.env[name];
          else process.env[name] = value;
        }
      }
    };

    when('[t0] a run on a bare host is compared to one on a runner', () => {
      then('the render is byte-identical', () => {
        // the clamp that carries the weight. with the scrub removed this goes red, because
        // the skill takes its ambient-credential arm on the second run and skips the whole
        // keyrack bucket — which is precisely how eight suites failed in cicd while green
        // on a laptop.
        expect(
          runWithAmbient({
            ambient: {
              AWS_ACCESS_KEY_ID: 'AKIAHOSTSHAPED',
              AWS_SECRET_ACCESS_KEY: 'host-shaped-secret',
              CI: 'true',
              GITHUB_ACTIONS: 'true',
            },
          }),
        ).toEqual(runWithAmbient({ ambient: {} }));
      });
    });

    when('[t1] the scrub list is read', () => {
      then('it names every ambient variable a skill forks on', () => {
        // a scrub list is an allowlist inverted, and it rots the same way: a skill added
        // later reads a variable nobody added here, and the fork reopens in silence. so
        // the list is derived-checked against the skills themselves rather than trusted
        // (rule.require.trust-but-verify).
        const forked = new Set<string>();
        for (const file of getAllSkillFilesUnder({
          dir: join(repoRoot, 'src', 'domain.roles'),
        })) {
          const source = readFileSync(file, 'utf-8');
          for (const match of source.matchAll(
            /\[\[ (?:-z )?"\$\{([A-Z_]+):-\}"/g,
          ))
            forked.add(match[1] ?? '');
        }

        const uncovered = [...forked]
          .filter((name) => !ENV_VARS_HOST_SHAPED.includes(name as never))
          .sort();
        expect(uncovered).toEqual([]);
      });
    });
  });

  given('[case3] a runner hands bash an explicit env', () => {
    when('[t0] every runner is graded', () => {
      then('each deletes BASH_ENV', () => {
        // BASH_ENV is the vector that carries an rc into a NON-interactive bash, and it
        // is the one PROVEN to carry weight on this host — `--norc` alone does not close
        // it, because a non-interactive bash never reads an rc file by that name. so a
        // runner that passes `--noprofile --norc` and keeps BASH_ENV is still open.
        const leaky = runners.filter((at) => {
          const content = readFileSync(join(repoRoot, at), 'utf-8');
          return !content.includes('delete env.BASH_ENV');
        });
        expect(leaky).toEqual([]);
      });
    });
  });
});
