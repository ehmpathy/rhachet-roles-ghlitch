import { given, then, when } from 'test-fns';

import { maskRunnerBanner } from './.test/maskRunnerBanner';

/**
 * .what = proves the run-banner mask renders the SAME bytes on an npm host and a
 *         pnpm host
 * .why  = the collocated snapshot passed on a pnpm host and reddened in cicd, where
 *         npm runs. the mask consumed the banner's two text lines but not the blank
 *         lines npm wraps them in, so one host rendered zero blanks and the other
 *         two. that defect was invisible to every local run, which is exactly the
 *         class rule.require.hermetic-tests exists to catch — so it is clamped here
 *         rather than left to a cicd round trip to re-discover.
 */

// what the skill's own stdout looks like around the forwarded payload. the skill
// prints NO blank line between its step line and the payload; every blank line in
// the npm case below belongs to npm.
const SKILL_FRAME_HEAD = '   plan schema changes...';
const FORWARDED_PAYLOAD = 'Everything is up to date'; // verbatim sql-schema-control marker

// a pnpm host: `npm run` is shimmed to pnpm, which prints no banner at all
const STDOUT_FROM_PNPM_HOST: string = [
  SKILL_FRAME_HEAD,
  FORWARDED_PAYLOAD,
].join('\n');

// an npm host (cicd): npm prints a banner wrapped in a blank line on each side
const STDOUT_FROM_NPM_HOST: string = [
  SKILL_FRAME_HEAD,
  '',
  '> svc-test@0.0.0 provision:schema:plan',
  '> node provision/schema/plan.js',
  '',
  FORWARDED_PAYLOAD,
].join('\n');

describe('maskRunnerBanner', () => {
  given(
    '[case1] the two host shapes that produced the cicd/local split',
    () => {
      when('[t0] each is masked', () => {
        then(
          'the npm host loses the banner AND its blank-line envelope',
          () => {
            expect(maskRunnerBanner(STDOUT_FROM_NPM_HOST)).toEqual(
              [SKILL_FRAME_HEAD, FORWARDED_PAYLOAD].join('\n'),
            );
          },
        );

        then('the pnpm host, which has no banner, is left untouched', () => {
          expect(maskRunnerBanner(STDOUT_FROM_PNPM_HOST)).toEqual(
            STDOUT_FROM_PNPM_HOST,
          );
        });

        then('both hosts converge on byte-identical output', () => {
          // the clamp that carries the weight: this is the equality the old mask broke.
          expect(maskRunnerBanner(STDOUT_FROM_NPM_HOST)).toEqual(
            maskRunnerBanner(STDOUT_FROM_PNPM_HOST),
          );
        });

        then('no stray blank line survives between frame and payload', () => {
          // the negative control. the old mask left a doubled newline here, so this
          // assert is what reddens if the envelope is ever dropped from the mask again.
          expect(maskRunnerBanner(STDOUT_FROM_NPM_HOST)).not.toContain('\n\n');
        });
      });
    },
  );

  given('[case2] a blank line the SKILL itself printed', () => {
    const stdoutWithSkillBlank = [SKILL_FRAME_HEAD, '', FORWARDED_PAYLOAD].join(
      '\n',
    );

    when('[t0] it is masked', () => {
      then('the skill blank survives — the mask only eats npm chrome', () => {
        // proves the mask is anchored to the banner, so it can never swallow a
        // blank line the skill authored.
        expect(maskRunnerBanner(stdoutWithSkillBlank)).toEqual(
          stdoutWithSkillBlank,
        );
      });
    });
  });
});
