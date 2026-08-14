import { given, then, when } from 'test-fns';

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

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
