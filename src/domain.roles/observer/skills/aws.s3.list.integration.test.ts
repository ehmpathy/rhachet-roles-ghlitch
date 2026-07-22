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

  try {
    const stdout = execSync(`bash "${skillPath}" ${args}`, {
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

      then('it shows list buckets usage', () => {
        expect(result.stdout).toContain('# list buckets');
      });

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
    // .note = clears AWS env vars and uses nonexistent env to test keyrack failure path
    when('[t0] skill runs without prior unlock', () => {
      const result = useThen('skill runs', () =>
        runSkill(`--env nonexistent --bucket ${TEST_BUCKET}`, {
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

  given('[case5] absent --env', () => {
    when('[t0] skill runs without --env', () => {
      const result = useThen('skill runs', () =>
        runSkill('--bucket test-bucket'),
      );

      then('it exits 2 (constraint)', () => {
        expect(result.exitCode).toBe(2);
      });

      then('it shows belay that', () => {
        expect(result.stderr).toContain('belay that');
      });

      then('it mentions --env required', () => {
        expect(result.stderr).toContain('--env required');
      });

      then('error output matches snapshot', () => {
        expect(result.stderr).toMatchSnapshot();
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

      then('it shows belay that', () => {
        expect(result.stderr).toContain('belay that');
      });

      then('it mentions invalid uri format', () => {
        expect(result.stderr).toContain('invalid --uri format');
      });

      then('error output matches snapshot', () => {
        expect(result.stderr).toMatchSnapshot();
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

      then('it shows belay that', () => {
        expect(result.stderr).toContain('belay that');
      });

      then('it mentions invalid --since', () => {
        expect(result.stderr).toContain('--since');
      });

      then('error output matches snapshot', () => {
        expect(result.stderr).toMatchSnapshot();
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

      then('it shows belay that', () => {
        expect(result.stderr).toContain('belay that');
      });

      then('it mentions unknown option', () => {
        expect(result.stderr).toContain('unknown option');
      });

      then('error output matches snapshot', () => {
        expect(result.stderr).toMatchSnapshot();
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
        expect(maskDynamicOutput(result.stdout)).toMatchSnapshot();
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
});
