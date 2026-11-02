import { MalfunctionError } from 'helpful-errors';
import { genTempDir, getError, given, then, when } from 'test-fns';

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * .what = a repo-wide audit of every recorded ghlitch render
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
  const file = relative(repoRoot, input.file);
  return assureSnapshotEntries({ raw, file }).map((entry) => ({
    file,
    key: entry.key,
    body: asSnapshotBody({ serialized: entry.serialized }),
  }));
};

/**
 * .what = cut a `.snap` file's raw text into its entries: each key and serialized value
 *
 * .why  = the cut is its own step, so a drift clamp grades it alone. it asserts as it cuts
 *         (hence assure*, never as*): it throws when the entries it parsed differ from the
 *         entries the file declares, and when a file with content declares none, so a format
 *         drift never drops a file unseen.
 */
const assureSnapshotEntries = (input: {
  raw: string;
  file: string;
}): { key: string; serialized: string }[] => {
  // an entry ends at its `` `; `` only where the next entry (or the file end) follows, so a
  // render line that itself ends in `` `; `` never cuts an entry short
  const pattern =
    /(?<=^|\n)exports\[`([\s\S]*?)`\] = `([\s\S]*?)`;(?=\n\nexports\[|\n*$)/g;
  const matches = [...input.raw.matchAll(pattern)];

  // every entry the file declares must parse, and a file with content must declare one
  const declared = [...input.raw.matchAll(/(?<=^|\n)exports\[`/g)].length;
  const isContentful = input.raw.trim().length > 0;
  const hint =
    'the .snap format drifted from the entry pattern; update the pattern in assureSnapshotEntries';
  if (matches.length !== declared)
    throw new MalfunctionError(
      'the render audit parsed a different count of snapshot entries than the file declares',
      { file: input.file, parsed: matches.length, declared, hint },
    );
  if (isContentful && declared === 0)
    throw new MalfunctionError(
      'the render audit found a .snap with content but no entry header it can read',
      { file: input.file, parsed: matches.length, declared, hint },
    );
  return matches.map((match) => {
    const [, key = '', serialized = ''] = match;
    return { key, serialized };
  });
};

/**
 * .what = the render a jest snapshot value holds, unwrapped and unescaped
 *
 * .why  = jest serializes a string value wrapped in double quotes, inside the template
 *         literal, with a newline on each side when it is multi-line:
 *
 *             exports[`key 1`] = `
 *             "🐈 chartin course...
 *             ...
 *             "
 *             `;
 *
 *         so the raw capture's first render line reads `"🐈 chartin course...`, the open
 *         quote glued to the mascot. an audit that skipped this unwrap would find one fewer
 *         mascot than the render holds and report every two-phase run as a header reprint.
 *         jest also escapes a literal backslash, backtick, and double quote.
 */
const asSnapshotBody = (input: { serialized: string }): string => {
  const trimmed = input.serialized.replace(/^\n/, '').replace(/\n$/, '');
  const isQuoted =
    trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"');
  const unquoted = isQuoted ? trimmed.slice(1, -1) : trimmed;
  return unquoted
    .replace(/\\"/g, '"')
    .replace(/\\`/g, '`')
    .replace(/\\\\/g, '\\');
};

/**
 * .what = every `*.snap` under a directory, walked recursively
 *
 * .why  = a hand-walked readdir rather than a glob dependency: this is the only glob
 *         this repo would need, and a dependency is a permanent cost for a nine-line
 *         read (rule.prefer.wet-over-dry). every `.snap` counts, wherever a suite's
 *         `snapshotResolver` puts it, so no recorded render escapes the audit.
 */
const getAllSnapFilesUnder = (input: { dir: string }): string[] =>
  readdirSync(input.dir, { withFileTypes: true }).flatMap((entry) => {
    const at = join(input.dir, entry.name);
    if (entry.isDirectory()) return getAllSnapFilesUnder({ dir: at });
    return entry.name.endsWith('.snap') ? [at] : [];
  });

const isMascot = (line: string): boolean => /^🐈 /.test(line);
// one artifact glyph per role: observer 🔮 · deployer ⛵ · operator 🦺 · guardian 🧿
const isArtifactHeader = (line: string): boolean =>
  /^(🔮|⛵|🦺|🧿) /.test(line);

/**
 * .what = the lines of one render — the one split every grader reads
 */
const asRenderLines = (render: RenderRecorded): string[] =>
  render.body.split('\n');

/**
 * .what = is a recorded snapshot a ghlitch render: does any line carry a mascot or an
 *         artifact header?
 *
 * .why  = the selector reads either glyph, deliberately. a mascot-only selector has a hole
 *         exactly the shape of the defect it exists to catch: a render that lost its mascot
 *         drops out of the corpus and is graded by no assertion at all
 *         (rule.forbid.failhide). a snapshot with neither — a role manifest, a config dump,
 *         a third-party payload — keeps its own contract.
 */
const isGhlitchRender = (render: RenderRecorded): boolean =>
  asRenderLines(render).some(
    (line) => isMascot(line) || isArtifactHeader(line),
  );

/**
 * .what = the one render family that carries an artifact header with no mascot
 *
 * .why  = `uses._.check.sh` is an internal `_.` child, never invoked by a human directly.
 *         its authorization arms are terse confirmations that render inside a composer's
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
 *         parent already framed. its blocked arms do carry one — a refusal is an alarm the
 *         reader must not miss — and those are graded by the normal rule.
 *
 * .note = it is an allowlist, not a predicate, on purpose. a predicate ("a header with one
 *         item is exempt") would silently absolve any future render that happened to match
 *         the shape. this names the family, so a new mascot-less render fails until someone
 *         declares, in this file, that it belongs here.
 *
 * .note = `aws.cloudwatch.logs.query --help` looked like a member and was not one: it had
 *         two help blocks and the mascot-less one shadowed the correct one. the exemption
 *         is the last resort, reached only after the defect is ruled out.
 */
const isGateConfirmation = (render: RenderRecorded): boolean =>
  /uses\.(_\.check|play)\.integration\.test\.ts\.snap$/.test(render.file) &&
  /^🦺 (deploy|provision)\.uses --env prod/.test(
    asRenderLines(render)[0] ?? '',
  );

/**
 * .what = tally the mascot lines and artifact-header lines of one render
 */
const asRenderTally = (
  render: RenderRecorded,
): { at: string; mascots: number; headers: number } => {
  const lines = asRenderLines(render);
  return {
    at: `${render.file} :: ${render.key}`,
    mascots: lines.filter((line) => isMascot(line)).length,
    headers: lines.filter((line) => isArtifactHeader(line)).length,
  };
};

/**
 * .what = is a line a tree branch at the first depth (`   ├─ ` or `   └─ `)?
 */
const isTreeBranchTop = (line: string): boolean => /^ {3}(├─|└─) /.test(line);

/**
 * .what = is a render shaped as a gate confirmation: no mascot, one artifact header, and
 *         its tree directly below
 */
const isGateConfirmationShaped = (render: RenderRecorded): boolean => {
  const lines = asRenderLines(render);
  const tally = asRenderTally(render);
  const headerAt = lines.findIndex((line) => isArtifactHeader(line));
  return (
    tally.mascots === 0 &&
    tally.headers === 1 &&
    isTreeBranchTop(lines[headerAt + 1] ?? '')
  );
};

/**
 * .what = the success mascots of the ghlitch cat (`im_a.ghlitch_cat`, `.vibe phrases`)
 * .note = [case1.1] reads each against the persona brief, so a rename there reddens here
 */
const SUCCESS_MASCOTS: string[] = [
  '🐈 smooth sailin!',
  '🐈 anchors away!',
  '🐈 caught it!',
  '🐈 gotcha!',
];

/**
 * .what = is a line a failure close at the top depth — a tree that closes on a qualified
 *         `halted:` or `blocked:` verdict (a nested child's close sits deeper, and is its own)
 */
const isFailureCloseTop = (line: string): boolean =>
  /^ {3}└─ (halted|blocked): (💥 MalfunctionError|✋ ConstraintError):/.test(
    line,
  );

/**
 * .what = the mascot phases of a render that open on a success mascot and close on a
 *         failure verdict (one `<file> :: <key> :: <mascot>` label each)
 *
 * .why  = a glyph tally cannot see which mascot fronts a phase. a success cat over a halted
 *         tree tells the reader the run worked when it did not — the mascot must follow the
 *         exit, as `as_belay_mascot` holds it in the skills
 */
const getSuccessMascotsOverFailure = (render: RenderRecorded): string[] => {
  const lines = asRenderLines(render);
  return lines
    .map((line, index) => ({ line, index }))
    .filter((at) => SUCCESS_MASCOTS.includes(at.line))
    .filter((at) => {
      const phaseEnd = lines.findIndex(
        (line, index) => index > at.index && isMascot(line),
      );
      const phase = lines.slice(
        at.index + 1,
        phaseEnd === -1 ? lines.length : phaseEnd,
      );
      return phase.some((line) => isFailureCloseTop(line));
    })
    .map((at) => `${render.file} :: ${render.key} :: ${at.line}`);
};

/**
 * .what = the artifact headers of a render that do not sit directly under a mascot (one
 *         `<file> :: <key> :: <header>` label each)
 */
const getHeadersOffMascot = (render: RenderRecorded): string[] => {
  const lines = asRenderLines(render);
  return lines
    .map((line, index) => ({ line, index }))
    .filter((at) => isArtifactHeader(at.line))
    .filter(
      (at) =>
        !(lines[at.index - 1] === '' && isMascot(lines[at.index - 2] ?? '')),
    )
    .map((at) => `${render.file} :: ${render.key} :: ${at.line}`);
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
      const ghlitch = renders.filter((render) => isGhlitchRender(render));

      // the gate confirmations are the one named family that renders a header with no
      // mascot, on purpose — see `isGateConfirmation`. they skip only the mascot invariants;
      // the shape invariants that still apply to them are graded below, beside the rest.
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

      then(
        'each gate confirmation holds one header, its tree directly below',
        () => {
          // .why  = the exemption lifts the mascot rule only. a confirmation that grew a
          //         reprinted header, or lost its block, still breaks the bucket it nests in
          //         (rule.require.nest-subskill-output-in-buckets)
          const offenders = exempt
            .filter((render) => !isGateConfirmationShaped(render))
            .map((render) => asRenderTally(render).at);
          expect(offenders).toEqual([]);
        },
      );

      then('no render reprints its artifact header', () => {
        // .what = one artifact header per mascot phase, never one per paragraph
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
        // .why  = the two-line shape is the ghlitch render contract
        //         (`im_a.ghlitch_cat`, `.mascot/artifact structure`). a header that
        //         drifts away from its mascot leaves the phase boundary unreadable.
        const offenders = graded.flatMap((render) =>
          getHeadersOffMascot(render),
        );
        expect(offenders).toEqual([]);
      });

      then('no success mascot fronts a tree that closes on a failure', () => {
        const offenders = graded.flatMap((render) =>
          getSuccessMascotsOverFailure(render),
        );
        expect(offenders).toEqual([]);
      });
    });
  });

  given('[case1.1] the success mascots the audit grades against', () => {
    // the set is a copy of the persona's phrases; a rename there must redden here, else the
    // audit grades a corpus whose success mascots it no longer recognizes
    const persona = readFileSync(
      join(repoRoot, 'src/domain.roles/operator/briefs/im_a.ghlitch_cat.md'),
      'utf-8',
    );

    when('[t0] each is read against the persona brief', () => {
      SUCCESS_MASCOTS.map((mascot) =>
        then(`${mascot}: the persona's phrase table names it`, () => {
          expect(persona).toContain(`\`${mascot.replace(/^🐈 /, '')}\``);
        }),
      );
    });

    when('[t1] the set is compared whole against the persona table', () => {
      then(
        'the persona rows of a success-close sense are exactly the set, so an addition reddens too',
        () => {
          // the phrase table rows: | `phrase` | sense | usage |
          const SUCCESS_SENSES = ['success', 'found', 'trapped', 'action'];
          const fromPersona = [
            ...persona.matchAll(/^\| `([^`]+)` \| ([a-z ]+?) \|/gm),
          ]
            .filter((row) => SUCCESS_SENSES.includes(row[2] ?? ''))
            .map((row) => `🐈 ${row[1]}`)
            .sort();
          expect(fromPersona).toEqual([...SUCCESS_MASCOTS].sort());
        },
      );
    });
  });

  given('[case2] a snapshot file outside any __snapshots__ dir', () => {
    // a suite's snapshotResolver may put a .snap anywhere; the audit must enroll it there too
    // built in the temp dir, never cloned: jest's `-u` sweep deletes a checked-in .snap it
    // reads as obsolete, so a .snap fixture cannot live in the tree
    const dir = genTempDir({ slug: 'render-contract-resolver' });
    mkdirSync(join(dir, 'custom', 'snaps'), { recursive: true });
    writeFileSync(join(dir, 'custom', 'snaps', 'elsewhere.snap'), '');
    writeFileSync(join(dir, 'custom', 'not-a-snap.txt'), '');

    when('[t0] the audit walks the tree', () => {
      then('it collects the .snap, and only the .snap', () => {
        expect(getAllSnapFilesUnder({ dir })).toEqual([
          join(dir, 'custom', 'snaps', 'elsewhere.snap'),
        ]);
      });
    });
  });

  given('[case3] a snapshot file whose format drifted', () => {
    // an entry the pattern cannot cut would drop its render from the audit unseen, so a parse
    // that counts fewer entries than the file declares fails loud instead of a short audit
    const file = join(
      genTempDir({ slug: 'render-contract-drift' }),
      'drift.snap',
    );
    writeFileSync(
      file,
      [
        'exports[`clean entry 1`] = `"🐈 smooth sailin!"`;',
        '',
        'exports[`drifted entry 1`] = `"no close quote"',
        '',
      ].join('\n'),
    );

    when('[t0] the audit reads it', () => {
      then('it fails loud with the parsed and declared counts', async () => {
        const error = await getError(async () =>
          getAllRendersRecorded({ file }),
        );
        expect(error).toBeInstanceOf(MalfunctionError);
        expect(error.message).toContain(
          'the render audit parsed a different count of snapshot entries than the file declares',
        );
        if (!(error instanceof MalfunctionError)) throw error;
        expect(error.metadata).toMatchObject({
          file: relative(repoRoot, file),
          parsed: 1,
          declared: 2,
        });
      });
    });

    when(
      '[t1] a file with content declares no entry the audit can read',
      () => {
        // a declared count that reads zero is no clean file: the whole file would drop unseen
        const fileUnread = join(
          genTempDir({ slug: 'render-contract-unread' }),
          'unread.snap',
        );
        writeFileSync(
          fileUnread,
          [
            '// Jest Snapshot v1',
            '',
            'exports [`spaced key 1`] = `"x"`;',
            '',
          ].join('\n'),
        );
        then('it fails loud rather than grade zero renders', async () => {
          const error = await getError(async () =>
            getAllRendersRecorded({ file: fileUnread }),
          );
          expect(error).toBeInstanceOf(MalfunctionError);
          expect(error.message).toContain(
            'the render audit found a .snap with content but no entry header it can read',
          );
          if (!(error instanceof MalfunctionError)) throw error;
          expect(error.metadata).toMatchObject({ parsed: 0, declared: 0 });
        });
      },
    );
  });

  given('[case4] a render line that itself ends in `;', () => {
    // the entry boundary is a close followed by the next entry (or the file end), so a render
    // line that ends in the same two characters never cuts its entry short
    const file = join(
      genTempDir({ slug: 'render-contract-boundary' }),
      'boundary.snap',
    );
    writeFileSync(
      file,
      [
        'exports[`first entry 1`] = `',
        '"🐈 smooth sailin!',
        '',
        '🧿 a line that ends in a close`;',
        '   └─ the rest of the first render',
        '"',
        '`;',
        '',
        'exports[`second entry 1`] = `"🐈 caught it!"`;',
        '',
      ].join('\n'),
    );

    when('[t0] the audit reads it', () => {
      then('both entries parse, each with its whole body', () => {
        const renders = getAllRendersRecorded({ file });
        expect(renders.map((render) => render.key)).toEqual([
          'first entry 1',
          'second entry 1',
        ]);
        expect(renders[0]?.body).toContain(
          '   └─ the rest of the first render',
        );
        expect(renders[1]?.body).toEqual('🐈 caught it!');
      });
    });
  });

  given('[case5] synthetic offenders for each audit selector', () => {
    // the corpus passes every selector, so each must also be shown to fire on an offender —
    // else a selector that always passed would keep the audit green and blind
    const asRender = (input: { lines: string[] }): RenderRecorded => ({
      file: 'synthetic.snap',
      key: 'synthetic 1',
      body: input.lines.join('\n'),
    });
    const guardianOrphan = asRender({
      lines: ['🧿 security.habitat.redteam --mode plan', '   └─ scope: .'],
    });
    const gateTwoHeaders = asRender({
      lines: [
        '🦺 deploy.uses --env prod',
        '   └─ authorized via local unlimited grant',
        '🦺 deploy.uses --env prod',
      ],
    });
    const gateTreeless = asRender({
      lines: [
        '🦺 deploy.uses --env prod',
        'authorized via local unlimited grant',
      ],
    });
    const gateSound = asRender({
      lines: [
        '🦺 deploy.uses --env prod',
        '   └─ authorized via local unlimited grant',
      ],
    });

    when('[t0] a guardian render opens on 🧿 with no mascot', () => {
      then('it is a ghlitch render, so the audit reads it', () => {
        expect(isGhlitchRender(guardianOrphan)).toBe(true);
      });
      then('its header is named as off its mascot', () => {
        expect(getHeadersOffMascot(guardianOrphan)).toEqual([
          'synthetic.snap :: synthetic 1 :: 🧿 security.habitat.redteam --mode plan',
        ]);
      });
    });

    when(
      '[t1] a gate confirmation reprints its header or loses its tree',
      () => {
        then('neither reads as gate-confirmation shaped', () => {
          expect(isGateConfirmationShaped(gateTwoHeaders)).toBe(false);
          expect(isGateConfirmationShaped(gateTreeless)).toBe(false);
        });
        then('the sound shape still reads as gate-confirmation shaped', () => {
          expect(isGateConfirmationShaped(gateSound)).toBe(true);
        });
      },
    );

    when('[t2] a success mascot fronts a halted tree', () => {
      // the init bind failure once rendered `anchors away!` over a halted close
      const successOverHalt = asRender({
        lines: [
          '🐈 anchors away!',
          '',
          '🧿 security.habitat.redteam init --scope . --grain leak',
          '   ├─ route: .behavior/v<date>.guardian-redteam.grain=leak/',
          '   └─ halted: 💥 MalfunctionError: route scaffolded, but the bind did not take',
        ],
      });
      const failureOverHalt = asRender({
        lines: [
          '🐈 wet paws...',
          '',
          '🧿 security.habitat.redteam init --scope . --grain leak',
          '   └─ halted: 💥 MalfunctionError: route scaffolded, but the bind did not take',
        ],
      });
      then('the success mascot is named as over a failure', () => {
        expect(getSuccessMascotsOverFailure(successOverHalt)).toEqual([
          'synthetic.snap :: synthetic 1 :: 🐈 anchors away!',
        ]);
      });
      then('a failure mascot over the same tree is clean', () => {
        expect(getSuccessMascotsOverFailure(failureOverHalt)).toEqual([]);
      });
    });
  });
});
