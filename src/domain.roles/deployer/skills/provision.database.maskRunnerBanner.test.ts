import { given, then, when } from 'test-fns';

import { maskRunnerBanner } from './.test/maskRunnerBanner';

/**
 * .what = proves the run-banner mask renders the SAME bytes on an npm host and a pnpm
 *         host, whether the payload runs bare or inside a bucket frame
 *
 * .why  = the collocated snapshot is host-shaped without this mask, and the defect is
 *         invisible to any single local run — the class rule.require.hermetic-tests
 *         exists to catch. it is clamped here rather than left to a cicd round trip.
 *
 * .why REWRITTEN = the first cut of this suite encoded two false premises, and each one
 *         let a real defect through.
 *
 *         it claimed pnpm "prints no banner at all". pnpm prints a dim `$ <command>`
 *         line, so the recorded snapshot carried pnpm's chrome AND its raw ANSI codes,
 *         and no assert here could see it — the suite had no pnpm-banner case to fail.
 *
 *         and it exercised only the BARE shape, at column 0. the payload is framed in a
 *         bucket now, so every line carries a `   │  ` gutter — and the mask, anchored to
 *         a line start, silently stopped to fire. a mask that no-ops is a failhide
 *         (rule.forbid.failhide), so the framed shape is graded below as its own case.
 */

// what the skill's own stdout looks like around the forwarded payload
const SKILL_FRAME_HEAD = '   plan schema changes...';
const FORWARDED_PAYLOAD = 'Everything is up to date'; // verbatim sql-schema-control marker

// npm: a two-line banner, closed by a blank
//
// .note = there is deliberately NO blank above the header. npm emits none when its output
//         is piped, which is how a skill runs it — verified against the real bytes a
//         framed run produced. the earlier fixture here asserted a blank on each side,
//         inherited rather than observed, and the mask built to satisfy it ate the bucket
//         frame's own spacer (rule.require.trust-but-verify).
const BANNER_NPM = [
  '> svc-test@0.0.0 provision:schema:plan',
  '> node provision/schema/plan.js',
  '',
];

// pnpm: one line, dim-styled, no envelope. `\u001b[2m` … `\u001b[22m` is the dim pair it
// actually emits — kept verbatim so this case proves the mask reads THROUGH the style.
const BANNER_PNPM = ['\u001b[2m$ node provision/schema/plan.js\u001b[22m'];

const asBare = (banner: string[]): string =>
  [SKILL_FRAME_HEAD, ...banner, FORWARDED_PAYLOAD].join('\n');

// the same stdout as a caller actually sees it today: framed in a bucket, so every line
// carries the gutter that broke the first mask
const asFramed = (banner: string[]): string =>
  [
    '   └─ plan schema changes...',
    '      ├─',
    '      │',
    ...banner.map((line) => (line === '' ? '      │' : `      │  ${line}`)),
    `      │  ${FORWARDED_PAYLOAD}`,
    '      │',
    '      └─',
  ].join('\n');

describe('maskRunnerBanner', () => {
  given('[case1] the payload runs BARE, at column 0', () => {
    when('[t0] each host shape is masked', () => {
      then('the npm host loses the banner AND its blank envelope', () => {
        expect(maskRunnerBanner(asBare(BANNER_NPM))).toEqual(
          [SKILL_FRAME_HEAD, FORWARDED_PAYLOAD].join('\n'),
        );
      });

      then('the pnpm host loses its dim one-line banner', () => {
        expect(maskRunnerBanner(asBare(BANNER_PNPM))).toEqual(
          [SKILL_FRAME_HEAD, FORWARDED_PAYLOAD].join('\n'),
        );
      });

      then('both hosts converge on byte-identical output', () => {
        expect(maskRunnerBanner(asBare(BANNER_NPM))).toEqual(
          maskRunnerBanner(asBare(BANNER_PNPM)),
        );
      });

      then('no ANSI escape survives the mask', () => {
        // the negative control for the pnpm half: the old mask left these in the
        // recorded bytes, where they are invisible to a reader who skims the snapshot.
        // the ESC char itself is the assert — stricter than a match on one dim-style
        // sequence, and it needs no regex over a control character.
        expect(maskRunnerBanner(asBare(BANNER_PNPM))).not.toContain('\u001b');
      });
    });
  });

  given('[case2] the payload runs FRAMED, behind a bucket gutter', () => {
    when('[t0] each host shape is masked', () => {
      then('both hosts converge on byte-identical output', () => {
        // the clamp that carries the weight. this is the equality the gutter broke, and
        // the reason a bare-only suite could not see it.
        expect(maskRunnerBanner(asFramed(BANNER_NPM))).toEqual(
          maskRunnerBanner(asFramed(BANNER_PNPM)),
        );
      });

      then('the frame survives intact, with its single spacer', () => {
        expect(maskRunnerBanner(asFramed(BANNER_NPM))).toEqual(
          [
            '   └─ plan schema changes...',
            '      ├─',
            '      │',
            `      │  ${FORWARDED_PAYLOAD}`,
            '      │',
            '      └─',
          ].join('\n'),
        );
      });

      then('not one banner line survives on either host', () => {
        for (const framed of [asFramed(BANNER_NPM), asFramed(BANNER_PNPM)]) {
          const masked = maskRunnerBanner(framed);
          expect(masked).not.toContain('svc-test@');
          expect(masked).not.toContain('node provision/schema/plan.js');
        }
      });
    });
  });

  given('[case3] a stdout that holds NO banner', () => {
    // the bucket frame renders two adjacent gutter lines when it wraps a silent child.
    // the mask must never rewrite that shape, so it is a strict no-op here.
    const stdoutWithSkillBlanks = ['   ├─', '   │', '   │', '   └─'].join('\n');

    when('[t0] it is masked', () => {
      then('it is returned untouched', () => {
        expect(maskRunnerBanner(stdoutWithSkillBlanks)).toEqual(
          stdoutWithSkillBlanks,
        );
      });
    });

    when('[t1] a skill-authored blank sits between two lines', () => {
      const stdoutWithSkillBlank = [
        SKILL_FRAME_HEAD,
        '',
        FORWARDED_PAYLOAD,
      ].join('\n');

      then(
        'the skill blank survives — the mask only eats runner chrome',
        () => {
          expect(maskRunnerBanner(stdoutWithSkillBlank)).toEqual(
            stdoutWithSkillBlank,
          );
        },
      );
    });
  });
});
