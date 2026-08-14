import { given, then, useThen, when } from 'test-fns';

import { execSync } from 'node:child_process';

/**
 * helper to mask dynamic parts of output for stable snapshots
 */
const maskDynamicOutput = (output: string): string => {
  return (
    output
      // strip ANSI escape codes (terminal dim, reset, colors, etc.)
      // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape codes are intentional
      .replace(/\x1b\[[0-9;]*m/g, '')
      .replace(/asof=\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/g, 'asof=TIMESTAMP')
      .replace(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/g, 'YYYY-MM-DD HH:MM:SS')
  );
};

/**
 * .what = masks the buckets THIS REPO DOES NOT OWN, and keeps the one it does
 * .why  = [case9] lists every bucket in a SHARED aws account, so its snapshot went red the
 *         day an unrelated repo created one there. two costs, both real: a contributor who
 *         changed naught gets a red gate, and a resnap would commit a third party's bucket
 *         name — aws account id and all — as a fixture of THIS repo.
 *
 * .note = the split is by OWNERSHIP, never by convenience. `rhachet-roles-ghlitch-test` is
 *         this repo's own fixture: its name and creation date are facts we control, so they
 *         stay in the snapshot verbatim and a change to either goes red. every other entry
 *         belongs to whoever else shares the account, so an assertion this repo makes about
 *         them can only ever be flaky.
 *
 *         so the snapshot still verifies: the treestruct frame, the `buckets` label, the two
 *         branch chars, and the full owned entry. it gives up only the third-party names and
 *         the account-wide count — and the count is still checked, on the RAW stdout, by the
 *         kin `then` block `expect(result.stdout).toMatch(/found: \d+ buckets/)`.
 *
 * .note = when the owned bucket is ABSENT the block is left untouched, so the snapshot goes
 *         red rather than render a placeholder over a real regression.
 */
const maskUnownedBuckets = (output: string): string =>
  output
    .replace(/found: \d+ buckets/, 'found: <N> buckets')
    .replace(/ {3}└─ buckets\n(?: {6}[├└]─ .*\n)+/, (block): string => {
      const entries = block.split('\n').slice(1).filter(Boolean);
      const owned = entries.find((line) => line.includes(TEST_BUCKET));
      if (!owned) return block; // let a vanished fixture bucket redden the snapshot
      return [
        '   └─ buckets',
        '      ├─ <BUCKETS OF OTHERS WHO SHARE THIS ACCOUNT>',
        `      └─ ${owned.replace(/^ *[├└]─ /, '')}`,
        '',
      ].join('\n');
    });

/**
 * test bucket prepared with known objects:
 * - 85412205.png (4806 bytes)
 * - demo/ (0 bytes, folder marker)
 * - demo/date=2026-06-21/ (0 bytes, folder marker)
 * - demo/date=2026-06-21/hello.md (2 bytes, content: "hi")
 */
const TEST_BUCKET = 'rhachet-roles-ghlitch-test';
// .note = temp objects live under a dedicated prefix (NOT demo/, NOT the bucket
//         fixtures) so concurrent aws.s3.list shards never count them in demo/ or
//         fixture assertions. mirrors aws.s3.get's TEST_TMP_PREFIX convention.
const TEST_TMP_PREFIX = 'tmp-itest-list';

/**
 * .what = type guard for Node.js execSync error shape
 * .why = execSync throws errors with stdout/stderr/status properties;
 *        TypeScript lacks types for this error shape
 * .note = external boundary - Node.js child_process API
 */
const isExecSyncError = (
  error: unknown,
): error is { stdout?: string; stderr?: string; status: number } => {
  if (error === null || typeof error !== 'object') return false;
  if (!('status' in error)) return false;
  // .note = property check at external boundary (Node.js execSync error)
  const obj = error as Record<string, unknown>;
  return typeof obj.status === 'number';
};

/**
 * .what = helper to run the skill and return stdout + stderr
 * .why = enables test of skill behavior across exit codes
 */
const runSkill = (
  args: string,
  options?: { withoutAwsCredentials?: boolean },
): { stdout: string; stderr: string; exitCode: number } => {
  const skillPath = `${__dirname}/aws.s3.list.sh`;

  // build env, optionally remove AWS credentials to test keyrack failure
  const env = { ...process.env };
  if (options?.withoutAwsCredentials) {
    delete env.AWS_ACCESS_KEY_ID;
    delete env.AWS_SECRET_ACCESS_KEY;
    delete env.AWS_SESSION_TOKEN;
    delete env.AWS_PROFILE;
  }

  // the host's shell rc must not load into a run — an rc-defined FUNCTION or ALIAS beats
  // PATH outright, so it cannot be shadowed by a stub. BASH_ENV is the vector that carries
  // one into a NON-interactive bash, and this host has it set (rule.require.hermetic-tests).
  delete env.BASH_ENV;

  try {
    const stdout = execSync(`bash --noprofile --norc "${skillPath}" ${args}`, {
      encoding: 'utf-8',
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (error: unknown) {
    // handle execSync errors (have stdout/stderr/status)
    if (isExecSyncError(error)) {
      return {
        stdout: error.stdout ?? '',
        stderr: error.stderr ?? '',
        exitCode: error.status,
      };
    }
    // rethrow unexpected errors (ENOENT, TypeError, etc.)
    throw error;
  }
};

describe('aws.s3.list', () => {
  // ============================================================
  // help flag variants
  // ============================================================

  given('[case1] --help flag', () => {
    when('[t0] --help is passed', () => {
      const result = useThen('skill runs', () => runSkill('--help'));

      then('it exits 0', () => {
        expect(result.exitCode).toBe(0);
      });

      then('it shows cat mascot', () => {
        expect(result.stdout).toContain('🐈');
      });

      then('it shows help intro', () => {
        expect(result.stdout).toContain('heres the deal');
      });

      then('it shows skill name', () => {
        expect(result.stdout).toContain('aws.s3.list');
      });

      then('it shows the bare-invocation usage line', () => {
        expect(result.stdout).toContain('  rhx aws.s3.list --env <env>');
      });

      /**
       * the help text used to indent `usage:` and `options:` to 3 spaces, under the
       * artifact header — lines that are neither blank, nor a mascot, nor a header, nor a
       * tree item, and a dialect no kin skill speaks. this is the dedicated control for
       * that, because a snapshot alone lets a reader nod past an indent
       * (rule.require.consistent-skill-contracts).
       */
      then(
        'the section headers sit at column 0, as every kin skill sets them',
        () => {
          expect(result.stdout).toMatch(/^usage:$/m);
          expect(result.stdout).toMatch(/^options:$/m);
          expect(result.stdout).not.toMatch(/^ {3}usage:$/m);
          expect(result.stdout).not.toMatch(/^ {3}options:$/m);
        },
      );

      then('it shows --env option', () => {
        expect(result.stdout).toContain('--env');
      });

      then('help output matches snapshot', () => {
        expect(result.stdout).toMatchSnapshot();
      });
    });
  });

  given('[case2] -h flag', () => {
    when('[t0] -h is passed', () => {
      const result = useThen('skill runs', () => runSkill('-h'));

      then('it exits 0', () => {
        expect(result.exitCode).toBe(0);
      });

      then('it shows help output', () => {
        expect(result.stdout).toContain('heres the deal');
      });

      then('help output matches snapshot', () => {
        expect(result.stdout).toMatchSnapshot();
      });
    });
  });

  given('[case3] help as positional arg', () => {
    when('[t0] help is passed', () => {
      const result = useThen('skill runs', () => runSkill('help'));

      then('it exits 0', () => {
        expect(result.exitCode).toBe(0);
      });

      then('it shows help output', () => {
        expect(result.stdout).toContain('heres the deal');
      });

      then('help output matches snapshot', () => {
        expect(result.stdout).toMatchSnapshot();
      });
    });
  });

  // ============================================================
  // credential errors (exit 1)
  // ============================================================

  given('[case4] credentials not unlocked', () => {
    // .note = clears AWS env vars so the keyrack read answers empty.
    //
    //         this case used to pass `--env nonexistent` to force that empty answer, which
    //         worked only because the closed env set was NEVER checked. now that it is, an
    //         invented env belays at exit 2 long before the credential read — so the case
    //         must name a REAL env and let the cleared credentials do the work. the old
    //         shape would have quietly clamped the wrong path.
    when('[t0] skill runs without prior unlock', () => {
      const result = useThen('skill runs', () =>
        runSkill(`--env prep --bucket ${TEST_BUCKET}`, {
          withoutAwsCredentials: true,
        }),
      );

      then('it exits 1 (malfunction)', () => {
        expect(result.exitCode).toBe(1);
      });

      then('it shows wet paws', () => {
        const combined = result.stdout + result.stderr;
        expect(combined).toContain('wet paws');
      });

      then('it shows keyrack hint', () => {
        const combined = result.stdout + result.stderr;
        expect(combined).toContain('keyrack');
      });

      then('error output matches snapshot', () => {
        const combined = result.stdout + result.stderr;
        expect(maskDynamicOutput(combined)).toMatchSnapshot();
      });
    });
  });

  // ============================================================
  // constraint errors (exit 2)
  // ============================================================

  /**
   * every belay below now renders on STDOUT, and each `then` asserts that stream
   * explicitly.
   *
   * .why = it used to render on stderr as a ONE-LINER, and both halves were a dialect: all
   *        seventeen kin skills belay on stdout, in a four-line block (mascot, blank,
   *        artifact header, tree). one of them then followed with a bare
   *        `   └─ expected: ...` — a tree item under no tree at all
   *        (rule.require.consistent-skill-contracts).
   *
   * .note = the stream change is clamped deliberately, with a negative control on stderr —
   *         without it a belay written to BOTH streams would satisfy the positive and still
   *         be wrong.
   */
  given('[case5] absent --env', () => {
    when('[t0] skill runs without --env', () => {
      const result = useThen('skill runs', () =>
        runSkill('--bucket test-bucket'),
      );

      then('it exits 2 (constraint)', () => {
        expect(result.exitCode).toBe(2);
      });

      then('it belays on stdout, in the kin four-line block', () => {
        expect(result.stdout).toContain('🐈 belay that...');
        expect(result.stdout).toContain('🔮 aws.s3.list');
        expect(result.stderr).not.toContain('belay that');
      });

      then('it names the absent arg and its valid set', () => {
        expect(result.stdout).toContain('   ├─ absent required arg: --env');
        expect(result.stdout).toContain('   └─ must be: test, prep, or prod');
      });

      then('error output matches snapshot', () => {
        expect(result.stdout).toMatchSnapshot();
      });
    });
  });

  given('[case6] invalid --uri format (not s3://)', () => {
    when('[t0] skill runs with https:// uri', () => {
      const result = useThen('skill runs', () =>
        runSkill('--env test --uri https://bucket/key'),
      );

      then('it exits 2 (constraint)', () => {
        expect(result.exitCode).toBe(2);
      });

      then('it names the value it rejected AND the shape it wanted', () => {
        expect(result.stdout).toContain(
          '   ├─ invalid --uri: https://bucket/key',
        );
        expect(result.stdout).toContain('   └─ must be: s3://bucket/prefix');
      });

      then('error output matches snapshot', () => {
        expect(result.stdout).toMatchSnapshot();
      });
    });
  });

  given('[case7] invalid --since format', () => {
    when('[t0] skill runs with --since abc', () => {
      const result = useThen('skill runs', () =>
        runSkill(`--env test --bucket ${TEST_BUCKET} --since abc`),
      );

      then('it exits 2 (constraint)', () => {
        expect(result.exitCode).toBe(2);
      });

      /**
       * the second line used to be a bare `   └─ expected: ...` echoed after a one-liner
       * belay — a tree item beneath no header, and a second close on a tree that was never
       * opened. it is a proper `└─` under a proper header now.
       */
      then('the hint is a tree item under a header, never an orphan', () => {
        expect(result.stdout).toContain('   ├─ invalid --since: abc');
        expect(result.stdout).toContain(
          '   └─ must be: Nm, Nh, or Nd (e.g. 30m, 1h, 7d)',
        );
      });

      then('error output matches snapshot', () => {
        expect(result.stdout).toMatchSnapshot();
      });
    });
  });

  given('[case8] unknown option', () => {
    when('[t0] skill runs with --unknown-flag', () => {
      const result = useThen('skill runs', () =>
        runSkill('--env test --unknown-flag'),
      );

      then('it exits 2 (constraint)', () => {
        expect(result.exitCode).toBe(2);
      });

      then('it names the argument it did not know', () => {
        expect(result.stdout).toContain('unknown argument: --unknown-flag');
      });

      then('error output matches snapshot', () => {
        expect(result.stdout).toMatchSnapshot();
      });
    });
  });

  given('[case19] --env names an env this skill does not serve', () => {
    when('[t0] skill runs with --env prd', () => {
      const result = useThen('skill runs', () =>
        runSkill('--env prd --bucket test-bucket'),
      );

      then('it exits 2 (constraint)', () => {
        expect(result.exitCode).toBe(2);
      });

      /**
       * the closed set was never checked here, so a typo used to reach the keyrack and
       * report an absent CREDENTIAL for an env that does not exist — sending the human to
       * unlock a vault when the real gap was one letter in the flag.
       */
      then('it names the typo, never an absent credential', () => {
        expect(result.stdout).toContain('   ├─ invalid env: prd');
        expect(result.stdout).not.toContain('AWS_PROFILE');
      });

      then('error output matches snapshot', () => {
        expect(result.stdout).toMatchSnapshot();
      });
    });
  });

  given('[case20] --limit is not a number', () => {
    when('[t0] skill runs with --limit ten', () => {
      const result = useThen('skill runs', () =>
        runSkill('--env test --bucket test-bucket --limit ten'),
      );

      /**
       * `--limit` was never validated, so a non-numeric value reached `head -n "$LIMIT"`
       * and died with head's own usage text at column 0, under no tree and behind no
       * belay (rule.prefer.prevent-over-correct).
       */
      then('it belays rather than let head speak for the skill', () => {
        expect(result.exitCode).toBe(2);
        expect(result.stdout).toContain('   ├─ invalid --limit: ten');
        expect(result.stderr).not.toContain('head:');
      });

      then('error output matches snapshot', () => {
        expect(result.stdout).toMatchSnapshot();
      });
    });
  });

  given('[case21] a flag is passed with no value', () => {
    when('[t0] --env is the last token', () => {
      const result = useThen('skill runs', () => runSkill('--env'));

      /**
       * `shift 2` with a single arg left is an ERROR in bash, so under `set -e` this used
       * to die on the spot — exit 1, and NOT ONE line on either stream. a human saw a
       * skill that did not answer at all.
       */
      then('it belays rather than die silently', () => {
        expect(result.exitCode).toBe(2);
        expect(result.stdout).toContain('   ├─ absent value for --env');
        expect(result.stdout).toContain(
          '   ├─ fix: pass one of test,prep,prod',
        );
      });

      then('error output matches snapshot', () => {
        expect(result.stdout).toMatchSnapshot();
      });
    });

    when('[t1] a flag is followed by ANOTHER flag', () => {
      const result = useThen('skill runs', () =>
        runSkill('--env test --bucket --prefix x'),
      );

      /**
       * absent this guard `--bucket` would take `--prefix` as its value and eat the flag
       * whole, so the run would list a bucket literally named `--prefix`.
       */
      then('the belay names the flag that was actually starved', () => {
        expect(result.exitCode).toBe(2);
        expect(result.stdout).toContain('absent value for --bucket');
      });
    });
  });

  // ============================================================
  // list buckets (no --bucket)
  // ============================================================

  given('[case9] list buckets', () => {
    when('[t0] skill runs with only --env', () => {
      const result = useThen('skill runs', () => runSkill('--env test'));

      then('it exits 0', () => {
        expect(result.exitCode).toBe(0);
      });

      then('it shows cat mascot', () => {
        expect(result.stdout).toContain('🐈');
      });

      then('it shows crystal ball artifact', () => {
        expect(result.stdout).toContain('🔮');
      });

      then('it shows chartin course', () => {
        expect(result.stdout).toContain('chartin course');
      });

      then('it shows found buckets count', () => {
        expect(result.stdout).toMatch(/found: \d+ buckets/);
      });

      then('it lists the test bucket', () => {
        expect(result.stdout).toContain(TEST_BUCKET);
      });

      then('it shows smooth sailin', () => {
        expect(result.stdout).toContain('smooth sailin');
      });

      then('output matches snapshot', () => {
        // the buckets of OTHERS are masked; ours stays verbatim — see maskUnownedBuckets.
        expect(
          maskUnownedBuckets(maskDynamicOutput(result.stdout)),
        ).toMatchSnapshot();
      });
    });
  });

  // ============================================================
  // list objects in bucket
  // ============================================================

  given('[case10] list objects in bucket via --bucket', () => {
    when('[t0] skill lists test bucket', () => {
      const result = useThen('skill runs', () =>
        runSkill(`--env test --bucket ${TEST_BUCKET}`),
      );

      then('it exits 0', () => {
        expect(result.exitCode).toBe(0);
      });

      then('it shows cat mascot', () => {
        expect(result.stdout).toContain('🐈');
      });

      then('it shows crystal ball artifact', () => {
        expect(result.stdout).toContain('🔮');
      });

      then('it shows bucket name in output', () => {
        expect(result.stdout).toContain(TEST_BUCKET);
      });

      then('it finds the png file', () => {
        expect(result.stdout).toContain('85412205.png');
      });

      then('it shows png file size', () => {
        expect(result.stdout).toContain('4806 bytes');
      });

      then('it finds the demo folder', () => {
        expect(result.stdout).toContain('demo/');
      });

      then('it shows smooth sailin', () => {
        expect(result.stdout).toContain('smooth sailin');
      });

      // .note = no exact snapshot here: this reads the whole bucket recursively,
      //         so a concurrent writer (e.g. aws.s3.get temp files) would make an
      //         exact-inventory snapshot flaky. structural asserts cover the behavior.
      then('it reports an object count', () => {
        expect(result.stdout).toMatch(/found: \d+ objects/);
      });
    });
  });

  given('[case11] list objects via --uri', () => {
    when('[t0] skill lists via s3:// uri', () => {
      const result = useThen('skill runs', () =>
        runSkill(`--env test --uri s3://${TEST_BUCKET}/`),
      );

      then('it exits 0', () => {
        expect(result.exitCode).toBe(0);
      });

      then('it shows the uri in output', () => {
        expect(result.stdout).toContain(`s3://${TEST_BUCKET}/`);
      });

      then('it finds objects', () => {
        expect(result.stdout).toMatch(/found: \d+ objects/);
      });

      // .note = whole-bucket read; structural assert instead of flaky exact snapshot
      then('it finds the png fixture', () => {
        expect(result.stdout).toContain('85412205.png');
      });
    });
  });

  // ============================================================
  // prefix filter
  // ============================================================

  given('[case12] list with prefix that has objects', () => {
    when('[t0] skill lists demo/ prefix', () => {
      const result = useThen('skill runs', () =>
        runSkill(`--env test --uri s3://${TEST_BUCKET}/demo/`),
      );

      then('it exits 0', () => {
        expect(result.exitCode).toBe(0);
      });

      then('it finds 3 objects', () => {
        expect(result.stdout).toContain('found: 3 objects');
      });

      then('it finds the hello.md file', () => {
        expect(result.stdout).toContain('hello.md');
      });

      then('it shows hello.md is 2 bytes', () => {
        expect(result.stdout).toContain('2 bytes');
      });

      then('it finds the date folder', () => {
        expect(result.stdout).toContain('demo/date=2026-06-21/');
      });

      then('output matches snapshot', () => {
        expect(maskDynamicOutput(result.stdout)).toMatchSnapshot();
      });
    });
  });

  given('[case13] list with prefix that has no objects', () => {
    when('[t0] skill lists prefix with no objects', () => {
      const result = useThen('skill runs', () =>
        runSkill(`--env test --uri s3://${TEST_BUCKET}/nonexistent-prefix/`),
      );

      then('it exits 0', () => {
        expect(result.exitCode).toBe(0);
      });

      then('it shows empty result', () => {
        expect(result.stdout).toContain('(empty)');
      });

      then('output matches snapshot', () => {
        expect(maskDynamicOutput(result.stdout)).toMatchSnapshot();
      });
    });
  });

  given('[case18] empty bucket scenario (zero objects output format)', () => {
    // .note = verifies output format for zero objects in bucket
    //         uses prefix technique since we cannot create empty buckets in test
    //         output is identical to an actual empty bucket
    when('[t0] skill lists bucket with zero objects', () => {
      // use a prefix that will never match any objects
      const result = useThen('skill runs', () =>
        runSkill(
          `--env test --bucket ${TEST_BUCKET} --prefix zzz-empty-bucket-test-never-exists/`,
        ),
      );

      then('it exits 0', () => {
        expect(result.exitCode).toBe(0);
      });

      then('it shows path in output', () => {
        expect(result.stdout).toContain('path:');
      });

      then('it shows empty result (no objects)', () => {
        expect(result.stdout).toContain('(empty)');
      });

      then('output matches snapshot', () => {
        expect(maskDynamicOutput(result.stdout)).toMatchSnapshot();
      });
    });
  });

  given('[case14] list with --prefix flag', () => {
    when('[t0] skill uses --bucket and --prefix', () => {
      const result = useThen('skill runs', () =>
        runSkill(`--env test --bucket ${TEST_BUCKET} --prefix demo/`),
      );

      then('it exits 0', () => {
        expect(result.exitCode).toBe(0);
      });

      then('it finds objects under demo/', () => {
        expect(result.stdout).toContain('hello.md');
      });

      then('output matches snapshot', () => {
        expect(maskDynamicOutput(result.stdout)).toMatchSnapshot();
      });
    });
  });

  // ============================================================
  // limit option
  // ============================================================

  given('[case15] list with --limit', () => {
    when('[t0] skill limits to 1 result', () => {
      const result = useThen('skill runs', () =>
        runSkill(`--env test --bucket ${TEST_BUCKET} --limit 1`),
      );

      then('it exits 0', () => {
        expect(result.exitCode).toBe(0);
      });

      then('it shows only 1 object in tree', () => {
        // count object lines (format: "├─ filename (size bytes, date time)")
        const objectLines = result.stdout.match(/├─ \S+\.png \(/g);
        expect(objectLines?.length).toBe(1);
      });

      then('it shows "and N more" message', () => {
        expect(result.stdout).toMatch(/\.\.\. and \d+ more/);
      });

      // .note = no exact snapshot: --limit caps display but the "and N more"
      //         tail counts the whole bucket, which a concurrent writer perturbs.
    });
  });

  // ============================================================
  // since option (time filter)
  // ============================================================

  given('[case16] list with --since filter', () => {
    // .note = the --since window is time-relative, so a STATIC bucket fixture would
    //         age out of it and break the day the fixture crosses the window edge (a
    //         rule.forbid.time-assumptions trap — the old assert on the 85412205.png
    //         fixture broke exactly this way once it passed 30d old). instead, upload a
    //         FRESH object right before the read (fresh mtime = now), under a dedicated
    //         tmp prefix so concurrent shards never perturb the demo/ or fixture
    //         asserts. this proves --since keeps a recently-modified object, hermetic
    //         and drift-free. mirrors aws.s3.get's TEST_TMP_PREFIX upload/cleanup.
    const TEST_RECENT_KEY = `${TEST_TMP_PREFIX}/recent.txt`;

    beforeAll(() => {
      execSync(
        `echo -n "recent" | aws s3 cp - s3://${TEST_BUCKET}/${TEST_RECENT_KEY}`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
      );
    });

    afterAll(() => {
      execSync(`aws s3 rm s3://${TEST_BUCKET}/${TEST_RECENT_KEY}`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    });

    when('[t0] skill lists with --since 1d', () => {
      const result = useThen('skill runs', () =>
        runSkill(`--env test --bucket ${TEST_BUCKET} --since 1d`),
      );

      then('it exits 0', () => {
        expect(result.exitCode).toBe(0);
      });

      then('it shows since filter in output', () => {
        expect(result.stdout).toContain('since 1d');
      });

      then('it finds objects', () => {
        expect(result.stdout).toMatch(/found: \d+ objects/);
      });

      // the freshly-uploaded object is well within the 1d window, so --since must
      // keep it — a drift-free proof that the recency filter retains in-window objects.
      then('it finds the freshly-uploaded object', () => {
        expect(result.stdout).toContain(TEST_RECENT_KEY);
      });
    });
  });

  given('[case17] list with --since filter that excludes all', () => {
    when('[t0] skill lists with --since 1m (very recent)', () => {
      const result = useThen('skill runs', () =>
        runSkill(`--env test --uri s3://${TEST_BUCKET}/demo/ --since 1m`),
      );

      then('it exits 0', () => {
        expect(result.exitCode).toBe(0);
      });

      then('it shows since filter in output', () => {
        expect(result.stdout).toContain('since 1m');
      });

      then('output matches snapshot', () => {
        expect(maskDynamicOutput(result.stdout)).toMatchSnapshot();
      });
    });
  });

  given('[case22] every object-list arm answers in the SAME SHAPE', () => {
    // .what = populated, prefix-absent, and filtered-to-empty all close the same way
    //
    // .why  = three of the four arms used to `exit 0` on their tree item alone, so an
    //         EMPTY result ended the run on `chartin course...` with no verdict while the
    //         populated arm closed with `🐈 smooth sailin!` and a count. the render shape
    //         depended on how many objects happened to be there.
    //
    //         a per-arm snapshot could not catch it: each arm's bytes were internally
    //         consistent, and no assertion compared one arm to another. only a clamp over
    //         the SET sees a shape that differs between siblings
    //         (rule.require.consistent-skill-contracts, at the render layer).
    when('[t0] the three arms are each run', () => {
      const populated = useThen('the populated arm runs', () =>
        runSkill(`--env test --uri s3://${TEST_BUCKET}/demo/`),
      );
      const absent = useThen('the prefix-absent arm runs', () =>
        runSkill(`--env test --uri s3://${TEST_BUCKET}/nonexistent-prefix/`),
      );
      const filtered = useThen('the all-filtered-out arm runs', () =>
        runSkill(`--env test --uri s3://${TEST_BUCKET}/demo/ --since 1m`),
      );

      then('all three exit 0', () => {
        expect(populated.exitCode).toBe(0);
        expect(absent.exitCode).toBe(0);
        expect(filtered.exitCode).toBe(0);
      });

      then('all three open a course phase and close a verdict phase', () => {
        for (const out of [populated, absent, filtered]) {
          const mascots = out.stdout
            .split('\n')
            .filter((line) => line.startsWith('🐈 '));
          expect(mascots).toEqual([
            '🐈 chartin course...',
            '🐈 smooth sailin!',
          ]);
        }
      });

      then('all three close on a counted verdict', () => {
        for (const out of [populated, absent, filtered]) {
          const lines = out.stdout.split('\n').filter((line) => line !== '');
          expect(lines.at(-1)).toMatch(/^ {3}└─ \d+ objects/);
        }
      });

      then('the empty arms report a count of zero, never a blank', () => {
        expect(absent.stdout).toContain('   └─ 0 objects');
        expect(filtered.stdout).toContain('   └─ 0 objects (since 1m)');
      });
    });
  });
});
