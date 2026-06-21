import { genTempDir, given, then, useBeforeAll, when } from 'test-fns';

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * .what = acceptance test for use.testdb skill
 * .why = prove that the skill provisions testdb correctly
 */
describe('use.testdb', () => {
  given('[case1] rhachet roles available', () => {
    const scene = useBeforeAll(async () => {
      const tempDir = genTempDir({
        slug: 'use-testdb-acceptance',
        git: true,
        symlink: [
          { at: 'node_modules', to: 'node_modules' },
          { at: 'package.json', to: 'package.json' },
          { at: 'provision', to: 'provision' },
          {
            at: '.agent/keyrack.yml',
            to: 'src/blackbox/.test/use.testdb/keyrack.yml',
          },
        ],
      });

      // unlock keyrack for prep env (required for AWS credentials)
      execSync('npx rhx keyrack unlock --owner ehmpath --env prep', {
        cwd: tempDir,
        encoding: 'utf8',
        stdio: 'pipe',
      });

      // init rhachet roles (required for skill to be found)
      const initOutput = execSync('npx rhachet init --roles ghlitch/operator', {
        cwd: tempDir,
        encoding: 'utf8',
        stdio: 'pipe',
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
      then('use.testdb.sh exists', () => {
        expect(
          existsSync(
            join(
              scene.tempDir,
              '.agent/repo=ghlitch/role=operator/skills/use.testdb.sh',
            ),
          ),
        ).toBe(true);
      });
    });

    when('[t2] help command is run', () => {
      const helpResult = useBeforeAll(async () => {
        const output = execSync('npx rhx use.testdb help', {
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
        expect(helpResult.output).toContain('use.testdb');
        expect(helpResult.output).toContain('docker');
      });

      then('it shows what it provides', () => {
        expect(helpResult.output).toContain('localhost:7821');
      });
    });

    when('[t3] testdb is started', () => {
      const runResult = useBeforeAll(async () => {
        try {
          const output = execSync('npx rhx use.testdb', {
            cwd: scene.tempDir,
            encoding: 'utf8',
            stdio: 'pipe',
            timeout: 120000, // 2 minute timeout for docker operations
          });
          return { output, exitCode: 0, stderr: '' };
        } catch (error: unknown) {
          const execError = error as {
            status?: number;
            stderr?: string;
            stdout?: string;
          };
          return {
            output: execError.stdout ?? '',
            exitCode: execError.status ?? -1,
            stderr: execError.stderr ?? '',
          };
        }
      });

      then('it succeeds', () => {
        expect(runResult.exitCode).toBe(0);
      });

      then('output shows testdb ready', () => {
        expect(runResult.output).toContain('testdb ready');
        expect(runResult.output).toContain('localhost:7821');
      });
    });
  });
});
