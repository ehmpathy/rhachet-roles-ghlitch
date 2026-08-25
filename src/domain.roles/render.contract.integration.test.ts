import { given, then, when } from 'test-fns';

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * .what = a repo-wide audit of every RECORDED ghlitch render
 *
 * .why  = the per-skill suites each grade the renders that suite happens to cover. that
 *         leaves the class open in two directions at once: a skill whose suite forgot a
 *         path, and a skill added later whose author never read this rule. an audit that
 *         walks every `.snap` in the repo closes both, because it grades the bytes rather
 *         than the intent, and a new skill is enrolled the moment it records its first
 *         snapshot.
 *
 * .why here = it sits at the role root because it grades a contract every role shares
 *         (rule.prefer.most-common-denominator).
 *
 * .note = this audit reads snapshots, so it can only be as complete as the suites that
 *         write them. it is a backstop for the per-skill clamps, never a replacement —
 *         a render no suite ever produced is a render this cannot see.
 */

const repoRoot: string = join(__dirname, '..', '..');

/**
 * .what = one recorded render, with the snapshot key that produced it
 */
interface RenderRecorded {
  file: string;
  key: string;
  body: string;
}

/**
 * .what = pull every snapshot entry out of a jest `.snap` file
 *
 * .why  = the audit grades whole renders, so it must cut on the entry boundary rather
 *         than sweep the file as one blob. a sweep of the blob would let a header from
 *         one entry pair up with a mascot from the next, and the reprint defect would
 *         hide in the seam between two otherwise-clean records.
 */
const getAllRendersRecorded = (input: { file: string }): RenderRecorded[] => {
  const raw = readFileSync(input.file, 'utf-8');
  const entries: RenderRecorded[] = [];

  const pattern = /^exports\[`([\s\S]*?)`\] = `([\s\S]*?)`;$/gm;
  for (const match of raw.matchAll(pattern)) {
    // jest serializes a string value WRAPPED in double quotes, inside the template
    // literal, with a newline on each side when it is multi-line:
    //
    //     exports[`key 1`] = `
    //     "🐈 chartin course...
    //     ...
    //     "
    //     `;
    //
    // so the raw capture's first render line reads `"🐈 chartin course...`, with the
    // opening quote glued to the mascot. an audit that skipped this unwrap would find
    // one FEWER mascot than the render holds and report every two-phase run as a
    // header reprint — which is exactly what it did before this unwrap existed.
    const [, key = '', value = ''] = match;
    const serialized = value.replace(/^\n/, '').replace(/\n$/, '');
    const unquoted = serialized.startsWith('"')
      ? serialized.slice(1, -1)
      : serialized;
    entries.push({
      file: relative(repoRoot, input.file),
      key,
      // jest escapes a literal backslash, backtick, and double quote on the way in
      body: unquoted
        .replace(/\\"/g, '"')
        .replace(/\\`/g, '`')
        .replace(/\\\\/g, '\\'),
    });
  }

  return entries;
};

/**
 * .what = every `__snapshots__/*.snap` under a directory, walked recursively
 *
 * .why  = a hand-walked readdir rather than a glob dependency: this is the only glob
 *         this repo would need, and a dependency is a permanent cost for a nine-line
 *         read (rule.prefer.wet-over-dry).
 */
const getAllSnapFilesUnder = (input: { dir: string }): string[] =>
  readdirSync(input.dir, { withFileTypes: true }).flatMap((entry) => {
    const at = join(input.dir, entry.name);
    if (entry.isDirectory()) return getAllSnapFilesUnder({ dir: at });
    if (!entry.name.endsWith('.snap')) return [];
    return input.dir.endsWith('__snapshots__') ? [at] : [];
  });

const isMascot = (line: string): boolean => /^🐈 /.test(line);
const isArtifactHeader = (line: string): boolean => /^(🔮|⛵|🦺) /.test(line);

/**
 * .what = the one render family that carries an artifact header with NO mascot
 *
 * .why  = `uses._.check.sh` is an internal `_.` child, never invoked by a human directly.
 *         its AUTHORIZATION arms are terse confirmations that render inside a composer's
 *         already-open mascot phase, in the prod-gate sub.bucket:
 *
 *             ├─ check the gate...
 *             │  ├─
 *             │  │
 *             │  │  🦺 deploy.uses --env prod
 *             │  │     └─ authorized via local unlimited grant
 *             │  │
 *             │  └─
 *
 *         a mascot here would nest a second cat inside the parent's phase, for a note the
 *         parent already framed. its BLOCKED arms do carry one — a refusal is an alarm the
 *         reader must not miss — and those are graded by the normal rule.
 *
 * .note = it is an ALLOWLIST, not a predicate, on purpose. a predicate ("a header with one
 *         item is exempt") would silently absolve any future render that happened to match
 *         the shape. this names the family, so a new mascot-less render fails until someone
 *         declares, in this file, that it belongs here.
 *
 * .note = `aws.cloudwatch.logs.query --help` looked like a member and was NOT one: it had
 *         two help blocks and the mascot-less one shadowed the correct one. the exemption
 *         is the last resort, reached only after the defect is ruled out.
 */
const isGateConfirmation = (render: RenderRecorded): boolean =>
  /uses\.(_\.check|play)\.integration\.test\.ts\.snap$/.test(render.file) &&
  /^🦺 (deploy|provision)\.uses --env prod/.test(render.body);

/**
 * .what = tally the mascot lines and artifact-header lines of one render
 */
const asRenderTally = (
  render: RenderRecorded,
): { at: string; mascots: number; headers: number } => {
  const lines = render.body.split('\n');
  return {
    at: `${render.file} :: ${render.key}`,
    mascots: lines.filter((line) => isMascot(line)).length,
    headers: lines.filter((line) => isArtifactHeader(line)).length,
  };
};

describe('render.contract', () => {
  given('[case1] every snapshot recorded in this repo', () => {
    // .note = read inline rather than through `useThen`, because this is a handful of
    //         small synchronous file reads — there is no expensive call to share, and
    //         `useThen`'s proxy does not carry array semantics
    //         (rule.forbid.redundant-expensive-operations does not apply here).
    const renders = getAllSnapFilesUnder({ dir: join(repoRoot, 'src') })
      .sort()
      .flatMap((file) => getAllRendersRecorded({ file }));

    then('the audit found snapshots to grade', () => {
      // .note = a glob that matched zero files would make every assertion below pass
      //         vacuously. this is the failfast that stops the audit from reading as
      //         proof of absence (rule.forbid.failhide).
      expect(renders.length).toBeGreaterThan(100);
    });

    then('the unwrap stripped jest own string quoting', () => {
      // .note = a parser that left the wrapper on would glue `"` to the first mascot
      //         of every render, under-count mascots by exactly one, and report every
      //         healthy two-phase run as a header reprint. it did precisely that on
      //         first run, so the unwrap gets its own clamp rather than an assumption.
      const stillQuoted = renders
        .filter((render) => render.body.startsWith('"'))
        .map((render) => `${render.file} :: ${render.key}`);
      expect(stillQuoted).toEqual([]);
    });

    when('[t0] the ghlitch renders among them are audited', () => {
      // a snapshot that holds neither a mascot NOR an artifact header is not a ghlitch
      // render — a role manifest, a config dump, a third-party payload. those keep their
      // own contracts.
      //
      // .note = the selector reads EITHER glyph, deliberately. a mascot-only selector
      //         has a hole exactly the shape of the defect it exists to catch: a render
      //         that lost its mascot drops out of the corpus and is graded by no
      //         assertion at all. `aws.cloudwatch.logs.query --help` was such a render —
      //         it opened straight at `🔮` while every kin help render opens with
      //         `🐈 heres the deal...`, and the mascot-only selector filtered it out
      //         rather than fail it (rule.forbid.failhide).
      const ghlitch = renders.filter((render) =>
        render.body
          .split('\n')
          .some((line) => isMascot(line) || isArtifactHeader(line)),
      );

      // the gate confirmations are the one named family that renders a header with no
      // mascot, on purpose — see `isGateConfirmation`. they are graded separately so the
      // exemption is visible in the corpus rather than buried in a predicate.
      const graded = ghlitch.filter((render) => !isGateConfirmation(render));
      const exempt = ghlitch.filter((render) => isGateConfirmation(render));

      then('there are ghlitch renders to grade', () => {
        expect(graded.length).toBeGreaterThan(100);
      });

      then('the exemption covers only the gate confirmations', () => {
        // .note = an allowlist that quietly grows is an allowlist that stops meaning
        //         anything. pin its size, so a new member has to be added deliberately.
        expect(exempt).toHaveLength(7);
      });

      then('no render reprints its artifact header', () => {
        // .what = one artifact header per MASCOT PHASE, never one per paragraph
        //
        // .why  = a reprinted header renders N trees for one run. inside a parent's
        //         gutter that reads as N child calls, and — worse — every one-item
        //         block then closes with `└─`, so each bucket hung beneath it is framed
        //         at a depth that claims the tree had ended. the depth is supposed to
        //         encode whether work follows; a reprint makes it encode zero
        //         (rule.require.nest-subskill-output-in-buckets).
        const offenders = graded
          .map((render) => asRenderTally(render))
          .filter((tally) => tally.headers > tally.mascots);
        expect(offenders).toEqual([]);
      });

      then('no render opens a mascot phase it never answers', () => {
        // .what = a mascot promises a tree; the tree is the artifact block under it
        //
        // .why  = `🐈 chartin course...` with no block below it ends a run with a cat
        //         and no verdict. the caller learns the skill started and never learns
        //         what it concluded (rule.require.status-feedback).
        const offenders = graded
          .map((render) => asRenderTally(render))
          .filter((tally) => tally.headers === 0);
        expect(offenders).toEqual([]);
      });

      then('every artifact header sits directly under a mascot', () => {
        // .why  = the two-line shape IS the ghlitch render contract
        //         (`im_a.ghlitch_cat`, `.mascot/artifact structure`). a header that
        //         drifts away from its mascot leaves the phase boundary unreadable.
        const offenders = graded.flatMap((render) => {
          const lines = render.body.split('\n');
          return lines
            .map((line, index) => ({ line, index }))
            .filter((at) => isArtifactHeader(at.line))
            .filter(
              (at) =>
                !(
                  lines[at.index - 1] === '' &&
                  isMascot(lines[at.index - 2] ?? '')
                ),
            )
            .map((at) => `${render.file} :: ${render.key} :: ${at.line}`);
        });
        expect(offenders).toEqual([]);
      });
    });
  });
});
