import { given, then, useThen, when } from 'test-fns';

import { execSync } from 'node:child_process';

/**
 * test bucket prepared with known objects:
 * - 85412205.png (4806 bytes)
 * - demo/ (0 bytes, folder marker)
 * - demo/date=2026-06-21/ (0 bytes, folder marker)
 * - demo/date=2026-06-21/hello.md (2 bytes, content: "hi")
 *
 * note: .gz test file is created/cleaned up by case15 test itself
 */
const TEST_BUCKET = 'rhachet-roles-ghlitch-test';
const TEST_FILE_KEY = 'demo/date=2026-06-21/hello.md';
const TEST_PNG_KEY = '85412205.png';
// .note = temp files live under a dedicated prefix (NOT demo/, NOT bucket fixtures)
//         so concurrent aws.s3.list shards never count them in demo/ or fixture assertions
const TEST_TMP_PREFIX = 'tmp-itest-get';
const TEST_GZ_KEY = `${TEST_TMP_PREFIX}/test-compressed.txt.gz`;
const TEST_GZ_CONTENT = 'compressed content for test';

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
  const skillPath = `${__dirname}/aws.s3.get.sh`;

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
      .replace(/\(\d+ Bytes\/s\)/g, '(X Bytes/s)')
      .replace(/Completed \d+ Bytes\/\d+ Bytes/g, 'Completed X Bytes/X Bytes')
  );
};

describe('aws.s3.get', () => {
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
        expect(result.stdout).toContain('aws.s3.get');
      });

      then('it shows --env option', () => {
        expect(result.stdout).toContain('--env');
      });

      then('it shows --uri option', () => {
        expect(result.stdout).toContain('--uri');
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
        runSkill(`--env prep --bucket ${TEST_BUCKET} --key ${TEST_FILE_KEY}`, {
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
   *        artifact header, tree). a human who learned that block on any other skill could
   *        not scan this one, and a caller who captured stdout saw an empty run
   *        (rule.require.consistent-skill-contracts).
   *
   * .note = the stream change is clamped deliberately, with a negative control on stderr —
   *         without it a belay written to BOTH streams would satisfy the positive and still
   *         be wrong.
   */
  given('[case5] absent --env', () => {
    when('[t0] skill runs without --env', () => {
      const result = useThen('skill runs', () =>
        runSkill('--bucket test-bucket --key test.txt'),
      );

      then('it exits 2 (constraint)', () => {
        expect(result.exitCode).toBe(2);
      });

      then('it belays on stdout, in the kin four-line block', () => {
        expect(result.stdout).toContain('🐈 belay that...');
        expect(result.stdout).toContain('🔮 aws.s3.get');
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

  given('[case6] absent --bucket and --uri', () => {
    when('[t0] skill runs without bucket or uri', () => {
      const result = useThen('skill runs', () => runSkill('--env test'));

      then('it exits 2 (constraint)', () => {
        expect(result.exitCode).toBe(2);
      });

      then('it mentions bucket or uri required', () => {
        expect(result.stdout).toContain(
          'absent required arg: --uri or --bucket',
        );
      });

      then('error output matches snapshot', () => {
        expect(result.stdout).toMatchSnapshot();
      });
    });
  });

  given('[case7] invalid --uri format (not s3://)', () => {
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
        expect(result.stdout).toContain('   └─ must be: s3://bucket/key');
      });

      then('error output matches snapshot', () => {
        expect(result.stdout).toMatchSnapshot();
      });
    });
  });

  given('[case8] --uri without key (just bucket)', () => {
    when('[t0] skill runs with uri that has no key', () => {
      const result = useThen('skill runs', () =>
        runSkill('--env test --uri s3://bucket/'),
      );

      then('it exits 2 (constraint)', () => {
        expect(result.exitCode).toBe(2);
      });

      then('it mentions the uri is not a whole key path', () => {
        expect(result.stdout).toContain('invalid --uri: s3://bucket/');
      });

      then('error output matches snapshot', () => {
        expect(result.stdout).toMatchSnapshot();
      });
    });
  });

  given('[case9] unknown option', () => {
    when('[t0] skill runs with --unknown-flag', () => {
      const result = useThen('skill runs', () =>
        runSkill('--env test --bucket test --key test.txt --unknown-flag'),
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

  given('[case17] --bucket provided without --key', () => {
    when('[t0] skill runs with --bucket but no --key', () => {
      const result = useThen('skill runs', () =>
        runSkill('--env test --bucket test-bucket'),
      );

      then('it exits 2 (constraint)', () => {
        expect(result.exitCode).toBe(2);
      });

      then('it mentions key required', () => {
        expect(result.stdout).toContain('absent required arg: --uri or --key');
      });

      then('error output matches snapshot', () => {
        expect(result.stdout).toMatchSnapshot();
      });
    });
  });

  given('[case19] --env names an env this skill does not serve', () => {
    when('[t0] skill runs with --env prd', () => {
      const result = useThen('skill runs', () =>
        runSkill('--env prd --bucket test --key test.txt'),
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

  given('[case20] a flag is passed with no value', () => {
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
        runSkill('--env test --bucket --key x'),
      );

      /**
       * absent this guard `--bucket` would take `--key` as its value and eat the flag
       * whole, so the run would belay about an absent `--key` — the WRONG flag.
       */
      then('the belay names the flag that was actually starved', () => {
        expect(result.exitCode).toBe(2);
        expect(result.stdout).toContain('absent value for --bucket');
      });
    });
  });

  // ============================================================
  // fetch file that exists
  // ============================================================

  given('[case10] fetch file that exists via --uri', () => {
    when('[t0] skill fetches hello.md', () => {
      const result = useThen('skill runs', () =>
        runSkill(`--env test --uri s3://${TEST_BUCKET}/${TEST_FILE_KEY}`),
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

      then('it shows chartin course', () => {
        expect(result.stdout).toContain('chartin course');
      });

      then('it shows the file key', () => {
        expect(result.stdout).toContain('hello.md');
      });

      then('it shows preview section', () => {
        expect(result.stdout).toContain('└─ preview');
        expect(result.stdout).toContain('├─');
        expect(result.stdout).toContain('└─');
      });

      then('it shows smooth sailin', () => {
        expect(result.stdout).toContain('smooth sailin');
      });

      then('output matches snapshot', () => {
        expect(maskDynamicOutput(result.stdout)).toMatchSnapshot();
      });
    });
  });

  given('[case11] fetch file via --bucket and --key', () => {
    when('[t0] skill fetches hello.md via separate flags', () => {
      const result = useThen('skill runs', () =>
        runSkill(`--env test --bucket ${TEST_BUCKET} --key ${TEST_FILE_KEY}`),
      );

      then('it exits 0', () => {
        expect(result.exitCode).toBe(0);
      });

      then('it shows bucket in output', () => {
        expect(result.stdout).toContain(TEST_BUCKET);
      });

      then('output matches snapshot', () => {
        expect(maskDynamicOutput(result.stdout)).toMatchSnapshot();
      });
    });
  });

  given('[case12] fetch binary file (png)', () => {
    when('[t0] skill fetches png file', () => {
      const result = useThen('skill runs', () =>
        runSkill(`--env test --uri s3://${TEST_BUCKET}/${TEST_PNG_KEY}`),
      );

      then('it exits 0', () => {
        expect(result.exitCode).toBe(0);
      });

      then('it shows the png key', () => {
        expect(result.stdout).toContain(TEST_PNG_KEY);
      });

      then('it shows cached path', () => {
        expect(result.stdout).toContain('cached:');
      });

      then('it shows binary file indicator (no preview)', () => {
        expect(result.stdout).toContain('(binary file)');
        expect(result.stdout).not.toContain('preview');
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
  // fetch file that does not exist
  // ============================================================

  given('[case13] fetch file that does not exist', () => {
    when('[t0] skill fetches nonexistent file', () => {
      const result = useThen('skill runs', () =>
        runSkill(
          `--env test --uri s3://${TEST_BUCKET}/nonexistent-file-12345.txt`,
        ),
      );

      then('it exits 1 (malfunction)', () => {
        expect(result.exitCode).toBe(1);
      });

      then('it shows cat mascot', () => {
        expect(result.stdout).toContain('🐈');
      });

      then('it shows wet paws', () => {
        const combined = result.stdout + result.stderr;
        expect(combined).toContain('wet paws');
      });

      then('error output matches snapshot', () => {
        const combined = result.stdout + result.stderr;
        expect(maskDynamicOutput(combined)).toMatchSnapshot();
      });
    });
  });

  given('[case14] fetch from nonexistent bucket', () => {
    when('[t0] skill fetches from fake bucket', () => {
      const result = useThen('skill runs', () =>
        runSkill(
          '--env test --uri s3://nonexistent-bucket-xyz-12345/some-file.txt',
        ),
      );

      then('it exits 1 (malfunction)', () => {
        expect(result.exitCode).toBe(1);
      });

      then('it shows wet paws', () => {
        const combined = result.stdout + result.stderr;
        expect(combined).toContain('wet paws');
      });

      then('error output matches snapshot', () => {
        const combined = result.stdout + result.stderr;
        expect(maskDynamicOutput(combined)).toMatchSnapshot();
      });
    });
  });

  // ============================================================
  // fetch with deep path
  // ============================================================

  given('[case15] fetch file with nested path', () => {
    when('[t0] skill fetches file in nested folder', () => {
      const result = useThen('skill runs', () =>
        runSkill(`--env test --uri s3://${TEST_BUCKET}/${TEST_FILE_KEY}`),
      );

      then('it exits 0', () => {
        expect(result.exitCode).toBe(0);
      });

      then('it handles the nested path', () => {
        expect(result.stdout).toContain('demo');
        expect(result.stdout).toContain('date=2026-06-21');
        expect(result.stdout).toContain('hello.md');
      });

      then('output matches snapshot', () => {
        expect(maskDynamicOutput(result.stdout)).toMatchSnapshot();
      });
    });
  });

  // ============================================================
  // fetch empty file (0 bytes)
  // ============================================================

  given('[case18] fetch empty file (0 bytes)', () => {
    const TEST_EMPTY_KEY = `${TEST_TMP_PREFIX}/empty-file-for-test.txt`;

    beforeAll(() => {
      // create empty file in test bucket
      execSync(
        `echo -n "" | aws s3 cp - s3://${TEST_BUCKET}/${TEST_EMPTY_KEY}`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
      );
    });

    afterAll(() => {
      // cleanup empty test file
      execSync(`aws s3 rm s3://${TEST_BUCKET}/${TEST_EMPTY_KEY}`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    });

    when('[t0] skill fetches empty file (0 bytes)', () => {
      const result = useThen('skill runs', () =>
        runSkill(`--env test --uri s3://${TEST_BUCKET}/${TEST_EMPTY_KEY}`),
      );

      then('it exits 0', () => {
        expect(result.exitCode).toBe(0);
      });

      then('it shows cat mascot', () => {
        expect(result.stdout).toContain('🐈');
      });

      then('it shows chartin course', () => {
        expect(result.stdout).toContain('chartin course');
      });

      then('it shows cached path', () => {
        expect(result.stdout).toContain('cached:');
      });

      then('it shows smooth sailin (no content output for empty file)', () => {
        expect(result.stdout).toContain('smooth sailin');
      });

      then('output matches snapshot', () => {
        expect(maskDynamicOutput(result.stdout)).toMatchSnapshot();
      });
    });
  });

  // ============================================================
  // auto-gunzip .gz files
  // ============================================================

  given('[case16] fetch and auto-gunzip .gz file', () => {
    beforeAll(() => {
      // create and upload .gz test file
      execSync(
        `echo "${TEST_GZ_CONTENT}" | gzip | aws s3 cp - s3://${TEST_BUCKET}/${TEST_GZ_KEY}`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
      );
    });

    afterAll(() => {
      // cleanup .gz test file
      execSync(`aws s3 rm s3://${TEST_BUCKET}/${TEST_GZ_KEY}`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    });

    when('[t0] skill fetches a .gz file', () => {
      const result = useThen('skill runs', () =>
        runSkill(`--env test --uri s3://${TEST_BUCKET}/${TEST_GZ_KEY}`),
      );

      then('it exits 0', () => {
        expect(result.exitCode).toBe(0);
      });

      then('it shows cat mascot', () => {
        expect(result.stdout).toContain('🐈');
      });

      then('it shows cached path without .gz extension', () => {
        expect(result.stdout).toContain('cached:');
        expect(result.stdout).toContain('.txt');
      });

      then('it shows preview with decompressed content', () => {
        expect(result.stdout).toContain('└─ preview');
        expect(result.stdout).toContain(TEST_GZ_CONTENT);
      });

      then('it shows smooth sailin', () => {
        expect(result.stdout).toContain('smooth sailin');
      });

      then('output matches snapshot', () => {
        expect(maskDynamicOutput(result.stdout)).toMatchSnapshot();
      });
    });
  });
});
