import { genTempDir, given, then, useBeforeAll, when } from 'test-fns';

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * .what = acceptance test for aws.ssm.param.check skill (shell-only, no .ts dispatch)
 * .why = prove shell-only skills work correctly via rhachet init
 *
 * .ref = ehmpathy/rhachet-roles-ghlitch#13
 */
describe('aws.ssm.param.check', () => {
  given('[case1] rhachet roles available', () => {
    const scene = useBeforeAll(async () => {
      const tempDir = genTempDir({
        slug: 'aws-ssm-param-check-acceptance',
        git: true,
        symlink: [
          { at: 'node_modules', to: 'node_modules' },
          { at: 'package.json', to: 'package.json' },
          {
            at: '.agent/keyrack.yml',
            to: 'src/blackbox/.test/aws.postgres.query/keyrack.yml',
          },
        ],
      });

      // unlock keyrack for test env (required for skill execution)
      execSync('npx rhx keyrack unlock --owner ehmpath --env test', {
        cwd: tempDir,
        encoding: 'utf8',
        stdio: 'pipe',
      });

      // init rhachet roles (required for skill to be found)
      const initOutput = execSync('npx rhachet init --roles ghlitch/observer', {
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
      then('aws.ssm.param.check.sh exists', () => {
        expect(
          existsSync(
            join(
              scene.tempDir,
              '.agent/repo=ghlitch/role=observer/skills/aws.ssm.param.check.sh',
            ),
          ),
        ).toBe(true);
      });

      then('no .ts file exists (shell-only skill)', () => {
        expect(
          existsSync(
            join(
              scene.tempDir,
              '.agent/repo=ghlitch/role=observer/skills/aws.ssm.param.check.ts',
            ),
          ),
        ).toBe(false);
      });
    });

    when('[t2] help command is run', () => {
      const helpResult = useBeforeAll(async () => {
        const output = execSync('npx rhx aws.ssm.param.check help', {
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
        expect(helpResult.output).toContain('aws.ssm.param.check');
        expect(helpResult.output).toContain('--env');
      });

      then('it shows all options', () => {
        expect(helpResult.output).toContain('--name');
        expect(helpResult.output).toContain('--pattern');
        expect(helpResult.output).toContain('--from');
      });
    });

    when('[t3] invalid env is used', () => {
      const errorResult = useBeforeAll(async () => {
        try {
          execSync('npx rhx aws.ssm.param.check --env invalid --name test', {
            cwd: scene.tempDir,
            encoding: 'utf8',
            stdio: 'pipe',
          });
          return { exitCode: 0 };
        } catch (error: unknown) {
          const execError = error as { status?: number };
          return { exitCode: execError.status ?? -1 };
        }
      });

      then('it exits with constraint error', () => {
        expect(errorResult.exitCode).toBe(2);
      });
    });

    when('[t4] no mode is specified', () => {
      const errorResult = useBeforeAll(async () => {
        try {
          execSync('npx rhx aws.ssm.param.check --env test', {
            cwd: scene.tempDir,
            encoding: 'utf8',
            stdio: 'pipe',
          });
          return { exitCode: 0, stdout: '' };
        } catch (error: unknown) {
          const execError = error as { status?: number; stdout?: Buffer };
          return {
            exitCode: execError.status ?? -1,
            stdout: execError.stdout?.toString('utf8') ?? '',
          };
        }
      });

      then('it exits with constraint error', () => {
        expect(errorResult.exitCode).toBe(2);
      });

      then('error message indicates mode required', () => {
        expect(errorResult.stdout).toContain(
          'must specify --name, --pattern, or --from',
        );
      });
    });
  });
});
