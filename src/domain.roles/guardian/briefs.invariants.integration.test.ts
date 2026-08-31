import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { given, then, when } from 'test-fns';

/**
 * .what = clamps the content contract of the guardian's shipped markdown product
 * .why  = the guardian's deliverable IS markdown a human reads (cited hazard/eliminate/
 *         detect briefs). the shape a role-registration snapshot verifies (slug/name/dirs)
 *         does not cover that product. this integration test reads the shipped briefs
 *         and asserts the invariants nine rounds of peer review kept catching by hand:
 *         every guidance brief carries both disclaimers; every case research doc stands on
 *         >= 7 distinct bhrowser-read sources; no citation leaks in via WebSearch/WebFetch.
 *         a future edit that drops a disclaimer or lets a source count fall to 6 now fails
 *         ci instead of shipping as friction (rule.require.behavior-intent-coverage,
 *         rule.forbid.friction-hazards, rule.require.clamp-edge-cases).
 * .note = reads the filesystem, so it is an integration test, not a unit test
 *         (rule.forbid.unit.remote-boundaries). paths are built from __dirname, so the run
 *         is cwd-independent and hermetic — it reads only this package's own shipped briefs.
 */

const briefsDir = join(__dirname, 'briefs');
const attackVectorDir = join(briefsDir, 'inventory.of=attack.vector');

const dirForVector = (vectorSlug: string): string =>
  join(attackVectorDir, vectorSlug);

// the three causal-chain nodes each case is inventoried across
const NODES = [
  'exposure.mechanism',
  'symptom.mechanism',
  'symptom.expression',
] as const;

// extract the case slug from ANY of the three node-brief filenames, or null if the file is not one.
// derives from all three patterns (not just exposure.mechanism), so a case discovered by ANY node
// enters coverage — a symptom.* brief shipped without an exposure.mechanism kin node can no longer
// slip past every invariant (rule.require.clamp-edge-cases). named so the derivation reads as
// intent, not inline regex decode (rule.require.named-transformers).
const asCaseSlugFromBriefFilename = (filename: string): string | null => {
  for (const node of NODES) {
    const slug = filename.match(
      new RegExp(`^inventory\\.of=${node}\\.case=(.+)\\.md$`),
    )?.[1];
    if (slug) return slug;
  }
  return null;
};

// the vectors are DERIVED from disk (exposure=* dirs), never hand-listed — so a 2nd attack vector
// added later is auto-covered, the same "derive, don't hardcode" principle applied to the cases
// below, carried up one level so coverage cannot silently lapse (rule.require.clamp-edge-cases).
const VECTORS = readdirSync(attackVectorDir)
  .filter((entry) => entry.startsWith('exposure='))
  .sort();

// reduce a set of filenames to the distinct case slugs they name, across all three node patterns.
// a module-level transformer so the readdir→derive pipeline reads as intent, not an inline
// map+type-predicate decode in the caller (rule.require.named-transformers). a non-node filename
// (a readme, the sources trust rollup) legitimately derives to null and is dropped here; an orphan
// case that ships one node but not its kin is caught by name in the completeness guard below.
const asCaseSlugsFromFilenames = (filenames: string[]): string[] =>
  filenames
    .map(asCaseSlugFromBriefFilename)
    .filter((slug): slug is string => !!slug);

// the cases for a vector are DERIVED from disk as the UNION across all three node patterns — so a
// case that ships any node brief is covered, and an orphan (a case that lacks a node file) is
// caught by the completeness guard below rather than silently omitted (fail-closed).
const casesForVector = (vectorSlug: string): string[] =>
  [
    ...new Set(asCaseSlugsFromFilenames(readdirSync(dirForVector(vectorSlug)))),
  ].sort();

// every case research doc across every vector — each makes factual claims, so each owes >= 7 sources
const caseResearchDocs = VECTORS.flatMap((vectorSlug) =>
  casesForVector(vectorSlug).flatMap((caseSlug) =>
    NODES.map((node) => ({
      slug: `${vectorSlug}/${node}.case=${caseSlug}`,
      path: join(
        dirForVector(vectorSlug),
        `inventory.of=${node}.case=${caseSlug}.md`,
      ),
    })),
  ),
);

// a CONVERGENT node is a shared endpoint several cases point to — named
// `inventory.of=<node>.convergent=<slug>.md` (a `convergent=`, not a `case=`). the causal frame is
// many-to-many, so the same endpoint (e.g. account-takeover) is reached by several cases; rather than
// restate its identical tail in each case brief, it lives once here and cases link to it. a convergent
// doc is a FIRST-CLASS research doc: it makes its own factual claims, so it owes its own >= 7 sources +
// both disclaimers, and (when it is a symptom.expression surface) the escalation carve-out — exactly
// like a case node. derived from disk by the `convergent=` filename, so a 2nd convergent node is
// auto-covered (rule.require.clamp-edge-cases).
const asConvergentFromBriefFilename = (
  filename: string,
): { node: string; slug: string } | null => {
  for (const node of NODES) {
    const slug = filename.match(
      new RegExp(`^inventory\\.of=${node}\\.convergent=(.+)\\.md$`),
    )?.[1];
    if (slug) return { node, slug };
  }
  return null;
};

const convergentDocs = VECTORS.flatMap((vectorSlug) =>
  readdirSync(dirForVector(vectorSlug))
    .map((filename) => ({
      filename,
      parsed: asConvergentFromBriefFilename(filename),
    }))
    .filter(
      (
        entry,
      ): entry is {
        filename: string;
        parsed: { node: string; slug: string };
      } => !!entry.parsed,
    )
    .map((entry) => ({
      slug: `${vectorSlug}/${entry.parsed.node}.convergent=${entry.parsed.slug}`,
      path: join(dirForVector(vectorSlug), entry.filename),
      node: entry.parsed.node,
      convergentSlug: entry.parsed.slug,
    })),
);

// the convergent slugs a doc points to (via a `convergent=<slug>` reference in its prose / .see also).
const getConvergentPointers = (content: string): string[] => [
  ...new Set(
    (content.match(/convergent=([a-z0-9-]+)/g) ?? []).map((m) =>
      m.replace('convergent=', ''),
    ),
  ),
];

// every research doc that makes factual claims = the per-case node docs + the convergent nodes. each
// owes the citation guards (>= 7 sources, no WebSearch/WebFetch, a read-date), the answer content, and
// enters the cross-doc source-id + shared-quote scans. (a case node counts its >= 7 across the case ∪
// convergent union; a convergent node stands on its own >= 7 — both handled by getEffectiveSourceUrls.)
const researchDocs = [...caseResearchDocs, ...convergentDocs];

// the symptom.expression docs are the "how would i know i'm compromised right now?" surface — the node
// a router or a search surfaces for an active-compromise question. motto.not-security-advice names its
// own enforcement: "an active-compromise-shaped case without the escalation carve-out = blocker". so
// these docs specifically owe the escalation carve-out, not only the base disclaimers. a symptom.expression
// CONVERGENT node (e.g. convergent=account-takeover) is such a surface too — a reader lands on it for the
// "am i compromised?" question — so it owes the carve-out exactly like a case symptom.expression doc.
const symptomExpressionDocs = [
  ...caseResearchDocs.filter((doc) =>
    doc.slug.includes('symptom.expression.case='),
  ),
  ...convergentDocs.filter((doc) => doc.node === 'symptom.expression'),
];

// every guidance doc must carry both disclaimers: the case docs + the convergent nodes + the two frame
// lessons + each vector readme. the sources trust rollup is nav — exempt from the recommendation disclaimer.
const guidanceDocs = [
  ...caseResearchDocs,
  ...convergentDocs,
  {
    slug: 'define.causal-chain',
    path: join(briefsDir, 'define.causal-chain.[lesson].md'),
  },
  {
    slug: 'howto.apply-causal-chain',
    path: join(briefsDir, 'howto.apply-causal-chain.[lesson].md'),
  },
  ...VECTORS.map((vectorSlug) => ({
    slug: `${vectorSlug}/readme`,
    path: join(dirForVector(vectorSlug), 'readme.md'),
  })),
];

// read a brief, or throw an error that names the absent file and the likely fix — a bare
// readFileSync ENOENT dumps a raw errno path with no hint that a case brief is missing or
// mis-pathed; this states which brief the suite expected and where (rule.require.errors-name-the-fix).
const readBrief = (path: string): string => {
  if (!existsSync(path))
    throw new Error(
      `guardian.briefs invariant: expected brief absent at ${path} — a case node brief was renamed, moved, or not yet written; add it or fix the path`,
    );
  return readFileSync(path, 'utf-8');
};

// the recommendation disclaimer's lead-in varies per doc ("the guidance below" vs "any guidance
// here"), but its body is identical across every guidance doc (up to `>` markers + line-wrap, which
// normalizeQuote collapses). the assertion is a `toContain` of the WHOLE body as one contiguous run,
// so it catches a reworded or truncated body (either breaks the contiguous match) that loose
// per-phrase checks would miss; extra prose before/after the body is allowed by design (the body is
// embedded in surrounding text).
const DISCLAIMER_BODY =
  'offered to the best of our knowledge from the info found in research — it carries **no guarantee of success or outcome**, and must be reviewed by a qualified security professional against your own real network, device, and threat model before reliance. it is groundwork for that review, not a substitute for it.';

const normalizeQuote = (s: string): string =>
  s.replace(/^\s*>\s?/gm, '').replace(/\s+/g, ' ');

// isolate the `## .sources` section, then pull every distinct https url from its
// `- [S#] … — https://…` bullet lines. the discovery-disclaimer line that mentions
// WebSearch/WebFetch is not a `- [S` bullet, so it never counts as a source.
const getSourceBullets = (content: string): string[] => {
  const sourcesStart = content.indexOf('## .sources');
  if (sourcesStart < 0) return [];
  const section = content.slice(sourcesStart);
  return section.split('\n').filter((line) => /^- \[S/.test(line.trim()));
};

const getDistinctSourceUrls = (content: string): string[] => {
  const urls = getSourceBullets(content)
    .map((line) => line.match(/https:\/\/\S+/)?.[0])
    .filter((url): url is string => !!url)
    // trim tail bullet punctuation (`)`, `,`, `.`, `]`) off the captured `\S+` run, so the same
    // page written as `…/a)` and `…/a` dedupes to one — a sloppy future bullet cannot pad the
    // >= 7 count past real breadth (rule.require.seven-distinct-citations: no pad-the-count).
    .map((url) => url.replace(/[).,\]]+$/, ''));
  return [...new Set(urls)];
};

// each convergent slug -> its own distinct source urls. a case that deduped its shared tail into a
// convergent node can count that node's citations toward its own >= 7 (the case ∪ convergent union), so
// the case legitimately drops below 7 OF ITS OWN — the union, not the case alone, is what
// rule.require.seven-distinct-citations bounds for a convergent-linked case. defined after
// getDistinctSourceUrls (which it calls), so no use-before-define.
const convergentUrlsBySlug = new Map<string, string[]>(
  convergentDocs.map((doc) => [
    doc.convergentSlug,
    getDistinctSourceUrls(readFileSync(doc.path, 'utf-8')),
  ]),
);

// the effective distinct-source count for a case doc = its own urls ∪ the urls of every convergent node
// it points to. for a case doc with no convergent pointer (every exposure/symptom.mechanism doc, and any
// symptom.expression case that keeps its whole tail), the union is just its own urls, so the bound is
// unchanged. only a case that deduped a tail into a convergent node draws on the union.
const getEffectiveSourceUrls = (doc: { path: string }): string[] => {
  const content = readFileSync(doc.path, 'utf-8');
  const own = getDistinctSourceUrls(content);
  const shared = getConvergentPointers(content).flatMap(
    (slug) => convergentUrlsBySlug.get(slug) ?? [],
  );
  return [...new Set([...own, ...shared])];
};

// pull the `[S#] → url` pairs from a doc's `## .sources` bullets. each `[S#]` id is cited verbatim in
// several sibling case docs (the source registry carries no urls — each brief re-types its own), so this
// lets a guard cross-check that one id maps to ONE url everywhere, catching a hand-retyped citation
// that drifted a character (rule.require.clamp-edge-cases; the decompose-for-recompose gap the l3 flagged).
const getSourceIdUrlPairs = (
  content: string,
): Array<{ id: string; url: string }> =>
  getSourceBullets(content)
    .map((line) => {
      const id = line.match(/\[(S\d+)\]/)?.[1];
      const url = line.match(/https:\/\/\S+/)?.[0]?.replace(/[).,\]]+$/, '');
      return id && url ? { id, url } : null;
    })
    .filter((pair): pair is { id: string; url: string } => !!pair);

// every distinct hazard case slug across every vector, plus `trust` (the sources rollup is a legitimate
// `case=trust`). the allowlist a cross-case prose reference must land in — so a rename that orphans a
// `case=<slug>` mention in a sibling doc is caught, not left to quietly lie (rule.require.clamp-edge-cases).
const allowedCaseSlugReferences = new Set([
  ...VECTORS.flatMap((vectorSlug) => casesForVector(vectorSlug)),
  'trust',
]);

// extract every `case=<slug>` token a doc mentions in prose / `.see also`. the `case=$sub` placeholder
// (a `$`, not a slug char) never matches, so a literal template reference is not a false positive.
const getCaseSlugMentions = (content: string): string[] =>
  (content.match(/case=([a-z0-9-]+)/g) ?? []).map((m) =>
    m.replace('case=', ''),
  );

// extract the long verbatim quotes (>= 40 chars between double-quotes) from a doc, with `>` blockquote
// markers + line-wraps collapsed first so a quote that spans blockquote lines reads as one span. a
// short quoted term (an inline `"the wrong agent"`) is below the length floor and skipped, so the map
// holds only the multi-sentence citations that are actually retyped across kin docs.
const getLongQuotes = (content: string): string[] =>
  (normalizeQuote(content).match(/"[^"]{40,}"/g) ?? []).map((q) =>
    q.replace(/\s+/g, ' ').trim(),
  );

const roleReadmePath = join(__dirname, 'readme.md');

// remove every fenced-code block and double-quoted citation from a body via an EXPLICIT open/close
// toggle scan — never a chained non-greedy regex. a straight `"` has no distinct open vs close glyph,
// so alternation (odd occurrence opens, even closes) is its ONLY well-defined pair rule; a single pass
// with explicit state realizes exactly that, so it cannot mis-pair the way `/"[\s\S]*?"/g` can when a
// citation nests a quote (e.g. `"a "b""` — the regex leaves a stray tail; this scan does not). it is
// fail-closed by construction: content OUTSIDE a quote/fence is always retained (so an acronym in
// author prose is never silently swallowed — the exact fail-open rule.forbid.maintenance-hazards /
// rule.forbid.behavior-hazards forbid), and an unbalanced `"`/fence (odd count) throws loud rather
// than carve the doc (rule.require.failloud). a ``` toggle is honored only when not inside a quote, so
// a backtick run inside a citation does not spuriously open a fence.
const stripQuotedAndFenced = (body: string): string => {
  let out = '';
  let inQuote = false;
  let inFence = false;
  let i = 0;
  while (i < body.length) {
    if (!inQuote && body.startsWith('```', i)) {
      inFence = !inFence;
      i += 3;
      continue;
    }
    if (inFence) {
      i += 1;
      continue;
    }
    if (body[i] === '"') {
      inQuote = !inQuote;
      i += 1;
      continue;
    }
    if (inQuote) {
      i += 1;
      continue;
    }
    out += body[i];
    i += 1;
  }
  if (inQuote)
    throw new Error(
      'getProseText: unbalanced double-quote — a citation opened but never closed would swallow the doc tail and blind the acronym guard; fix the stray quote',
    );
  if (inFence)
    throw new Error(
      'getProseText: unbalanced code fence — a fence opened but never closed would swallow the doc tail and blind the acronym guard; fix the stray fence',
    );
  return out;
};

// reduce a brief to its prose, so the check sees only the author's own words. verbatim citations
// keep their source's original letters, so each quote or literal is stripped first: the sources
// section (source titles carry uppercase), fenced code, any double-quoted span (a verbatim citation
// — may span lines, may sit inline or under a `>`), every residual `>` blockquote line, and inline
// `code` spans.
const getProseText = (content: string): string => {
  const sourcesAt = content.indexOf('## .sources');
  const body = sourcesAt >= 0 ? content.slice(0, sourcesAt) : content;

  return stripQuotedAndFenced(body)
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('>')) // residual blockquote lines
    .map((line) => line.replace(/`[^`]*`/g, '')) // inline code spans
    .join('\n');
};

// the shouted-acronym guard is an ALLOWLIST, not a blocklist — it flags *any* 2+-char capital run
// left in prose, so a future case's new acronym (eap, tkip, radius, ccmp, …) is caught by default
// rather than a silent pass through a fixed list (rule.require.clamp-edge-cases: clamp the class,
// not a point). the only uppercase runs allowed in prose are brand/org proper nouns; verbatim
// quotes, source titles, and code are stripped first, so those keep their original letters intact.
const ALLOWED_UPPERCASE = new Set([
  'CISA',
  'NIST',
  'MITRE',
  'MDN',
  'FTC',
  'EFF',
  'OWASP',
  'CVE',
  'KRACK',
  'IEEE', // standards body (IEEE 802.11)
]);

// every 2+-char run of capitals/digits in prose that is neither an allowlisted proper noun nor a
// source-list reference anchor (`[S1]`, `[S12]` — a citation marker, legitimately uppercase).
const getShoutedAcronymsInProse = (content: string): string[] =>
  (
    getProseText(content)
      // strip the one allowed compound proper noun as a UNIT, so its fragments (ATT, CK) are not
      // individually allowlisted — an unrelated future bare `ATT` or `CK` is still flagged.
      .replace(/ATT&CK/g, '')
      .match(/\b[A-Z][A-Z0-9]+\b/g) ?? []
  ).filter((token) => !ALLOWED_UPPERCASE.has(token) && !/^S\d+$/.test(token));

// extract the lead glyph from each persona example chat line (`- "<glyph> phrase..." — sense`).
// a module-level transformer, so it matches every sibling extraction's shape rather than an inline
// decode in a then() body (rule.require.named-transformers).
const getExampleChatGlyphsFromPersona = (persona: string): string[] =>
  (persona.match(/^- "(\S+) /gm) ?? []).map((line) =>
    line.replace(/^- "/, '').trim(),
  );

// slice the body under a `## ` marker, up to the next `## ` marker (or end of doc). lets a guard
// assert content lives INSIDE a named section, not merely somewhere in the doc — a module-level
// transformer so the slice reads as intent, not an inline decode (rule.require.named-transformers).
const getSection = (content: string, marker: string): string => {
  const start = content.indexOf(marker);
  if (start < 0) return '';
  const after = content.slice(start + marker.length);
  const nextMarkerAt = after.search(/\n## /);
  return nextMarkerAt < 0 ? after : after.slice(0, nextMarkerAt);
};

describe('guardian.briefs invariants', () => {
  // non-empty guard: every guard below iterates a disk-derived set (VECTORS, casesForVector,
  // caseResearchDocs). a forEach over an EMPTY set passes with zero assertions — so an empty or
  // mis-pathed inventory tree would let the whole suite vacuous-pass green (rule.forbid.failhide).
  // clamp the sets as non-empty up front, so a broken path or a wiped tree fails loud here instead
  // of a silent all-green (rule.require.clamp-edge-cases: clamp the vacuous-pass class).
  given('the guardian inventory tree', () => {
    when('the vectors and cases are derived from disk', () => {
      then('at least one attack vector ships', () => {
        expect(VECTORS.length).toBeGreaterThan(0);
      });

      then('every shipped vector ships at least one case', () => {
        VECTORS.forEach((vectorSlug) => {
          expect(casesForVector(vectorSlug).length).toBeGreaterThan(0);
        });
      });

      then('the guidance and case-research doc sets are non-empty', () => {
        expect(guidanceDocs.length).toBeGreaterThan(0);
        expect(caseResearchDocs.length).toBeGreaterThan(0);
      });
    });
  });

  // completeness guard: every discovered case must ship ALL three node briefs. cases are derived as
  // the union across the three node patterns, so an orphan (a case with a symptom.* brief but no
  // exposure.mechanism kin, or vice versa) is caught here by name — fail loud, not fail open, per
  // rule.require.failloud + rule.require.clamp-edge-cases.
  given('the guardian case node completeness', () => {
    VECTORS.forEach((vectorSlug) => {
      casesForVector(vectorSlug).forEach((caseSlug) => {
        when(`[${vectorSlug}/case=${caseSlug}] is inventoried`, () => {
          NODES.forEach((node) => {
            then(`it ships the ${node} node brief`, () => {
              const path = join(
                dirForVector(vectorSlug),
                `inventory.of=${node}.case=${caseSlug}.md`,
              );
              expect(existsSync(path)).toEqual(true);
            });
          });
        });
      });
    });
  });

  given('the guardian guidance briefs', () => {
    guidanceDocs.forEach((doc) => {
      when(`[${doc.slug}] is read`, () => {
        const content = readBrief(doc.path);

        then('it carries the not-security-advice motto', () => {
          expect(content).toContain('not professional security advice');
        });

        then(
          'it carries the full recommendation disclaimer body verbatim',
          () => {
            expect(content).toContain('recommendation disclaimer');
            // asserts the whole disclaimer body is present as one contiguous run (subsumes the three
            // qualifiers: best-knowledge, no-guarantee, review-by-professional), normalized for `>`
            // markers + line-wrap so it is reordering-of-wrapping-safe. it is a `toContain` on the
            // full body, so it catches a reworded or internally-reordered body; extra text before or
            // after the body is allowed (the body is embedded in surrounding prose by design).
            expect(normalizeQuote(content)).toContain(DISCLAIMER_BODY);
          },
        );
      });
    });
  });

  given('the guardian case research docs', () => {
    researchDocs.forEach((doc) => {
      when(`[${doc.slug}] is read`, () => {
        const content = readBrief(doc.path);

        then('it cites at least 7 distinct bhrowser-read sources', () => {
          // effective = own ∪ any convergent node it points to. a case that deduped its shared tail into
          // a convergent node counts that node's citations here (the case ∪ convergent union); a
          // convergent node has no pointer of its own, so its effective set is its own >= 7. either way
          // the doc stands on >= 7 distinct bhrowser-read sources (rule.require.seven-distinct-citations).
          expect(getEffectiveSourceUrls(doc).length).toBeGreaterThanOrEqual(7);
        });

        then('no source bullet cites WebSearch or WebFetch', () => {
          getSourceBullets(content).forEach((bullet) => {
            expect(bullet).not.toContain('WebFetch');
            expect(bullet).not.toContain('WebSearch');
            expect(bullet).toMatch(/https:\/\//);
          });
        });

        // freshness clamp: the trust-tier refresh mechanism (inventory.of=sources.case=trust) rests
        // on a per-doc read-date in the `## .sources` preamble — a re-verification pass confirms the
        // date and bumps it. an edit that drops the date silently breaks that freshness contract with
        // no test to catch it. clamp the read-date as an iso `YYYY-MM-DD` anchor so it cannot vanish
        // unnoticed (rule.require.clamp-edge-cases; flagged by the l3 review as a cheap, high-value guard).
        then('its sources section records an iso read-date', () => {
          expect(getSection(content, '## .sources')).toMatch(
            /\b\d{4}-\d{2}-\d{2}\b/,
          );
        });
      });
    });
  });

  // answer-content guard: the guardian's actual per-case deliverable is the answer substance —
  // hazard → eliminate → detect → respond, plus an ordinal likelihood band. the disclaimer and
  // source-count guards above prove a doc is *cited and safe*, but not that it still *answers*.
  // clamp the answer content itself, so a future edit that drops the eliminate/detect/respond axes
  // or the likelihood band fails ci instead of a hollow doc that shipped its citations but lost the
  // guidance the guardian exists to deliver (rule.require.behavior-intent-coverage,
  // rule.require.clamp-edge-cases).
  //
  // .note on the band label: the vision named "an ordinal `pNN` bucket". the shipped docs realize
  // that intent as a `**band: <ordinal>**` prose label, a deliberate accepted deviation — a bare
  // `pNN` code injects a false precision the vision itself cautioned against ("honest about
  // under-quantification"), while `band:` states the same ordinal judgment in words a person reads.
  // the deviation is recorded in the vector readme's `## .the likelihood band` note and the yield's
  // deferred/deviation log; this guard locks `band:` as the shipped realization so it cannot drift.
  given('the guardian case answer content', () => {
    researchDocs.forEach((doc) => {
      when(`[${doc.slug}] is read`, () => {
        const content = readBrief(doc.path);

        then('it carries the answer-axes section', () => {
          expect(content).toContain('## .the answer axes');
        });

        then('the answer axes hold eliminate, detect, and respond', () => {
          const axes = getSection(content, '## .the answer axes');
          expect(axes).toContain('**eliminate**');
          expect(axes).toContain('**detect**');
          expect(axes).toContain('**respond**');
        });

        then('it carries an ordinal likelihood band', () => {
          const likelihood = getSection(content, '## .likelihood');
          expect(likelihood).toContain('band:');
        });
      });
    });
  });

  // escalation-carve-out guard: motto.not-security-advice enforces that an active-compromise-shaped
  // case must carry the escalation carve-out ("if you believe you are under active attack... disconnect,
  // change passwords from a trusted device, contact your security team or provider now"). the
  // symptom.expression node IS the "how would i know i'm compromised right now?" surface — the doc a
  // router or a search surfaces for that question — so each one owes the carve-out at the point of use,
  // not only the role readme. clamp it per-doc so a reader who lands directly on one gets the act-now
  // line, and a future case cannot ship a symptom.expression brief without it (rule.require.clamp-edge-cases,
  // rule.require.behavior-intent-coverage; flagged as a blocker by the l3 arch-defects review).
  given('the guardian active-compromise escalation carve-out', () => {
    then('the symptom.expression doc set is non-empty', () => {
      expect(symptomExpressionDocs.length).toBeGreaterThan(0);
    });

    symptomExpressionDocs.forEach((doc) => {
      when(`[${doc.slug}] is read`, () => {
        then('it carries the active-attack escalation carve-out', () => {
          // normalizeQuote folds the `>` blockquote markers + line-wrap the carve-out spans, so the
          // phrase matches as one contiguous run regardless of where the markdown wraps it.
          expect(normalizeQuote(readBrief(doc.path))).toContain(
            'under active attack or your accounts are compromised',
          );
        });
      });
    });
  });

  // citation-consistency guard: the same `[S#]` id is hand-retyped with its url in several sibling case
  // docs (the source registry carries no urls of its own). nothing stopped one copy drifting a character
  // from another. clamp that one id maps to exactly one url across every case doc, so a mis-transcribed
  // citation fails ci instead of two docs quietly citing the same source with different links
  // (rule.require.clamp-edge-cases; the decompose-for-recompose gap both l3 reviewers flagged).
  given('the guardian source-id citation consistency', () => {
    when('every case doc source bullet is cross-checked', () => {
      const idToUrls = new Map<string, Set<string>>();
      researchDocs.forEach((doc) => {
        getSourceIdUrlPairs(readBrief(doc.path)).forEach(({ id, url }) => {
          if (!idToUrls.has(id)) idToUrls.set(id, new Set());
          idToUrls.get(id)?.add(url);
        });
      });

      then('the citation set is non-empty', () => {
        expect(idToUrls.size).toBeGreaterThan(0);
      });

      then('each [S#] id maps to exactly one url across all case docs', () => {
        idToUrls.forEach((urls, id) => {
          // name the id + the distinct-url count, so a drift failure points straight at the culprit id
          expect({ id, distinctUrls: urls.size }).toEqual({
            id,
            distinctUrls: 1,
          });
        });
      });
    });
  });

  // shared-quote drift guard: a long verbatim citation (e.g. the NIST [S2] "WLAN component" sentence) is
  // hand-retyped byte-for-byte across several case docs — the url↔id guard above clamps the LINK, not the
  // QUOTE TEXT, so a quote could silently drift a character in one copy while its id/url stayed matched.
  // clamp the invariant directly, with no committed baseline: group every long quote by a folded key
  // (lowercase + every non-alphanumeric run collapsed to a single space); within a group, every exact
  // spelling must be identical. a copy that drifted a character (an em-dash→hyphen, a changed word) folds
  // to the same key but differs exact, so it is caught; a genuinely different quote from the same source (a
  // full vs a `...`-elided form — different WORDS, not just punctuation) folds to a different key and forms
  // its own group, so it is never a false positive (rule.require.clamp-edge-cases; the maintenance hazard
  // both l3 reviewers flagged). asserted, not snapshotted, so it needs no generated baseline and states the
  // invariant a future edit must keep.
  const asQuoteFoldKey = (quote: string): string =>
    quote
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();

  given('the guardian cross-doc shared quotes', () => {
    when('long quotes that are the same citation are compared', () => {
      const foldKeyToExactSpellings = new Map<string, Set<string>>();
      researchDocs.forEach((doc) => {
        getLongQuotes(readBrief(doc.path)).forEach((quote) => {
          const key = asQuoteFoldKey(quote);
          if (!foldKeyToExactSpellings.has(key))
            foldKeyToExactSpellings.set(key, new Set());
          foldKeyToExactSpellings.get(key)?.add(quote);
        });
      });

      then('the long-quote corpus is non-empty (guard is live)', () => {
        expect(foldKeyToExactSpellings.size).toBeGreaterThan(0);
      });

      then(
        'every quote that recurs as the same citation is byte-identical',
        () => {
          foldKeyToExactSpellings.forEach((spellings, key) => {
            // one folded key with >1 distinct exact spelling = a drifted copy of one citation. name the key
            // + the count so a drift failure points straight at the culprit citation.
            expect({ key, distinctSpellings: spellings.size }).toEqual({
              key,
              distinctSpellings: 1,
            });
          });
        },
      );
    });
  });

  // cross-case reference guard: 14 files reference sibling cases by `case=<slug>` in prose / `.see also`
  // — core to the vision's "many-to-many, diagnosis is the path" value. a future case rename would
  // silently orphan every mention that pointed at the old slug (no test fails, the docs just quietly
  // lie). clamp every `case=<slug>` mention to a real disk-derived case (or `trust`), the inverse of the
  // readme/trust "does the derived case appear" checks (rule.require.clamp-edge-cases; l3-flagged).
  given('the guardian cross-case prose references', () => {
    const docsToScan = [
      ...researchDocs,
      ...VECTORS.flatMap((vectorSlug) => [
        {
          slug: `${vectorSlug}/readme`,
          path: join(dirForVector(vectorSlug), 'readme.md'),
        },
        {
          slug: `${vectorSlug}/sources.trust`,
          path: join(
            dirForVector(vectorSlug),
            'inventory.of=sources.case=trust.md',
          ),
        },
      ]),
    ];

    docsToScan.forEach((doc) => {
      when(`[${doc.slug}] is read`, () => {
        then('every case=<slug> mention names a real derived case', () => {
          getCaseSlugMentions(readBrief(doc.path)).forEach((slug) => {
            expect({
              slug,
              known: allowedCaseSlugReferences.has(slug),
            }).toEqual({ slug, known: true });
          });
        });
      });
    });
  });

  given('the guardian brief inventory', () => {
    when('the invariant matrix is computed', () => {
      const matrix = guidanceDocs.map((doc) => {
        const content = readBrief(doc.path);
        const isCaseDoc = caseResearchDocs.some((d) => d.slug === doc.slug);
        const isConvergentDoc = convergentDocs.some((d) => d.slug === doc.slug);
        return {
          slug: doc.slug,
          isCaseDoc,
          isConvergentDoc,
          hasMotto: content.includes('not professional security advice'),
          hasDisclaimer: content.includes('recommendation disclaimer'),
          // own distinct sources (the count in the doc's own `## .sources`)
          sourceCount: getDistinctSourceUrls(content).length,
          // own ∪ any convergent node it points to — the count rule.require.seven-distinct-citations
          // bounds for a convergent-linked case (a deduped case's own count may be < 7; its union is not)
          effectiveSourceCount: getEffectiveSourceUrls(doc).length,
        };
      });

      // independent expectations, so the block does not stand on the snapshot alone — a careless
      // `--resnap` that baked in a drifted matrix (a flipped disclaimer flag, a dropped source)
      // is still caught here (rule.forbid.failhide: no snapshot without assertions).
      then('every guidance doc carries both disclaimers', () => {
        matrix.forEach((row) => {
          expect(row.hasMotto).toEqual(true);
          expect(row.hasDisclaimer).toEqual(true);
        });
      });

      then(
        'every case + convergent doc stands on >= 7 distinct sources (case ∪ convergent)',
        () => {
          matrix
            .filter((row) => row.isCaseDoc || row.isConvergentDoc)
            .forEach((row) => {
              expect(row.effectiveSourceCount).toBeGreaterThanOrEqual(7);
            });
        },
      );

      then('it matches the expected snapshot', () => {
        expect(matrix).toMatchSnapshot();
      });
    });
  });

  // meta-guard: prove the prose-reducer that the acronym guard depends on is itself fail-closed —
  // an acronym in AUTHOR PROSE adjacent to a citation (even a citation that nests a quote) must
  // survive the strip, so the acronym guard can still catch it. this clamps the reducer's own
  // correctness, not any shipped brief — the exact fail-open class r6 flagged: a nested even-count
  // quote passes a bare parity gate but mis-pairs under a chained regex, silently blinding the guard.
  given('the guardian prose reducer', () => {
    when(
      'a citation nests a quote next to acronym-bearing author prose',
      () => {
        // the outer citation `"a "b" c"` nests an inner quote (4 quotes, even — the case that defeats a
        // parity-only gate). the shout `TLS` sits in author prose OUTSIDE the citation.
        const sample = 'author uses TLS. cited: "outer "inner" outer" here.';

        then('the acronym in author prose survives the reducer', () => {
          expect(getProseText(sample)).toContain('TLS');
        });

        then(
          'the acronym guard still flags it (fail-closed, not swallowed)',
          () => {
            expect(getShoutedAcronymsInProse(sample)).toContain('TLS');
          },
        );
      },
    );

    when('a double-quote is left unbalanced', () => {
      then('the reducer throws loud rather than carve the doc tail', () => {
        expect(() => getProseText('a "b c TLS d')).toThrow(
          /unbalanced double-quote/,
        );
      });
    });
  });

  // regression guard: the shouted-acronym sweep that took two review rounds by hand must
  // not silently regress. no generic tech acronym may reappear uppercase in prose.
  given('the guardian brief prose', () => {
    guidanceDocs.forEach((doc) => {
      when(`[${doc.slug}] prose is read`, () => {
        then('it carries no shouted acronym', () => {
          expect(getShoutedAcronymsInProse(readBrief(doc.path))).toEqual([]);
        });
      });
    });
  });

  // regression guard: the role readme must keep the inventory named as what ships and the
  // answer-router as planned — it must not drift back to an over-claim of a live answer surface.
  given('the role readme capability claim', () => {
    when('the shipped readme is read', () => {
      const readme = readBrief(roleReadmePath);

      then(
        'it frames the inventory as delivered and the router as planned',
        () => {
          expect(readme).toContain('what ships today');
          expect(readme).toContain('planned follow-on');
        },
      );

      then('it does not re-inflate the answer capability as delivered', () => {
        expect(readme).not.toContain(
          'so it can answer, plainly and with citations',
        );
      });
    });
  });

  // regression guard: the persona brief declares 🧿 (the nazar / evil-eye ward) as the guardian's
  // mark ("uses 🧿 in human chats"), distinct from hardener's 🛡️. its example chat lines must carry
  // that same 🧿 mark, or the de-collision fix is silently undone (an earlier round shipped
  // 🛡️-prefixed examples against a mark declaration). clamp the class so it cannot regress
  // (rule.require.clamp-edge-cases).
  given('the guardian persona mark consistency', () => {
    when('im_a.guardian is read', () => {
      const persona = readBrief(join(briefsDir, 'im_a.guardian.md'));

      then('it declares 🧿 as the mark used in human chats', () => {
        expect(persona).toContain('🧿 in human chats');
      });

      then('its example chat lines carry the 🧿 mark, never the 🛡️ mark', () => {
        const exampleChatGlyphs = getExampleChatGlyphsFromPersona(persona);
        expect(exampleChatGlyphs.length).toBeGreaterThan(0);
        expect(exampleChatGlyphs.every((glyph) => glyph === '🧿')).toEqual(
          true,
        );
      });
    });
  });

  // per-vector guards: the sources trust rollup carries the motto, and the two hand-maintained case
  // enumerations (the readme case index + the trust coverage matrix) must list exactly the cases
  // derived from disk — so a new case brief cannot ship while those docs silently go stale, the same
  // docs↔disk drift the CASES-from-disk derivation prevents one layer up (rule.require.clamp-edge-cases).
  VECTORS.forEach((vectorSlug) => {
    given(`the ${vectorSlug} sources trust rollup`, () => {
      when('inventory.of=sources.case=trust is read', () => {
        then('it carries the not-security-advice motto', () => {
          const trust = readBrief(
            join(
              dirForVector(vectorSlug),
              'inventory.of=sources.case=trust.md',
            ),
          );
          expect(trust).toContain('not professional security advice');
        });
      });
    });

    // compact-answer guard: the vision's headline demo promises a right-sized answer at the vector entry
    // point — band + eliminate + detect at a glance, per case, without a three-file hunt. clamp that the
    // readme carries the two-minute-answer table with those columns and a row per derived case, so the
    // compact surface cannot silently vanish or drift out of sync with the case set (rule.require.behavior-
    // intent-coverage; the manual-reader gap both l3 reviewers ranked as the top real usability shortfall).
    given(`the ${vectorSlug} two-minute answer table`, () => {
      const readme = readBrief(join(dirForVector(vectorSlug), 'readme.md'));
      const table = getSection(readme, '## .the two-minute answer');

      when('the compact-answer table is read', () => {
        then('it carries the band, eliminate, and detect columns', () => {
          expect(table).toContain('likelihood band');
          expect(table).toContain('eliminate');
          expect(table).toContain('detect');
        });

        casesForVector(vectorSlug).forEach((caseSlug) => {
          then(
            `it carries a compact-answer row for the ${caseSlug} case`,
            () => {
              expect(table).toContain(caseSlug);
            },
          );
        });
      });
    });

    given(`the ${vectorSlug} case enumerations vs disk`, () => {
      const cases = casesForVector(vectorSlug);
      const readme = readBrief(join(dirForVector(vectorSlug), 'readme.md'));
      const trust = readBrief(
        join(dirForVector(vectorSlug), 'inventory.of=sources.case=trust.md'),
      );

      when('the readme case index and trust matrix are read', () => {
        cases.forEach((caseSlug) => {
          then(`the readme lists the ${caseSlug} case`, () => {
            expect(readme).toContain(caseSlug);
          });
          then(`the trust matrix lists the ${caseSlug} case`, () => {
            expect(trust).toContain(caseSlug);
          });
        });
      });
    });
  });

  // note: the bhrowser howto↔package.json playwright pin-sync guard was relocated to its natural
  // repo-wide home, src/bhrowser.citation-howto.pin.integration.test.ts — completing the pattern
  // that already moved the registry↔readme and purpose-string guards out of this file, so this test
  // holds only the guardian's shipped-markdown content contract (rule.forbid.scope-leaks).
});
