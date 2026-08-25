import { genTempDir, given, then, useBeforeAll, when } from 'test-fns';

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expectNoStrayLines } from '../../.test/expectNoStrayLines';
import { genStubBinPath, PATH_WITHOUT_RHX } from '../../.test/runRoleSkill';
import { runObserverSkill } from './.test/runObserverSkill';

/**
 * .what = render clamps for every critipath of the `aws.ssm.param.check` contract
 * .why  = this skill had NO test at all, and it carried the densest concentration of the
 *         glyph-less-stray defect in the repo — EIGHT lines that were neither blank, nor a
 *         mascot, nor a header, nor a tree item (`   check parameter:`, `   ✅ name`,
 *         `   (none found)`, and five more).
 *
 *         the absence hid four more:
 *           1. TWO divergent help texts. the pre-loop copy carried no `🐈` mascot at all,
 *              and called `--pattern` a "contains match" where the in-loop copy called it
 *              a "glob pattern with * wildcards" — two contracts for one flag
 *           2. the header closed on its FIRST item (`└─ env:`), so every block after it
 *              printed beneath a tree that had already ended
 *           3. `aws ssm get-parameter` silenced only stdout, so on an absent parameter the
 *              tool's stderr landed at column 0 in the middle of the tree
 *           4. no `require_val` on any of the four flags, so a flag in last position
 *              tripped a cryptic `set -u` crash rather than a belay
 */

const ARTIFACT = '🔮';

const setupRepo = (input: { slug: string }): string =>
  genTempDir({ slug: input.slug, git: true });

const runCheck = (input: {
  args: string;
  cwd: string;
  env?: Record<string, string>;
}): { stdout: string; stderr: string; exitCode: number } =>
  runObserverSkill(
    {
      skill: 'aws.ssm.param.check.sh',
      args: input.args,
      cwd: input.cwd,
    },
    { env: { PATH: PATH_WITHOUT_RHX, ...(input.env ?? {}) } },
  );

/**
 * .what = run with the stub bin staged FIRST on PATH, so the run reaches the ssm calls
 * .why  = with `rhx` off PATH the credential read yields empty and every case belays
 *         before the header. that is a real critipath, but it is not the one the render
 *         defects lived on — those were all past it.
 */
const runCheckStubbed = (input: {
  args: string;
  cwd: string;
  env?: Record<string, string>;
}): { stdout: string; stderr: string; exitCode: number } =>
  runObserverSkill(
    {
      skill: 'aws.ssm.param.check.sh',
      args: input.args,
      cwd: input.cwd,
    },
    {
      env: {
        PATH: genStubBinPath({ cwd: input.cwd }),
        ...(input.env ?? {}),
      },
    },
  );

describe('aws.ssm.param.check (contract renders)', () => {
  given('[case1] help is requested', () => {
    const scene = useBeforeAll(async () => {
      const dir = setupRepo({ slug: 'ssm-check-help' });
      return {
        bare: runCheck({ args: 'help', cwd: dir }),
        long: runCheck({ args: '--help', cwd: dir }),
        short: runCheck({ args: '-h', cwd: dir }),
        helpLate: runCheck({ args: '--env prep --help', cwd: dir }),
      };
    });

    when('[t0] help is the first token', () => {
      then('it exits 0', () => {
        expect(scene.bare.exitCode).toBe(0);
      });

      then('the full help stdout matches snapshot (visual vibecheck)', () => {
        expect(scene.bare.stdout).toMatchSnapshot();
      });

      // the pre-loop copy used to open on the bare `🔮` header with no mascot ahead of it —
      // the only skill in the repo that did.
      then('it opens with the mascot, never a bare artifact header', () => {
        expect(scene.bare.stdout.startsWith('🐈 heres the deal...')).toBe(true);
      });
    });

    when('[t1] help arrives as a flag, in either form', () => {
      then('--help and -h render identically to the bare form', () => {
        expect(scene.long.stdout).toEqual(scene.bare.stdout);
        expect(scene.short.stdout).toEqual(scene.bare.stdout);
      });
    });

    when('[t2] help arrives AFTER another flag', () => {
      // the two copies had ALREADY drifted on the sense of --pattern. one text, reached
      // from both call sites, is what makes that impossible; this is the clamp on it.
      then('the in-loop arm renders the identical text', () => {
        expect(scene.helpLate.exitCode).toBe(0);
        expect(scene.helpLate.stdout).toEqual(scene.bare.stdout);
      });

      then('the help names --pattern with exactly one sense', () => {
        expect(scene.bare.stdout).toContain(
          '--pattern  text a parameter name must contain (never a glob)',
        );
        expect(scene.bare.stdout).not.toContain(
          'glob pattern with * wildcards',
        );
      });
    });
  });

  given('[case2] argument constraints belay before any work is done', () => {
    const scene = useBeforeAll(async () => {
      const dir = setupRepo({ slug: 'ssm-check-args' });
      return {
        absentEnv: runCheck({ args: '--name some.param', cwd: dir }),
        badEnv: runCheck({ args: '--env camp --name some.param', cwd: dir }),
        unknown: runCheck({ args: '--env prep --nam x', cwd: dir }),
      };
    });

    when('[t0] --env is absent', () => {
      then('it is a constraint (exit 2) and matches snapshot', () => {
        expect(scene.absentEnv.exitCode).toBe(2);
        expect(scene.absentEnv.stdout).toMatchSnapshot();
      });
    });

    when('[t1] --env names an env this skill does not serve', () => {
      then('it names the valid set and matches snapshot', () => {
        expect(scene.badEnv.exitCode).toBe(2);
        expect(scene.badEnv.stdout).toMatchSnapshot();
      });
    });

    when('[t2] an unknown flag is passed', () => {
      then('it is a constraint (exit 2) and matches snapshot', () => {
        expect(scene.unknown.exitCode).toBe(2);
        expect(scene.unknown.stdout).toMatchSnapshot();
      });
    });
  });

  given('[case3] a flag is passed with no value', () => {
    const scene = useBeforeAll(async () => {
      const dir = setupRepo({ slug: 'ssm-check-absent-value' });
      return {
        envLast: runCheck({ args: '--env', cwd: dir }),
        nameLast: runCheck({ args: '--env prep --name', cwd: dir }),
        patternLast: runCheck({ args: '--env prep --pattern', cwd: dir }),
        fromLast: runCheck({ args: '--env prep --from', cwd: dir }),
        envSwallows: runCheck({ args: '--env --name some.param', cwd: dir }),
      };
    });

    when('[t0] --env is the last token', () => {
      then('it belays with the valid set, never a set -u crash', () => {
        expect(scene.envLast.exitCode).toBe(2);
        expect(scene.envLast.stdout).toMatchSnapshot();
      });

      // the negative control. a `set -u` crash also exits non-zero, so the exit code alone
      // cannot tell a belay from the crash this guard exists to prevent.
      then('it does NOT crash on an unbound variable', () => {
        expect(scene.envLast.stderr).not.toContain('unbound variable');
      });
    });

    when('[t1] a free-form flag is the last token', () => {
      // all three name no value set, because a param name / search text / path is
      // free-form and a fabricated set would mislead.
      then('--name belays with no fabricated value set', () => {
        expect(scene.nameLast.exitCode).toBe(2);
        expect(scene.nameLast.stdout).toMatchSnapshot();
      });

      then('--pattern belays the same way', () => {
        expect(scene.patternLast.exitCode).toBe(2);
        expect(scene.patternLast.stdout).toContain(
          'absent value for --pattern',
        );
      });

      then('--from belays the same way', () => {
        expect(scene.fromLast.exitCode).toBe(2);
        expect(scene.fromLast.stdout).toContain('absent value for --from');
      });
    });

    when('[t2] --env would swallow the flag that follows it', () => {
      then('it belays about --env, not about --name', () => {
        expect(scene.envSwallows.exitCode).toBe(2);
        expect(scene.envSwallows.stdout).toContain('absent value for --env');
        expect(scene.envSwallows.stdout).not.toContain('--name');
      });
    });
  });

  given('[case4] the credential read finds no profile', () => {
    // rhx is off PATH, so the keyrack read yields empty. this belay fires BEFORE the
    // header, so it is correctly self-contained — no tree is open to close.
    const scene = useBeforeAll(async () => {
      const dir = setupRepo({ slug: 'ssm-check-no-creds' });
      return runCheck({ args: '--env prep --name some.param', cwd: dir });
    });

    when('[t0] the keyrack answers empty', () => {
      then('it is a malfunction (exit 1) and matches snapshot', () => {
        expect(scene.exitCode).toBe(1);
        expect(scene.stdout).toMatchSnapshot();
      });

      // a pre-header belay is self-contained by design: it opens its OWN mascot and header
      // rather than close a tree that was never opened.
      then('it opens no tree it then fails to close', () => {
        expect(scene.stdout).not.toContain('🔮 aws.ssm.param.check --env');
      });
    });
  });

  given('[case5] a single --name is checked', () => {
    const scene = useBeforeAll(async () => {
      const dirFound = setupRepo({ slug: 'ssm-check-name-found' });
      const dirAbsent = setupRepo({ slug: 'ssm-check-name-absent' });
      return {
        found: runCheckStubbed({
          args: '--env prep --name ahbode.svc-jobs.prep.livedb.uri',
          cwd: dirFound,
          env: { STUB_SSM_PRESENT: 'ahbode.svc-jobs.prep.livedb.uri' },
        }),
        absent: runCheckStubbed({
          args: '--env prep --name ahbode.svc-jobs.prep.absent.key',
          cwd: dirAbsent,
          env: { STUB_SSM_PRESENT: '' },
        }),
      };
    });

    when('[t0] the parameter is present', () => {
      then('the run REACHES the ssm call (exit 0)', () => {
        expect(scene.found.exitCode).toBe(0);
      });

      then('the FULL stdout matches snapshot (visual vibecheck)', () => {
        expect(scene.found.stdout).toMatchSnapshot();
      });

      then('no line falls outside the tree vocabulary', () => {
        expectNoStrayLines({ out: scene.found.stdout, artifact: ARTIFACT });
      });

      // the stray, with its glyph-less form as the negative control. that form is exactly
      // what the defect emitted, so it is the assertion with teeth.
      then('the param is a nested tree item, never a glyph-less line', () => {
        expect(scene.found.stdout).toContain(
          '      └─ ✅ ahbode.svc-jobs.prep.livedb.uri',
        );
        expect(scene.found.stdout).not.toContain(
          '   ✅ ahbode.svc-jobs.prep.livedb.uri',
        );
      });

      then('the close states the tally, never a bare observed', () => {
        expect(scene.found.stdout).toContain('   └─ 1 found, 0 absent');
        expect(scene.found.stdout).not.toContain('   └─ observed');
      });
    });

    when('[t1] the parameter is absent', () => {
      // the ❌ arm. the real aws api speaks on stderr and exits 2 here, and the skill used
      // to silence only stdout — so that message landed at column 0 mid-tree. the stub
      // matches the real tool's volume precisely so this case can prove it does not.
      then('it still exits 0 — an absence is the ANSWER, not an error', () => {
        expect(scene.absent.exitCode).toBe(0);
      });

      then('the FULL stdout matches snapshot (visual vibecheck)', () => {
        expect(scene.absent.stdout).toMatchSnapshot();
      });

      then('no line falls outside the tree vocabulary', () => {
        expectNoStrayLines({ out: scene.absent.stdout, artifact: ARTIFACT });
      });

      then('the tool own error text never reaches the render', () => {
        expect(scene.absent.stdout).not.toContain('ParameterNotFound');
        expect(scene.absent.stderr).not.toContain('ParameterNotFound');
      });

      then('the tally counts it as absent', () => {
        expect(scene.absent.stdout).toContain('   └─ 0 found, 1 absent');
      });
    });
  });

  given('[case6] a --pattern search is run', () => {
    const scene = useBeforeAll(async () => {
      const dirHits = setupRepo({ slug: 'ssm-check-pattern-hits' });
      const dirEmpty = setupRepo({ slug: 'ssm-check-pattern-empty' });
      return {
        hits: runCheckStubbed({
          args: '--env prep --pattern ahbode.svc-jobs',
          cwd: dirHits,
          env: {
            STUB_SSM_MATCHES:
              'ahbode.svc-jobs.prep.livedb.uri\tahbode.svc-jobs.prep.livedb.password',
            STUB_SSM_PRESENT:
              'ahbode.svc-jobs.prep.livedb.uri,ahbode.svc-jobs.prep.livedb.password',
          },
        }),
        empty: runCheckStubbed({
          args: '--env prep --pattern ahbode.svc-absent',
          cwd: dirEmpty,
          env: { STUB_SSM_MATCHES: '' },
        }),
      };
    });

    when('[t0] the search matches two params', () => {
      then('the run REACHES the search (exit 0)', () => {
        expect(scene.hits.exitCode).toBe(0);
      });

      then('the FULL stdout matches snapshot (visual vibecheck)', () => {
        expect(scene.hits.stdout).toMatchSnapshot();
      });

      then('no line falls outside the tree vocabulary', () => {
        expectNoStrayLines({ out: scene.hits.stdout, artifact: ARTIFACT });
      });

      // TWO params, so both arms of the glyph choice are observed in one render: the last
      // child takes `└─` and every other takes `├─`. one param would prove only the first.
      then('the last child closes the list and the rest continue it', () => {
        expect(scene.hits.stdout).toMatch(/^ {6}├─ ✅ /m);
        expect(scene.hits.stdout).toMatch(/^ {6}└─ ✅ /m);
      });

      then('the tally counts both', () => {
        expect(scene.hits.stdout).toContain('   └─ 2 found, 0 absent');
      });
    });

    when('[t1] the search matches no param', () => {
      then('the empty list is a nested item, never a glyph-less line', () => {
        expect(scene.empty.exitCode).toBe(0);
        expect(scene.empty.stdout).toContain('      └─ (none)');
        expect(scene.empty.stdout).not.toContain('   (none found)');
        expect(scene.empty.stdout).toMatchSnapshot();
      });

      then('no line falls outside the tree vocabulary', () => {
        expectNoStrayLines({ out: scene.empty.stdout, artifact: ARTIFACT });
      });
    });
  });

  given('[case7] params are extracted --from a config file', () => {
    const scene = useBeforeAll(async () => {
      const dirRefs = setupRepo({ slug: 'ssm-check-from-refs' });
      const dirBare = setupRepo({ slug: 'ssm-check-from-bare' });
      const dirGone = setupRepo({ slug: 'ssm-check-from-gone' });

      // a config that holds two `$.at(aws::param/...)` refs — one present, one absent, so
      // the render shows BOTH arms of check_param in a single tree
      writeFileSync(
        join(dirRefs, 'config.json'),
        JSON.stringify(
          {
            db: { uri: '$.at(aws::param/ahbode.svc-jobs.prep.livedb.uri)' },
            api: { key: '$.at(aws::param/ahbode.svc-jobs.prep.absent.key)' },
          },
          null,
          2,
        ),
      );
      // a config with no aws::param refs at all
      writeFileSync(
        join(dirBare, 'config.json'),
        JSON.stringify({ db: { uri: 'postgres://localhost' } }, null, 2),
      );

      return {
        refs: runCheckStubbed({
          args: '--env prep --from config.json',
          cwd: dirRefs,
          env: { STUB_SSM_PRESENT: 'ahbode.svc-jobs.prep.livedb.uri' },
        }),
        bare: runCheckStubbed({
          args: '--env prep --from config.json',
          cwd: dirBare,
          env: { STUB_SSM_PRESENT: '' },
        }),
        gone: runCheckStubbed({
          args: '--env prep --from absent.json',
          cwd: dirGone,
          env: { STUB_SSM_PRESENT: '' },
        }),
      };
    });

    when('[t0] the config holds refs, one present and one absent', () => {
      then('the run REACHES the extraction (exit 0)', () => {
        expect(scene.refs.exitCode).toBe(0);
      });

      then('the FULL stdout matches snapshot (visual vibecheck)', () => {
        expect(scene.refs.stdout).toMatchSnapshot();
      });

      then('no line falls outside the tree vocabulary', () => {
        expectNoStrayLines({ out: scene.refs.stdout, artifact: ARTIFACT });
      });

      then('both arms render, and the tally reflects the split', () => {
        expect(scene.refs.stdout).toMatch(/^ {6}[├└]─ ✅ /m);
        expect(scene.refs.stdout).toMatch(/^ {6}[├└]─ ❌ .* \(absent\)$/m);
        expect(scene.refs.stdout).toContain('   └─ 1 found, 1 absent');
      });
    });

    when('[t1] the config holds no aws::param refs', () => {
      then('the empty list is a nested item and matches snapshot', () => {
        expect(scene.bare.exitCode).toBe(0);
        expect(scene.bare.stdout).toContain('      └─ (none)');
        expect(scene.bare.stdout).not.toContain(
          '   (no aws::param references found)',
        );
        expect(scene.bare.stdout).toMatchSnapshot();
      });
    });

    when('[t2] the config file is absent', () => {
      // this belay fires with the header tree already open, so it must close it. the
      // exit is 2, so the close word is `blocked:` — never `halted:`
      // (rule.require.consistent-skill-contracts).
      then('it is a constraint (exit 2) and matches snapshot', () => {
        expect(scene.gone.exitCode).toBe(2);
        expect(scene.gone.stdout).toMatchSnapshot();
      });

      then('the close names the outcome with the exit-2 word', () => {
        expect(scene.gone.stdout).toContain('   └─ blocked: absent file');
        expect(scene.gone.stdout).not.toContain('   └─ halted:');
      });

      then('no line falls outside the tree vocabulary', () => {
        expectNoStrayLines({ out: scene.gone.stdout, artifact: ARTIFACT });
      });
    });
  });

  given('[case8] no mode is named', () => {
    // --env alone reaches the header, then falls past all three modes. this exit is
    // mid-tree, so it too must close.
    const scene = useBeforeAll(async () => {
      const dir = setupRepo({ slug: 'ssm-check-no-mode' });
      return runCheckStubbed({ args: '--env prep', cwd: dir });
    });

    when('[t0] neither --name, --pattern nor --from is passed', () => {
      then('it is a constraint (exit 2) and matches snapshot', () => {
        expect(scene.exitCode).toBe(2);
        expect(scene.stdout).toMatchSnapshot();
      });

      then('the close names the outcome with the exit-2 word', () => {
        expect(scene.stdout).toContain('   └─ blocked: no mode named');
      });

      then('no line falls outside the tree vocabulary', () => {
        expectNoStrayLines({ out: scene.stdout, artifact: ARTIFACT });
      });
    });
  });
});
