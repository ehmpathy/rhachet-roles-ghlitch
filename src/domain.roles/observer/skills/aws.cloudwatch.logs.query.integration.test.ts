import { genTempDir, given, then, useThen, when } from 'test-fns';

import { execSync } from 'node:child_process';
import { expectNoStrayLines } from '../../.test/expectNoStrayLines';

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
      // mask absolute repo-root prefix on cache paths (varies: local home vs ci runner)
      .replace(
        /\/\S*\/\.agent\/\.cache\/\S+/g,
        '.agent/.cache/MASKED_CACHE_PATH',
      )
      // strip bash_aliases errors (occur when HOME is isolated for test)
      .replace(/\/[^\n]*\.bash_aliases:[^\n]*No such file or directory\n/g, '')
  );
};

/**
 * .what = collapse a log-group INVENTORY into one placeholder, and leave the tree
 *         around it verbatim
 *
 * .why  = a prep-env snapshot that pins the inventory pins a SHARED aws account's
 *         live deploy state. this repo owns the name convention
 *         (`rhachet-roles-ghlitch-prep-*`) but NOT whether prep happens to be
 *         deployed right now — a lambda is torn down, a retention window lapses, and
 *         a suite this wish never touched goes red. that is the same defect the s3
 *         bucket-inventory mask was cut for, one service over
 *         (rule.require.hermetic-tests).
 *
 *         cut along the OWNERSHIP line, exactly as the s3 fix was:
 *         - `--env test` inventory stays VERBATIM. this repo provisions those groups
 *           itself (`rhx aws.lambda.invoke` exists for precisely that), so their
 *           presence is a fact it controls and must continue to assert.
 *         - `--env prep` inventory is masked. no fixture in this repo guarantees it,
 *           so its contents are not ours to pin.
 *
 * .note = a resnap is the WRONG fix here twice over: it would pin `(none)` as the
 *         expected bytes, and redden again the moment anyone deploys prep.
 *
 * .note = if the header is absent the output falls through UNMASKED, so a render that
 *         lost its inventory section reddens rather than passes behind a placeholder.
 *         a mask may narrow what is asserted, never fabricate what is absent.
 */
const maskUnownedLogGroupInventory = (output: string): string => {
  const lines = output.split('\n');
  const headerAt = lines.findIndex(
    (line) =>
      line.includes('log groups for') || line.includes('available log groups'),
  );
  if (headerAt === -1) return output;

  // the inventory is the run of entry lines directly under the header, drawn one
  // tree level deeper (6 spaces vs the header's 3)
  const isEntry = (line: string): boolean => /^ {6}[├└]─ /.test(line);
  const firstEntry = headerAt + 1;
  let afterEntries = firstEntry;
  while (afterEntries < lines.length && isEntry(lines[afterEntries] as string))
    afterEntries += 1;
  if (afterEntries === firstEntry) return output;

  return [
    ...lines.slice(0, firstEntry),
    '      └─ <LOG GROUPS OF THIS SHARED ACCOUNT, AS DEPLOYED>',
    ...lines.slice(afterEntries),
  ].join('\n');
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
  options?: {
    withoutAwsCredentials?: boolean;
    withRejectedAwsCredentials?: boolean;
    isolatedHome?: string;
  },
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
  // .what = hand the skill a well-formed key that aws will REJECT
  //
  // .why  = this is the only way to reach the branch where a `describe-log-groups`
  //         call fails MID-TREE. absent credentials belay at the keyrack gate long
  //         before any aws call (case7); valid credentials always succeed. a
  //         syntactically valid key that the service refuses walks past the gate
  //         (the skill skips keyrack whenever AWS_ACCESS_KEY_ID is set) and then
  //         fails at the api — exactly the shape the repaired branch handles.
  //
  // .note = the key below is aws's own published documentation example. it grants
  //         no access to any account and is not a secret.
  if (options?.withRejectedAwsCredentials) {
    delete env.AWS_PROFILE;
    env.AWS_ACCESS_KEY_ID = 'AKIAIOSFODNN7EXAMPLE';
    env.AWS_SECRET_ACCESS_KEY = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
    delete env.AWS_SESSION_TOKEN;
    env.AWS_REGION = 'us-east-1';
    env.AWS_DEFAULT_REGION = 'us-east-1';
  }
  if (options?.isolatedHome) {
    env.HOME = options.isolatedHome;
  }

  // the host's shell rc must not load into a run — an rc-defined FUNCTION or ALIAS beats
  // PATH outright, so it cannot be shadowed by a stub. BASH_ENV is the vector that carries
  // one into a NON-interactive bash, and this host has it set (rule.require.hermetic-tests).
  delete env.BASH_ENV;

  try {
    const stdout = execSync(`bash --noprofile --norc "${skillPath}" ${args}`, {
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

      then('it renders an inventory line under the header', () => {
        // the fact the mask drops, kept pinned on the RAW stdout: whatever the shared
        // prep account currently holds, the render must draw a leaf for it — either a
        // real group or the `(none)` marker. this is what keeps the mask honest.
        expect(result.stdout).toMatch(/ {6}[├└]─ \S/);
      });

      then('output matches snapshot', () => {
        // the inventory is masked — see maskUnownedLogGroupInventory for why prep is
        // masked while test stays verbatim.
        expect(
          maskUnownedLogGroupInventory(maskDynamicOutput(result.stdout)),
        ).toMatchSnapshot();
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
        // the lambda the CALLER asked for — ours, so it stays pinned verbatim
        expect(result.stdout).toContain('log group not found');
        expect(result.stdout).toContain('nonexistent-lambda-name-xyz');
      });

      then('it shows available log groups', () => {
        expect(result.stdout).toContain('available log groups');
      });

      then('it renders an inventory line under that header', () => {
        // the fact the mask drops, kept pinned on the RAW stdout
        expect(result.stdout).toMatch(/ {6}[├└]─ \S/);
      });

      then('error output matches snapshot', () => {
        // the inventory under `available log groups:` is the same shared prep state
        // as [case10]; mask it for the same reason. note [case13] is the SAME render
        // against --env test and is deliberately left unmasked — this repo provisions
        // the test groups itself, so there they are a fact it owns.
        expect(
          maskUnownedLogGroupInventory(maskDynamicOutput(result.stdout)),
        ).toMatchSnapshot();
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

      // the header count IS the tree count. this skill used to print the discovery block
      // under its own header, close that tree with `└─`, then reprint the header for the
      // query block — two trees for one mascot phase, which made every later depth a claim
      // about a tree that had already ended
      // (rule.require.nest-subskill-output-in-buckets, `.one header per MASCOT PHASE`).
      // a snapshot shows the reprint but a reader nods past it, so clamp it directly.
      then('it prints one artifact header per mascot phase', () => {
        const headers = result.stdout
          .split('\n')
          .filter((line) => line.startsWith('🔮 aws.cloudwatch.logs.query'));
        expect(headers).toEqual([
          '🔮 aws.cloudwatch.logs.query --env test',
          '🔮 aws.cloudwatch.logs.query',
        ]);
      });

      // the discovery item is a `├─` continuation of the one tree, never a `└─` close. the
      // negative control has the teeth: the close-form is exactly what the defect emitted.
      then(
        'the discovery item continues the tree rather than closes it',
        () => {
          expect(result.stdout).toContain(
            '   ├─ found 1 log group with prefix /aws/lambda/rhachet-roles-ghlitch-test',
          );
          expect(result.stdout).not.toContain(
            '   └─ found 1 log group with prefix /aws/lambda/rhachet-roles-ghlitch-test',
          );
        },
      );

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

  // ============================================================
  // a mid-tree aws failure
  // ============================================================

  given('[case18] the log-group inventory call is refused by aws', () => {
    // .note = this clamps the ONE branch where an aws call fails while a tree is
    //         already open. it used to render as
    //           `      (error: could not list -test log groups: ...)`
    //         straight to STDERR: a glyph-less line at 6 spaces, on the other
    //         stream than the tree it sat inside. a caller who captured stdout saw
    //         a silent gap; one who watched the terminal saw a bare line wedged
    //         among the children.
    when('[t0] skill searches for a lambda it cannot look up', () => {
      const result = useThen('skill runs', () =>
        runSkill('--env test --lambda echo', {
          withRejectedAwsCredentials: true,
        }),
      );

      then('it exits 2 (the group was not found)', () => {
        expect(result.exitCode).toBe(2);
      });

      then('the failure is reported on stdout, with the tree', () => {
        expect(result.stdout).toContain('could not list -test groups');
      });

      then('the failure is NOT split onto stderr', () => {
        expect(result.stderr).not.toContain('could not list');
      });

      then('the failure line wears a branch glyph', () => {
        const reported = result.stdout
          .split('\n')
          .filter((line) => line.includes('could not list'));
        expect(reported).toHaveLength(1);
        expect(reported[0]).toMatch(/^ {6}├─ could not list -test groups: /);
      });

      then('every line of the aws message wears one too', () => {
        // .note = an aws error is multi-line. the first repair glyphed only its
        //         first line and dropped the rest at column 0 — this is the clamp
        //         that caught it, and the one that keeps it caught.
        expectNoStrayLines({ out: result.stdout, artifact: '🔮' });
      });

      then('the tree still closes on the inventory, not on the failure', () => {
        const items = result.stdout
          .split('\n')
          .filter((line) => /^ {6}[├└]─ /.test(line));
        expect(items.at(-1)).toEqual('      └─ (none)');
      });

      then('output matches snapshot', () => {
        // the aws error text is the service's own wording and carries a request
        // id; pin the frame around it, not the message body
        const masked = maskDynamicOutput(result.stdout).replace(
          /(├─ could not list -\w+ groups: ).*$/gm,
          '$1<AWS SAID SO, VERBATIM>',
        );
        expect(masked).toMatchSnapshot();
      });
    });
  });
});
