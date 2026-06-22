import { ConstraintError } from 'helpful-errors';
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
const TEST_FILE_CONTENT = 'hi';
const TEST_PNG_KEY = '85412205.png';
const TEST_GZ_KEY = 'demo/test-compressed.txt.gz';
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

/**
 * helper to mask dynamic parts of output for stable snapshots
 */
const maskDynamicOutput = (output: string): string => {
  return (
    output
      // strip ANSI escape codes (terminal dim, reset, colors, etc.)
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b\[[0-9;]*m/g, '')
      .replace(/asof=\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/g, 'asof=TIMESTAMP')
      .replace(/\(\d+ Bytes\/s\)/g, '(X Bytes/s)')
      .replace(/Completed \d+ Bytes\/\d+ Bytes/g, 'Completed X Bytes/X Bytes')
  );
};

/**
 * .what = helper to unlock keyrack for test env
 * .why = integration tests require aws credentials from keyrack
 */
const unlockKeyrack = (): void => {
  try {
    execSync('rhx keyrack unlock --owner ehmpath --env test', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (error) {
    throw new ConstraintError('keyrack unlock failed', {
      hint: 'run: rhx keyrack unlock --owner ehmpath --env test',
      cause: error instanceof Error ? error : undefined,
    });
  }
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
    // .note = clears AWS env vars and uses nonexistent env to test keyrack failure path
    when('[t0] skill runs without prior unlock', () => {
      const result = useThen('skill runs', () =>
        runSkill(
          `--env nonexistent --bucket ${TEST_BUCKET} --key ${TEST_FILE_KEY}`,
          {
            withoutAwsCredentials: true,
          },
        ),
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
        runSkill('--bucket test-bucket --key test.txt'),
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

  given('[case6] absent --bucket and --uri', () => {
    when('[t0] skill runs without bucket or uri', () => {
      const result = useThen('skill runs', () => runSkill('--env test'));

      then('it exits 2 (constraint)', () => {
        expect(result.exitCode).toBe(2);
      });

      then('it shows belay that', () => {
        expect(result.stderr).toContain('belay that');
      });

      then('it mentions bucket or uri required', () => {
        expect(result.stderr).toContain('--uri or --bucket required');
      });

      then('error output matches snapshot', () => {
        expect(result.stderr).toMatchSnapshot();
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

  given('[case8] --uri without key (just bucket)', () => {
    when('[t0] skill runs with uri that has no key', () => {
      const result = useThen('skill runs', () =>
        runSkill('--env test --uri s3://bucket/'),
      );

      then('it exits 2 (constraint)', () => {
        expect(result.exitCode).toBe(2);
      });

      then('it shows belay that', () => {
        expect(result.stderr).toContain('belay that');
      });

      then('it mentions key required', () => {
        expect(result.stderr).toContain('invalid --uri format');
      });

      then('error output matches snapshot', () => {
        expect(result.stderr).toMatchSnapshot();
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

  given('[case17] --bucket provided without --key', () => {
    when('[t0] skill runs with --bucket but no --key', () => {
      const result = useThen('skill runs', () =>
        runSkill('--env test --bucket test-bucket'),
      );

      then('it exits 2 (constraint)', () => {
        expect(result.exitCode).toBe(2);
      });

      then('it shows belay that', () => {
        expect(result.stderr).toContain('belay that');
      });

      then('it mentions key required', () => {
        expect(result.stderr).toContain('--uri or --key required');
      });

      then('error output matches snapshot', () => {
        expect(result.stderr).toMatchSnapshot();
      });
    });
  });

  // ============================================================
  // fetch file that exists
  // ============================================================

  given('[case10] fetch file that exists via --uri', () => {
    beforeAll(() => {
      unlockKeyrack();
    });

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
    beforeAll(() => {
      unlockKeyrack();
    });

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
    beforeAll(() => {
      unlockKeyrack();
    });

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
    beforeAll(() => {
      unlockKeyrack();
    });

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
    beforeAll(() => {
      unlockKeyrack();
    });

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
    beforeAll(() => {
      unlockKeyrack();
    });

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
    const TEST_EMPTY_KEY = 'demo/empty-file-for-test.txt';

    beforeAll(() => {
      unlockKeyrack();
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
      unlockKeyrack();
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
