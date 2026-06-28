import { genTempDir, given, then, useThen, when } from 'test-fns';

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
      // mask timestamps
      .replace(/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z/g, 'TIMESTAMP')
      .replace(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/g, 'YYYY-MM-DD HH:MM:SS')
      // mask genTempDir paths (contain timestamps and random suffixes)
      .replace(
        /genTempDir\.symlink\/[^\s/]+/g,
        'genTempDir.symlink/MASKED_TEMPDIR',
      )
      // strip bash_aliases errors (occur when HOME is isolated for test)
      .replace(/\/[^\n]*\.bash_aliases:[^\n]*No such file or directory\n/g, '')
  );
};

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
  options?: { withoutAwsCredentials?: boolean; isolatedHome?: string },
): { stdout: string; stderr: string; exitCode: number } => {
  const skillPath = `${__dirname}/aws.cloudwatch.logs.query.sh`;

  // build env, optionally remove AWS credentials to test keyrack failure
  const env = { ...process.env };
  if (options?.withoutAwsCredentials) {
    delete env.AWS_ACCESS_KEY_ID;
    delete env.AWS_SECRET_ACCESS_KEY;
    delete env.AWS_SESSION_TOKEN;
    delete env.AWS_PROFILE;
  }
  if (options?.isolatedHome) {
    env.HOME = options.isolatedHome;
  }

  try {
    const stdout = execSync(`bash "${skillPath}" ${args}`, {
      // .note = 'encoding' is Node.js execSync API parameter name (external boundary)
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

describe('aws.cloudwatch.logs.query', () => {
  // ============================================================
  // help flag variants
  // ============================================================

  given('[case1] --help flag', () => {
    when('[t0] --help is passed', () => {
      const result = useThen('skill runs', () => runSkill('--help'));

      then('it exits 0', () => {
        expect(result.exitCode).toBe(0);
      });

      then('it shows crystal ball artifact', () => {
        expect(result.stdout).toContain('🔮');
      });

      then('it shows skill name', () => {
        expect(result.stdout).toContain('aws.cloudwatch.logs.query');
      });

      then('it shows --env option', () => {
        expect(result.stdout).toContain('--env');
      });

      then('it shows --lambda option', () => {
        expect(result.stdout).toContain('--lambda');
      });

      then('it shows --list option', () => {
        expect(result.stdout).toContain('--list');
      });

      then('it shows --tail option', () => {
        expect(result.stdout).toContain('--tail');
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

      then('it shows skill name', () => {
        expect(result.stdout).toContain('aws.cloudwatch.logs.query');
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

      then('it shows skill name', () => {
        expect(result.stdout).toContain('aws.cloudwatch.logs.query');
      });

      then('help output matches snapshot', () => {
        expect(result.stdout).toMatchSnapshot();
      });
    });
  });

  // ============================================================
  // constraint errors (exit 2)
  // ============================================================

  given('[case4] absent --env', () => {
    when('[t0] skill runs without --env', () => {
      const result = useThen('skill runs', () => runSkill('--list'));

      then('it exits 2 (constraint)', () => {
        expect(result.exitCode).toBe(2);
      });

      then('it shows belay that', () => {
        expect(result.stdout).toContain('belay that');
      });

      then('it mentions --env required', () => {
        expect(result.stdout).toContain('absent required arg');
        expect(result.stdout).toContain('--env');
      });

      then('error output matches snapshot', () => {
        expect(result.stdout).toMatchSnapshot();
      });
    });
  });

  given('[case5] invalid --env value', () => {
    when('[t0] skill runs with --env invalid', () => {
      const result = useThen('skill runs', () =>
        runSkill('--env invalid --list'),
      );

      then('it exits 2 (constraint)', () => {
        expect(result.exitCode).toBe(2);
      });

      then('it shows belay that', () => {
        expect(result.stdout).toContain('belay that');
      });

      then('it mentions invalid env', () => {
        expect(result.stdout).toContain('invalid env');
      });

      then('it shows valid options', () => {
        expect(result.stdout).toContain('test, prep, or prod');
      });

      then('error output matches snapshot', () => {
        expect(result.stdout).toMatchSnapshot();
      });
    });
  });

  given('[case6] unknown option', () => {
    when('[t0] skill runs with --unknown-flag', () => {
      const result = useThen('skill runs', () =>
        runSkill('--env test --unknown-flag'),
      );

      then('it exits 2 (constraint)', () => {
        expect(result.exitCode).toBe(2);
      });

      then('it shows belay that', () => {
        expect(result.stdout).toContain('belay that');
      });

      then('it mentions unknown option', () => {
        expect(result.stdout).toContain('unknown option');
      });

      then('error output matches snapshot', () => {
        expect(result.stdout).toMatchSnapshot();
      });
    });
  });

  // ============================================================
  // credential errors (exit 1)
  // ============================================================

  given('[case7] credentials not unlocked', () => {
    // .note = isolate HOME so keyrack can't find cached credentials
    const fakeHome = genTempDir({ slug: 'case7-no-keyrack' });

    when('[t0] skill runs without prior unlock', () => {
      const result = useThen('skill runs', () =>
        runSkill('--env test --list', {
          withoutAwsCredentials: true,
          isolatedHome: fakeHome,
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
  // list mode with real credentials
  // ============================================================

  given('[case8] list mode with test env', () => {
    when('[t0] skill lists log groups for test env', () => {
      const result = useThen('skill runs', () => runSkill('--env test --list'));

      then('it exits 0', () => {
        expect(result.exitCode).toBe(0);
      });

      then('it shows chartin course', () => {
        expect(result.stdout).toContain('chartin course');
      });

      then('it shows crystal ball artifact', () => {
        expect(result.stdout).toContain('🔮');
      });

      then('it shows log groups for env', () => {
        expect(result.stdout).toContain('log groups for');
      });

      then('test env does not show alias hint', () => {
        // test env has no alias, should not mention historic alias
        expect(result.stdout).not.toContain('includes historic');
      });

      then('output matches snapshot', () => {
        expect(maskDynamicOutput(result.stdout)).toMatchSnapshot();
      });
    });
  });

  given('[case9] list mode with prod env', () => {
    when('[t0] skill lists log groups for prod env', () => {
      const result = useThen('skill runs', () => runSkill('--env prod --list'));

      then('it exits 0', () => {
        expect(result.exitCode).toBe(0);
      });

      then('it shows chartin course', () => {
        expect(result.stdout).toContain('chartin course');
      });

      then('prod env does not show alias hint', () => {
        // prod env has no alias, should not mention historic alias
        expect(result.stdout).not.toContain('includes historic');
      });

      then('output matches snapshot', () => {
        expect(maskDynamicOutput(result.stdout)).toMatchSnapshot();
      });
    });
  });

  given('[case10] list mode with prep env', () => {
    // .note = prep env checks both -prep and -dev suffixes
    //         alias hint shown only if -dev groups found
    when('[t0] skill lists log groups for prep env', () => {
      const result = useThen('skill runs', () => runSkill('--env prep --list'));

      then('it exits 0', () => {
        expect(result.exitCode).toBe(0);
      });

      then('it shows chartin course', () => {
        expect(result.stdout).toContain('chartin course');
      });

      // the alias hint behavior is conditional:
      // - if -dev groups exist, shows "(includes historic -dev alias)"
      // - if only -prep groups exist, does NOT show alias hint
      // we verify the output structure is valid either way
      then('it shows log groups header', () => {
        expect(result.stdout).toContain('log groups for');
      });

      then('output matches snapshot', () => {
        expect(maskDynamicOutput(result.stdout)).toMatchSnapshot();
      });
    });
  });

  // ============================================================
  // tail mode constraint (must specify --lambda)
  // ============================================================
  // .note = --tail positive path cannot be tested via snapshot because
  //         `aws logs tail --follow` runs indefinitely until Ctrl+C.
  //         the constraint tests below verify CLI structure for --tail.
  //         positive path verification requires manual test.

  given('[case11] --tail without --lambda', () => {
    // .note = tail mode requires a single log group, must specify --lambda
    when('[t0] skill runs with --tail but no --lambda', () => {
      const result = useThen('skill runs', () => runSkill('--env test --tail'));

      then('it exits 2 (constraint)', () => {
        expect(result.exitCode).toBe(2);
      });

      then('it shows belay that', () => {
        expect(result.stdout).toContain('belay that');
      });

      then('it mentions --tail requires --lambda', () => {
        expect(result.stdout).toContain('--tail requires --lambda');
      });

      then('error output matches snapshot', () => {
        expect(result.stdout).toMatchSnapshot();
      });
    });
  });

  given('[case12] --tail without --lambda in prep env', () => {
    // .note = --tail requires --lambda; this is validated upfront before any aws
    //         calls, so the env only affects the hint line. verifies the constraint
    //         fails fast (no log-group search) regardless of env.
    when('[t0] skill runs with --tail but no --lambda', () => {
      const result = useThen('skill runs', () => runSkill('--env prep --tail'));

      then('it exits 2 (constraint)', () => {
        expect(result.exitCode).toBe(2);
      });

      then('it shows belay that', () => {
        expect(result.stdout).toContain('belay that');
      });

      then('it shows --tail requires --lambda', () => {
        expect(result.stdout).toContain('--tail requires --lambda');
      });

      then('its hint references the prep env', () => {
        expect(result.stdout).toContain('--env prep --lambda');
      });

      then('error output matches snapshot', () => {
        expect(result.stdout).toMatchSnapshot();
      });
    });
  });

  // ============================================================
  // query mode (single lambda)
  // ============================================================

  given('[case13] query mode with nonexistent lambda', () => {
    when('[t0] skill queries nonexistent lambda', () => {
      const result = useThen('skill runs', () =>
        runSkill('--env test --lambda nonexistent-lambda-name-xyz'),
      );

      then('it exits 2 (constraint)', () => {
        expect(result.exitCode).toBe(2);
      });

      then('it shows belay that', () => {
        expect(result.stdout).toContain('belay that');
      });

      then('it mentions log group not found', () => {
        expect(result.stdout).toContain('log group not found');
      });

      then('it shows available log groups', () => {
        expect(result.stdout).toContain('available log groups');
      });

      then('error output matches snapshot', () => {
        expect(maskDynamicOutput(result.stdout)).toMatchSnapshot();
      });
    });
  });

  given('[case14] query mode with nonexistent lambda in prep env', () => {
    // .note = prep env searches both -prep and -dev suffixes; with no match it
    //         reports not-found and lists the available prep groups
    when('[t0] skill queries nonexistent lambda', () => {
      const result = useThen('skill runs', () =>
        runSkill('--env prep --lambda nonexistent-lambda-name-xyz'),
      );

      then('it exits 2 (constraint)', () => {
        expect(result.exitCode).toBe(2);
      });

      then('it shows belay that', () => {
        expect(result.stdout).toContain('belay that');
      });

      then('it mentions log group not found', () => {
        expect(result.stdout).toContain('log group not found');
      });

      then('it shows available log groups', () => {
        expect(result.stdout).toContain('available log groups');
      });

      then('error output matches snapshot', () => {
        expect(maskDynamicOutput(result.stdout)).toMatchSnapshot();
      });
    });
  });

  // ============================================================
  // --since format validation
  // ============================================================

  given('[case15] invalid --since format', () => {
    when('[t0] skill runs with --since abc', () => {
      const result = useThen('skill runs', () =>
        runSkill('--env test --lambda foo --since abc'),
      );

      then('it exits 2 (constraint)', () => {
        expect(result.exitCode).toBe(2);
      });

      then('it shows belay that', () => {
        const combined = result.stdout + result.stderr;
        expect(combined).toContain('belay that');
      });

      then('it mentions invalid --since', () => {
        const combined = result.stdout + result.stderr;
        expect(combined).toContain('--since');
      });

      then('it shows valid formats', () => {
        const combined = result.stdout + result.stderr;
        expect(combined).toContain('5m, 1h, 2d');
      });

      then('error output matches snapshot', () => {
        const combined = result.stdout + result.stderr;
        expect(maskDynamicOutput(combined)).toMatchSnapshot();
      });
    });
  });

  // ============================================================
  // query mode positive path
  // ============================================================

  given('[case16] query mode with valid lambda', () => {
    // .note = queries a real lambda to verify positive path structure
    //         uses --filter to narrow results, actual log content
    //         goes to cache files (not snapped since content is dynamic)
    when('[t0] skill queries all log groups', () => {
      const result = useThen('skill runs', () =>
        runSkill(
          '--env test --filter "UNLIKELY_MATCH_STRING_xyz123" --since 5m --limit 10',
        ),
      );

      then('it exits 0', () => {
        expect(result.exitCode).toBe(0);
      });

      then('it shows chartin course', () => {
        expect(result.stdout).toContain('chartin course');
      });

      then('it shows log group info', () => {
        expect(result.stdout).toContain('log group');
      });

      then('it shows caught it (success)', () => {
        expect(result.stdout).toContain('caught it');
      });

      then('output structure matches snapshot', () => {
        // mask dynamic content (timestamps, file paths, query dots)
        const masked = maskDynamicOutput(result.stdout)
          // mask query progress dots (variable count)
          .replace(/\.\.\./g, '...')
          .replace(/\.+\n/g, '...\n')
          // mask cache file paths with timestamps
          .replace(
            /\.agent\/\.cache\/[^\n]+/g,
            '.agent/.cache/MASKED_CACHE_PATH',
          );
        expect(masked).toMatchSnapshot();
      });
    });
  });

  given('[case17] query mode with prep env', () => {
    // .note = uses a prefix guaranteed to have no log groups so the multi-group
    //         "no log groups found" path is deterministic regardless of which
    //         lambdas are deployed. prep still searches both -prep and -dev.
    when('[t0] skill queries all log groups', () => {
      const result = useThen('skill runs', () =>
        runSkill(
          '--env prep --prefix nonexistent-svc-xyz --filter "UNLIKELY_MATCH_STRING_xyz123" --since 5m --limit 10',
        ),
      );

      then('it exits 2 (no log groups)', () => {
        expect(result.exitCode).toBe(2);
      });

      then('it shows belay that', () => {
        expect(result.stdout).toContain('belay that');
      });

      then('it shows no log groups found', () => {
        expect(result.stdout).toContain('no log groups found');
      });

      then('output structure matches snapshot', () => {
        const masked = maskDynamicOutput(result.stdout)
          .replace(/\.\.\./g, '...')
          .replace(/\.+\n/g, '...\n')
          .replace(
            /\.agent\/\.cache\/[^\n]+/g,
            '.agent/.cache/MASKED_CACHE_PATH',
          );
        expect(masked).toMatchSnapshot();
      });
    });
  });
});
