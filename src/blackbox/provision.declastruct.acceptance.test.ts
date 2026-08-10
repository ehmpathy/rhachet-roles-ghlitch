import { genTempDir, given, then, useBeforeAll, when } from 'test-fns';

import { execSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * .what = acceptance test for the provision.declastruct skill, as a CONSUMER receives it
 * .why = every other proof in this route is collocated: it runs the skill straight out of
 *        `src/`. that proves the skill WORKS; it does not prove a consumer ever GETS it.
 *        this closes that gap the only way it can be closed — install the role into a clean
 *        repo via `npx rhachet init` and drive the delivered file.
 *
 *        the gap was real rather than theoretical. three kin shell-only skills
 *        (aws.ssm.param.check, aws.postgres.query, use.testdb) each carry this proof;
 *        provision.declastruct shipped in v0.2.10 without one. so its whole caller-faced
 *        contract — the flags this route adds among them — had no distribution clamp at all.
 *
 * .note = deliberately credential-free. every case here belays at the ARGUMENT boundary,
 *         which runs before any credential work, so this suite never unlocks a keyrack and
 *         never prompts sso. that keeps it runnable on a bare CI runner, which is precisely
 *         the environment a distribution test must survive.
 *
 * .note = the assertions are about the CONTRACT a consumer meets — the flags exist, the
 *         enums are the declared ones, the exit codes are semantic. the exhaustive belay
 *         text and its snapshots stay in the collocated integration suite; to duplicate
 *         them here would be two sources of truth for one output.
 */
describe('provision.declastruct (as a consumer receives it)', () => {
  given(
    '[case1] the ghlitch deployer role is installed into a clean repo',
    () => {
      const scene = useBeforeAll(async () => {
        const tempDir = genTempDir({
          slug: 'provision-declastruct-acceptance',
          git: true,
          symlink: [
            { at: 'node_modules', to: 'node_modules' },
            { at: 'package.json', to: 'package.json' },
          ],
        });

        const initOutput = execSync(
          'npx rhachet init --roles ghlitch/deployer',
          {
            cwd: tempDir,
            encoding: 'utf8',
            stdio: 'pipe',
          },
        );

        // a real wish file, because the skill checks the wish PATH before it validates the
        // enums. the first draft of this suite passed `./x.ts` (absent) and every run belayed
        // with `wish not found` — yet the exit-2 asserts still PASSED, because both belays
        // exit 2. a clamp that cannot tell which belay fired is a vacuous clamp; only the
        // message asserts caught it. the file makes the enum cases reach the enum guard.
        //
        // it is never read: each case below belays at the argument boundary, which is why
        // this suite needs no credentials and no declastruct run.
        const wish = join(tempDir, 'resources.ts');
        writeFileSync(wish, 'export const getResources = () => [];\n');

        return { tempDir, initOutput, wish };
      });

      when('[t0] rhachet init is run', () => {
        then('it succeeds and names the role pack', () => {
          expect(scene.initOutput).toContain('ghlitch');
        });
      });

      when('[t1] the delivered skill files are checked', () => {
        then('provision.declastruct.sh landed', () => {
          expect(
            existsSync(
              join(
                scene.tempDir,
                '.agent/repo=ghlitch/role=deployer/skills/provision.declastruct.sh',
              ),
            ),
          ).toBe(true);
        });

        then('the gate operations it composes landed beside it', () => {
          // the prod-write gate lives in a kin file the skill sources at runtime. a consumer
          // who received the skill WITHOUT it would find every prod apply broken — and every
          // non-prod path still green, so the gap would surface only in prod.
          expect(
            existsSync(
              join(
                scene.tempDir,
                '.agent/repo=ghlitch/role=deployer/skills/uses._.check.sh',
              ),
            ),
          ).toBe(true);
        });
      });

      when('[t2] help is requested through rhx', () => {
        const helpResult = useBeforeAll(async () => {
          const output = execSync('npx rhx provision.declastruct help', {
            cwd: scene.tempDir,
            encoding: 'utf8',
            stdio: 'pipe',
          });
          return { output };
        });

        then('it documents both credential and approval axes', () => {
          // the two flags this route adds. a consumer discovers them here or not at all
          // (rule.require.skill-help, rule.require.discoverability).
          expect(helpResult.output).toContain('--auth');
          expect(helpResult.output).toContain('via-keyrack');
          expect(helpResult.output).toContain('via-ambient');
          expect(helpResult.output).toContain('--gate');
          expect(helpResult.output).toContain('for-ehmpath');
          expect(helpResult.output).toContain('for-cicd');
        });

        then('it documents the env enum, camp among them', () => {
          // camp is the env from the reported incident; the enum widened for it.
          expect(helpResult.output).toContain('camp');
        });

        then('the DELIVERED help matches snapshot (visual vibecheck)', () => {
          // the one snapshot this suite carries, and it snaps the help rather than a
          // belay on purpose: help is the whole discoverable contract in one block, and
          // it is fully deterministic (no paths, no timestamps, no host state).
          //
          // it is NOT a duplicate of the collocated suite's help snapshot, which is the
          // objection i first raised against it. they observe different things:
          // the collocated one proves what `src/` EMITS; this one proves what a consumer
          // RECEIVES after `rhachet init`. a build that mangled the delivered file —
          // truncated it, re-encoded it, shipped a stale copy — would leave the
          // collocated snapshot green and only this one red.
          expect(helpResult.output).toMatchSnapshot();
        });
      });

      when('[t3] an invalid --auth value is passed', () => {
        const errorResult = useBeforeAll(async () => {
          try {
            execSync(
              `npx rhx provision.declastruct --wish ${scene.wish} --env test --mode plan --auth as-human`,
              { cwd: scene.tempDir, encoding: 'utf8', stdio: 'pipe' },
            );
            return { exitCode: 0, output: '' };
          } catch (error: unknown) {
            const execError = error as { status?: number; stdout?: Buffer };
            return {
              exitCode: execError.status ?? -1,
              output: execError.stdout?.toString() ?? '',
            };
          }
        });

        then('it exits 2 — a constraint the caller must fix', () => {
          expect(errorResult.exitCode).toBe(2);
          // exit 2 alone proves little: EVERY belay in this skill exits 2, so this assert
          // would pass on a `wish not found` too (it did, in this suite's first draft).
          // pinning which belay fired is what gives the exit code its meaning.
          expect(errorResult.output).not.toContain('wish not found');
        });

        then('the belay names the valid set, not just the symptom', () => {
          expect(errorResult.output).toContain('invalid auth');
          expect(errorResult.output).toContain('via-keyrack or via-ambient');
        });
      });

      when('[t4] the retired --auth as-cicd value is passed', () => {
        const errorResult = useBeforeAll(async () => {
          try {
            execSync(
              `npx rhx provision.declastruct --wish ${scene.wish} --env test --mode plan --auth as-cicd`,
              { cwd: scene.tempDir, encoding: 'utf8', stdio: 'pipe' },
            );
            return { exitCode: 0, output: '' };
          } catch (error: unknown) {
            const execError = error as { status?: number; stdout?: Buffer };
            return {
              exitCode: execError.status ?? -1,
              output: execError.stdout?.toString() ?? '',
            };
          }
        });

        then('it exits 2 rather than silently translate', () => {
          // the hardcut the wisher chose over an alias (A14). a consumer on the old word must
          // MEET this, which is exactly what a distribution test proves and a collocated one
          // cannot.
          expect(errorResult.exitCode).toBe(2);
          // same clamp as [t3]: exit 2 is shared by every belay, so it must be pinned to the
          // belay this case is about, or it proves only that SOMETHING was rejected.
          expect(errorResult.output).not.toContain('wish not found');
        });

        then('the belay hands the caller their exact migration', () => {
          expect(errorResult.output).toContain('as-cicd');
          expect(errorResult.output).toContain('via-ambient');
          expect(errorResult.output).toContain('for-cicd');
        });
      });
    },
  );
});
