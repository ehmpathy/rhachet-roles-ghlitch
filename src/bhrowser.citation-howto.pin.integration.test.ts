import { readFileSync } from 'fs';
import { join } from 'path';
import { given, then, when } from 'test-fns';

/**
 * .what = clamps the structural invariants of the bhrowser citation howto — the operative gather
 *         instrument every cited claim in the guardian inventory runs through.
 * .why  = the howto (`.agent/repo=.this/role=any/briefs/howto.cite-via-bhrowser`) documents three
 *         defect workarounds in prose: a pinned `playwright@<ver>` hoist (the chromium-probe abort),
 *         an absolute `--play` path (the relative-path rejection), and a distinct-per-agent
 *         `<your-own-session>` name (the shared-session tab race). the end-to-end loop needs a live
 *         browser + network, so it cannot be run hermetically (rule.forbid.unit.remote-boundaries);
 *         but the three DOCUMENTED defect paths ARE clampable structurally against the doc itself —
 *         so a future edit that reintroduces a relative `--play`, a literal shared session, a
 *         hardcoded `--url` literal, or a drifted pin fails ci instead of a silent debug-hours
 *         friction for the next agent (rule.forbid.friction-hazards). the residual — that the live loop is not
 *         hermetically testable — is recorded as an explicit coverage exception in the execution
 *         yield's deferral log, so the gap is tracked, not silent.
 * .note = reads from disk, so it is an integration test, not a unit test
 *         (rule.forbid.unit.remote-boundaries). paths are built from __dirname, so the run is
 *         cwd-independent and hermetic — it reads only this repo's own shipped howto + package.json.
 */

const repoRoot = join(__dirname, '..');
const howtoPath = join(
  repoRoot,
  '.agent/repo=.this/role=any/briefs/howto.cite-via-bhrowser.[lesson].md',
);
const packageJsonPath = join(repoRoot, 'package.json');

// every `playwright@<ver>` token in the howto prose (the .prereqs hoist line + the defect-table row).
const getPlaywrightPinsFromHowto = (howto: string): string[] =>
  howto.match(/playwright@\S+/g) ?? [];

// trim tail markdown punctuation off a `playwright@…` run (a backtick from an inline-code span, or a
// `)`,/`.` from prose), so the compare is against the bare `playwright@<ver>`.
const asBarePlaywrightPin = (raw: string): string =>
  raw.replace(/[^0-9A-Za-z.@]+$/, '');

// every value passed to a `--session` flag in a howto command line, with tail markdown punctuation
// (a tail backtick) trimmed — so the compare sees the bare argument.
const getSessionArgValuesFromHowto = (howto: string): string[] =>
  (howto.match(/--session (\S+)/g) ?? []).map((match) =>
    match.replace(/^--session /, '').replace(/[^A-Za-z0-9<>_-]+$/, ''),
  );

// every value passed to a `--play` flag in a howto command line (only true command invocations
// carry `--play <value>`; the inline `` `--play` `` prose references have no value after them).
const getPlayArgValuesFromHowto = (howto: string): string[] =>
  (howto.match(/--play (\S+)/g) ?? []).map((match) =>
    match.replace(/^--play /, ''),
  );

// every value passed to a `--url` flag in a howto command line, with the wrap quotes stripped — so
// the compare sees the bare argument (the `<that-tab-url>` placeholder).
const getUrlArgValuesFromHowto = (howto: string): string[] =>
  (howto.match(/--url (\S+)/g) ?? []).map((match) =>
    match.replace(/^--url /, '').replace(/^['"]|['"]$/g, ''),
  );

describe('bhrowser citation howto structural invariants', () => {
  const howto = readFileSync(howtoPath, 'utf-8');

  given('the howto and package.json', () => {
    when('the documented pin is compared against the devDependency', () => {
      then(
        'every playwright pin in the howto matches the devDependency',
        () => {
          const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as {
            devDependencies?: Record<string, string>;
          };
          const pinned = pkg.devDependencies?.playwright;
          expect(pinned).toBeDefined();

          // the howto carries the pin in two independent prose spots (the .prereqs hoist line and
          // the upstream-defects table row). assert BOTH exist and that EVERY `playwright@<ver>`
          // occurrence resolves to the devDependency pin — so a drift in either spot fails ci,
          // not just the first (rule.forbid.maintenance-hazards: a single-point guard on a
          // two-point fact lets the untested occurrence drift silently).
          const pins = getPlaywrightPinsFromHowto(howto);
          expect(pins.length).toBeGreaterThanOrEqual(2);
          pins.forEach((pin) => {
            expect(asBarePlaywrightPin(pin)).toEqual(`playwright@${pinned}`);
          });
        },
      );
    });
  });

  given('the howto gather-loop commands', () => {
    when('the session flags are read', () => {
      then(
        'every --session uses the distinct-per-agent placeholder, never a literal name',
        () => {
          // the shared-session tab-focus race (rule.require.bhrowser-own-session) is removed only if
          // every command carries the `<your-own-session>` placeholder, so a copy-pasted gather is
          // distinct-by-construction. a literal name (e.g. `guardian-wifi`) reopens the race — clamp
          // it so a future edit cannot silently reintroduce a shared session.
          const sessions = getSessionArgValuesFromHowto(howto);
          expect(sessions.length).toBeGreaterThan(0);
          sessions.forEach((session) => {
            expect(session).toEqual('<your-own-session>');
          });
        },
      );
    });

    when('the play flags are read', () => {
      then('every --play path is absolute, never relative', () => {
        // the relative-`--play` rejection is worked around only by an absolute path. clamp that
        // every command invocation passes an absolute path (`"$PWD/…"` or `/…`), so a future edit
        // cannot reintroduce the documented `ERR_INVALID_MODULE_SPECIFIER` defect (rule.forbid.friction-hazards).
        const plays = getPlayArgValuesFromHowto(howto);
        expect(plays.length).toBeGreaterThan(0);
        plays.forEach((play) => {
          expect(play).toMatch(/^"?(\$PWD|\/)/);
        });
      });
    });

    when('the url flags are read', () => {
      then(
        'every --url uses the placeholder, never a hardcoded literal',
        () => {
          // the third documented defect: `--url` failed on a lone trailing slash, worked around by
          // "pass the `--url` exactly as browser.describe reports it". clamp that every command carries
          // the `<that-tab-url>` placeholder (never a hand-typed literal url that could drop or add a
          // trailing slash), so a future edit cannot reintroduce the url-verification mismatch — the
          // structural twin of the session/--play clamps, completing coverage of all three documented
          // defects (rule.forbid.friction-hazards).
          const urls = getUrlArgValuesFromHowto(howto);
          expect(urls.length).toBeGreaterThan(0);
          urls.forEach((url) => {
            expect(url).toEqual('<that-tab-url>');
          });
        },
      );
    });
  });
});
