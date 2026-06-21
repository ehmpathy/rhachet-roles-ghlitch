import { genTempDir, given, then, useBeforeAll, when } from 'test-fns';

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * .what = acceptance test for aws.postgres.query skill with TypeScript dispatch
 * .why = prove that .ts files are bundled, symlinked, and work end-to-end
 *
 * .ref = ehmpathy/rhachet-roles-ghlitch#13
 */
describe('aws.postgres.query', () => {
  given('[case1] rhachet roles available', () => {
    const scene = useBeforeAll(async () => {
      const tempDir = genTempDir({
        slug: 'aws-postgres-query-acceptance',
        git: true,
        clone: 'src/blackbox/.test/aws.postgres.query/fixture',
        symlink: [
          { at: 'node_modules', to: 'node_modules' },
          { at: 'package.json', to: 'package.json' },
          { at: 'provision', to: 'provision' },
        ],
      });

      // init rhachet roles (observer for query, operator for testdb)
      // .note = no keyrack unlock needed - fixture has hardcoded testdb connection
      const initOutput = execSync(
        'npx rhachet init --roles ghlitch/observer ghlitch/operator',
        {
          cwd: tempDir,
          encoding: 'utf8',
          stdio: 'pipe',
        },
      );

      // start testdb (required for t3 tests)
      execSync('npx rhx use.testdb', {
        cwd: tempDir,
        encoding: 'utf8',
        stdio: 'pipe',
        timeout: 120000,
      });

      return { tempDir, initOutput };
    });

    when('[t0] rhachet init is run', () => {
      then('it succeeds with output', () => {
        expect(scene.initOutput).toBeDefined();
        expect(scene.initOutput.length).toBeGreaterThan(0);
      });

      then('output contains ghlitch', () => {
        expect(scene.initOutput).toContain('ghlitch');
      });
    });

    when('[t1] skill files are checked', () => {
      then('aws.postgres.query.sh exists', () => {
        expect(
          existsSync(
            join(
              scene.tempDir,
              '.agent/repo=ghlitch/role=observer/skills/aws.postgres.query.sh',
            ),
          ),
        ).toBe(true);
      });

      then('aws.postgres.query.ts exists', () => {
        expect(
          existsSync(
            join(
              scene.tempDir,
              '.agent/repo=ghlitch/role=observer/skills/aws.postgres.query.ts',
            ),
          ),
        ).toBe(true);
      });
    });

    when('[t2] help command is run', () => {
      const helpResult = useBeforeAll(async () => {
        const output = execSync('npx rhx aws.postgres.query help', {
          cwd: scene.tempDir,
          encoding: 'utf8',
          stdio: 'pipe',
        });
        return { output };
      });

      then('it succeeds', () => {
        expect(helpResult.output).toBeDefined();
        expect(helpResult.output.length).toBeGreaterThan(0);
      });

      then('it shows usage', () => {
        expect(helpResult.output).toContain('aws.postgres.query');
        expect(helpResult.output).toContain('--env');
        expect(helpResult.output).toContain('--sql');
      });

      then('it shows readonly safety', () => {
        expect(helpResult.output).toContain('readonly');
      });
    });

    when('[t3] real SQL query is executed against testdb', () => {
      const queryResult = useBeforeAll(async () => {
        // set dummy AWS creds to skip keyrack lookup
        // the fixture has hardcoded localhost:7821 connection - no AWS needed
        const output = execSync(
          'npx rhx aws.postgres.query --env test --sql "SELECT 1 as value" --format json',
          {
            cwd: scene.tempDir,
            encoding: 'utf8',
            stdio: 'pipe',
            env: {
              ...process.env,
              AWS_ACCESS_KEY_ID: 'test-dummy-key',
              AWS_SECRET_ACCESS_KEY: 'test-dummy-secret',
            },
          },
        );
        return { output };
      });

      then('it succeeds', () => {
        expect(queryResult.output).toBeDefined();
        expect(queryResult.output.length).toBeGreaterThan(0);
      });

      then('it returns valid JSON', () => {
        // extract JSON array from output (may have framework headers before it)
        const jsonMatch = queryResult.output.match(/\[[\s\S]*\]/);
        if (!jsonMatch) throw new Error('JSON array not found in output');
        const parsed = JSON.parse(jsonMatch[0]);
        expect(Array.isArray(parsed)).toBe(true);
      });

      then('it returns expected value', () => {
        // extract JSON array from output (may have framework headers before it)
        const jsonMatch = queryResult.output.match(/\[[\s\S]*\]/);
        if (!jsonMatch) throw new Error('JSON array not found in output');
        const parsed = JSON.parse(jsonMatch[0]);
        expect(parsed).toEqual([{ value: 1 }]);
      });
    });

    when('[t4] invalid env is used', () => {
      const errorResult = useBeforeAll(async () => {
        try {
          execSync(
            'npx rhx aws.postgres.query --env invalid --sql "SELECT 1"',
            {
              cwd: scene.tempDir,
              encoding: 'utf8',
              stdio: 'pipe',
            },
          );
          return { exitCode: 0, stderr: '' };
        } catch (error: unknown) {
          const execError = error as { status?: number; stderr?: string };
          return {
            exitCode: execError.status ?? -1,
            stderr: execError.stderr ?? '',
          };
        }
      });

      then('it exits with constraint error', () => {
        expect(errorResult.exitCode).toBe(2);
      });
    });
  });
});
