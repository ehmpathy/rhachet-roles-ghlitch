import { genTempDir, given, then, useBeforeAll, when } from 'test-fns';

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expectNoStrayLines } from '../../.test/expectNoStrayLines';
import { genStubBinPath, PATH_WITHOUT_RHX } from '../../.test/runRoleSkill';
import { runObserverSkill } from './.test/runObserverSkill';

/**
 * .what = render clamps for every critipath of the `aws.cloudwatch.metrics.query` contract
 * .why  = this skill had NO test at all. what the absence hid:
 *           1. `   poll N queues...` and `   poll N lambdas...` wore NO branch glyph
 *           2. the whole result table rendered at column 0 as a `━━━`-ruled block, below
 *              a tree that had closed six lines earlier
 *           3. the header closed on its last ARG (`└─ since:`), which is what let 1 and 2
 *              look plausible
 *           4. three belays exited 1 with the tree open and no `└─` close
 *           5. `--namespace` had NO validation, so an unknown value silently took the
 *              lambda branch — that branch is the `else` — and reported lambda metrics
 *              under an sqs-shaped question
 *           6. no `require_val` on any of the seven flags
 */

const ARTIFACT = '🔮';

/**
 * .what = a temp repo whose package.json#name gives the skill its resource prefix
 * .why  = the skill derives PREFIX from package.json and belays without it, so every case
 *         needs one. the name is the prefix every stubbed resource below is built from.
 */
const setupRepo = (input: { slug: string }): string => {
  const dir = genTempDir({ slug: input.slug, git: true });
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'svc-test', version: '0.0.0' }, null, 2),
  );
  return dir;
};

const runMetrics = (input: {
  args: string;
  cwd: string;
}): { stdout: string; stderr: string; exitCode: number } =>
  runObserverSkill(
    {
      skill: 'aws.cloudwatch.metrics.query.sh',
      args: input.args,
      cwd: input.cwd,
    },
    { env: { PATH: PATH_WITHOUT_RHX } },
  );

const runMetricsStubbed = (input: {
  args: string;
  cwd: string;
  env?: Record<string, string>;
}): { stdout: string; stderr: string; exitCode: number } =>
  runObserverSkill(
    {
      skill: 'aws.cloudwatch.metrics.query.sh',
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

/**
 * .what = mask the time window, which is the only volatile part of the render
 * .why  = `since: 7d (<start> to <end>)` is derived from the clock, so a raw snapshot
 *         would redden on every run. the LABEL and the shape stay clamped; only the two
 *         timestamps are replaced (rule.require.hermetic-tests).
 */
const maskWindow = (out: string): string =>
  out.replace(
    /\(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z to \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z\)/g,
    '(<START> to <END>)',
  );

describe('aws.cloudwatch.metrics.query (contract renders)', () => {
  given('[case1] help is requested', () => {
    const scene = useBeforeAll(async () => {
      const dir = setupRepo({ slug: 'cw-metrics-help' });
      return {
        bare: runMetrics({ args: 'help', cwd: dir }),
        long: runMetrics({ args: '--help', cwd: dir }),
        short: runMetrics({ args: '-h', cwd: dir }),
        helpLate: runMetrics({ args: '--env prep --help', cwd: dir }),
      };
    });

    when('[t0] help is the first token', () => {
      then('it exits 0', () => {
        expect(scene.bare.exitCode).toBe(0);
      });

      then('the full help stdout matches snapshot (visual vibecheck)', () => {
        expect(scene.bare.stdout).toMatchSnapshot();
      });
    });

    when('[t1] help arrives in any other form', () => {
      then('every form renders the identical text', () => {
        expect(scene.long.stdout).toEqual(scene.bare.stdout);
        expect(scene.short.stdout).toEqual(scene.bare.stdout);
        expect(scene.helpLate.stdout).toEqual(scene.bare.stdout);
      });
    });
  });

  given('[case2] argument constraints belay before any work is done', () => {
    const scene = useBeforeAll(async () => {
      const dir = setupRepo({ slug: 'cw-metrics-args' });
      return {
        absentEnv: runMetrics({ args: '', cwd: dir }),
        badEnv: runMetrics({ args: '--env camp', cwd: dir }),
        badNamespace: runMetrics({
          args: '--env prep --namespace sqz',
          cwd: dir,
        }),
        unknown: runMetrics({ args: '--env prep --namespac sqs', cwd: dir }),
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

    when('[t2] --namespace names a namespace that does not exist', () => {
      // the defect this case exists for: there was no validation at all, and the lambda
      // branch is the `else` — so `--namespace sqz` reported LAMBDA metrics, silently,
      // under a question that named sqs (rule.forbid.unexpected-defaults).
      then('it belays rather than fall through to the lambda branch', () => {
        expect(scene.badNamespace.exitCode).toBe(2);
        expect(scene.badNamespace.stdout).toMatchSnapshot();
      });

      then('it never reports a lambda result for an sqs-shaped ask', () => {
        expect(scene.badNamespace.stdout).not.toContain('by Lambda');
      });
    });

    when('[t3] an unknown flag is passed', () => {
      then('it is a constraint (exit 2) and matches snapshot', () => {
        expect(scene.unknown.exitCode).toBe(2);
        expect(scene.unknown.stdout).toMatchSnapshot();
      });
    });
  });

  given('[case3] a flag is passed with no value', () => {
    const scene = useBeforeAll(async () => {
      const dir = setupRepo({ slug: 'cw-metrics-absent-value' });
      return {
        envLast: runMetrics({ args: '--env', cwd: dir }),
        metricLast: runMetrics({ args: '--env prep --metric', cwd: dir }),
        namespaceLast: runMetrics({ args: '--env prep --namespace', cwd: dir }),
        envSwallows: runMetrics({ args: '--env --namespace sqs', cwd: dir }),
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

    when('[t1] a flag with a closed value set is last', () => {
      then('--namespace names its set and matches snapshot', () => {
        expect(scene.namespaceLast.exitCode).toBe(2);
        expect(scene.namespaceLast.stdout).toMatchSnapshot();
      });
    });

    when('[t2] a free-form flag is last', () => {
      // --metric names NO value set on purpose: the valid metrics differ per namespace,
      // so one flat list would name metrics invalid for the namespace in play.
      then('--metric belays with no fabricated value set', () => {
        expect(scene.metricLast.exitCode).toBe(2);
        expect(scene.metricLast.stdout).toMatchSnapshot();
      });
    });

    when('[t3] --env would swallow the flag that follows it', () => {
      then('it belays about --env, not about --namespace', () => {
        expect(scene.envSwallows.exitCode).toBe(2);
        expect(scene.envSwallows.stdout).toContain('absent value for --env');
        expect(scene.envSwallows.stdout).not.toContain('--namespace');
      });
    });
  });

  given('[case4] the credential read finds no profile', () => {
    // rhx is off PATH, so the keyrack read yields empty. this belay fires BEFORE the
    // header, so it is correctly self-contained — no tree is open to close.
    const scene = useBeforeAll(async () => {
      const dir = setupRepo({ slug: 'cw-metrics-no-creds' });
      return runMetrics({ args: '--env prep', cwd: dir });
    });

    when('[t0] the keyrack answers empty', () => {
      then('it is a malfunction (exit 1) and matches snapshot', () => {
        expect(scene.exitCode).toBe(1);
        expect(scene.stdout).toMatchSnapshot();
      });

      then('it opens no tree it then fails to close', () => {
        expect(scene.stdout).not.toContain(
          '🔮 aws.cloudwatch.metrics.query --env',
        );
      });
    });
  });

  given('[case5] lambda metrics are polled across all lambdas', () => {
    // the happy path, and the coverage this suite most lacked: the whole result render —
    // the poll line, the table, the total — had never been produced by a test.
    const scene = useBeforeAll(async () => {
      const dir = setupRepo({ slug: 'cw-metrics-lambda-all' });
      return runMetricsStubbed({
        args: '--env prod --since 7d',
        cwd: dir,
        env: {
          STUB_LAMBDA_FUNCTIONS:
            'svc-test-prod-createJob\tsvc-test-prod-getJob\tsvc-test-prod-idleJob',
          // three DIFFERENT counts, and one `None`, so the render shows the sort order,
          // the None-to-0 branch, and a total that is not merely a copy of one row
          STUB_CW_DATAPOINTS:
            'svc-test-prod-createJob=17,svc-test-prod-getJob=42',
        },
      });
    });

    when('[t0] three lambdas answer', () => {
      then('the run REACHES the poll (exit 0)', () => {
        expect(scene.exitCode).toBe(0);
      });

      then('the FULL stdout matches snapshot (visual vibecheck)', () => {
        expect(maskWindow(scene.stdout)).toMatchSnapshot();
      });

      then('no line falls outside the tree vocabulary', () => {
        expectNoStrayLines({
          out: maskWindow(scene.stdout),
          artifact: ARTIFACT,
        });
      });

      // the stray, with its glyph-less form as the negative control.
      then('the poll line is a tree item, never a glyph-less line', () => {
        expect(scene.stdout).toContain('   ├─ polled 3 lambdas');
        expect(scene.stdout).not.toContain('   poll 3 lambdas...');
      });

      // the `━━━` rulers were the loudest part of the old render and belonged to no
      // category at all. their absence is the clamp.
      then('the ruled table is gone entirely', () => {
        expect(scene.stdout).not.toContain('━');
        expect(scene.stdout).not.toContain('────────────');
      });

      then('the rows nest under the item that opened them', () => {
        expect(scene.stdout).toContain('   └─ Invocations by Lambda');
        expect(scene.stdout).toMatch(/^ {6}├─ +42 {2}getJob$/m);
        expect(scene.stdout).toMatch(/^ {6}├─ +17 {2}createJob$/m);
      });

      // the `None` datapoint. the real api answers a literal `None` for an empty window,
      // and the skill turns it into 0 — a branch a stub that always answered a number
      // would never reach.
      then('a lambda with no datapoint renders as 0', () => {
        expect(scene.stdout).toMatch(/^ {6}├─ +0 {2}idleJob$/m);
      });

      // the total takes the `└─`, which is also why it must be rendered last rather than
      // merely printed last.
      then('the total closes the list and sums every row', () => {
        expect(scene.stdout).toMatch(/^ {6}└─ +59 {2}TOTAL$/m);
      });

      then('rows are ordered by count, highest first', () => {
        const rows = scene.stdout
          .split('\n')
          .filter((line) => /^ {6}[├└]─ /.test(line))
          .map((line) => line.replace(/^ {6}[├└]─ +/, ''));
        expect(rows).toEqual([
          '42  getJob',
          '17  createJob',
          '0  idleJob',
          '59  TOTAL',
        ]);
      });
    });
  });

  given('[case6] a single --lambda is polled', () => {
    const scene = useBeforeAll(async () => {
      const dirFound = setupRepo({ slug: 'cw-metrics-lambda-one' });
      const dirGone = setupRepo({ slug: 'cw-metrics-lambda-gone' });
      return {
        found: runMetricsStubbed({
          args: '--env prod --lambda createJob --metric Errors',
          cwd: dirFound,
          env: {
            STUB_LAMBDA_PRESENT: 'svc-test-prod-createJob',
            STUB_CW_DATAPOINTS: 'svc-test-prod-createJob=3',
          },
        }),
        gone: runMetricsStubbed({
          args: '--env prod --lambda absentJob',
          cwd: dirGone,
          env: { STUB_LAMBDA_PRESENT: '' },
        }),
      };
    });

    when('[t0] the lambda exists', () => {
      then('the run REACHES the poll (exit 0) and matches snapshot', () => {
        expect(scene.found.exitCode).toBe(0);
        expect(maskWindow(scene.found.stdout)).toMatchSnapshot();
      });

      then('no line falls outside the tree vocabulary', () => {
        expectNoStrayLines({
          out: maskWindow(scene.found.stdout),
          artifact: ARTIFACT,
        });
      });

      then('the metric named on the flag heads the result item', () => {
        expect(scene.found.stdout).toContain('   └─ Errors by Lambda');
      });
    });

    when('[t1] the lambda does not exist', () => {
      // a mid-tree exit: the header is already open when this belay fires.
      then('it is a malfunction (exit 1) and matches snapshot', () => {
        expect(scene.gone.exitCode).toBe(1);
        expect(maskWindow(scene.gone.stdout)).toMatchSnapshot();
      });

      then('the close names the outcome with the exit-1 word', () => {
        expect(scene.gone.stdout).toContain('   └─ halted: lambda not found');
        expect(scene.gone.stdout).not.toContain('   └─ blocked:');
      });

      then('no line falls outside the tree vocabulary', () => {
        expectNoStrayLines({
          out: maskWindow(scene.gone.stdout),
          artifact: ARTIFACT,
        });
      });
    });
  });

  given('[case7] sqs metrics are polled', () => {
    const scene = useBeforeAll(async () => {
      const dirHits = setupRepo({ slug: 'cw-metrics-sqs' });
      const dirEmpty = setupRepo({ slug: 'cw-metrics-sqs-empty' });
      return {
        hits: runMetricsStubbed({
          args: '--env prod --namespace sqs',
          cwd: dirHits,
          env: {
            STUB_SQS_QUEUES:
              'https://sqs.us-east-1.amazonaws.com/1/svc-test-prod-jobs\thttps://sqs.us-east-1.amazonaws.com/1/svc-test-prod-jobs-dlq',
            STUB_CW_DATAPOINTS: 'svc-test-prod-jobs=8,svc-test-prod-jobs-dlq=2',
          },
        }),
        empty: runMetricsStubbed({
          args: '--env prod --namespace sqs',
          cwd: dirEmpty,
          env: { STUB_SQS_QUEUES: '' },
        }),
      };
    });

    when('[t0] two queues answer', () => {
      then('the run REACHES the poll (exit 0) and matches snapshot', () => {
        expect(scene.hits.exitCode).toBe(0);
        expect(maskWindow(scene.hits.stdout)).toMatchSnapshot();
      });

      then('no line falls outside the tree vocabulary', () => {
        expectNoStrayLines({
          out: maskWindow(scene.hits.stdout),
          artifact: ARTIFACT,
        });
      });

      then('the poll line is a tree item, never a glyph-less line', () => {
        expect(scene.hits.stdout).toContain('   ├─ polled 2 queues');
        expect(scene.hits.stdout).not.toContain('   poll 2 queues...');
      });

      // the resource-type word differs per namespace, and the sqs arm had never rendered.
      then('the result item names Queue, not Lambda', () => {
        expect(scene.hits.stdout).toContain(
          '   └─ ApproximateNumberOfMessagesVisible by Queue',
        );
      });

      then('the total closes the list and sums both queues', () => {
        expect(scene.hits.stdout).toMatch(/^ {6}└─ +10 {2}TOTAL$/m);
      });
    });

    when('[t1] no queue matches', () => {
      // a mid-tree exit on the sqs arm.
      then('it is a malfunction (exit 1) and matches snapshot', () => {
        expect(scene.empty.exitCode).toBe(1);
        expect(maskWindow(scene.empty.stdout)).toMatchSnapshot();
      });

      then('the close names the outcome with the exit-1 word', () => {
        expect(scene.empty.stdout).toContain('   └─ halted: no queues to poll');
      });

      then('no line falls outside the tree vocabulary', () => {
        expectNoStrayLines({
          out: maskWindow(scene.empty.stdout),
          artifact: ARTIFACT,
        });
      });
    });
  });
});
