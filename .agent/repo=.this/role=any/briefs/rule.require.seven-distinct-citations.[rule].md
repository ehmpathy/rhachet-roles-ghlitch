# rule.require.seven-distinct-citations

## .what

every research doc (brief, lesson, ref, hazard, case study) that makes factual claims must stand
on **at least 7 distinct source citations**, each one read through the **bhrowser** — never a
WebSearch snippet, never a WebFetch.

this is the count companion to `rule.require.bhrowser-citations` (which governs the *quality* of
each citation). that rule says every citation must come through the bhrowser; this rule says there
must be **>= 7 separate ones**.

## .why

- a single source can be wrong, outdated, or misread; seven independent sources cross-check each
  other
- a high bar forces real research breadth, not one url stretched across a whole doc
- "separate" defeats the pad-the-count trap — one guideline cited seven times is still one source
- it makes each doc defensible: a reader (or professional) can triangulate the claim across many origins

## .the rule

| requirement | detail |
|-------------|--------|
| minimum count | **>= 7 distinct sources per doc** |
| distinct | seven *different* urls — dedupe before you count |
| bhrowser-read | each source counts only after the bhrowser returned real content for that url |
| verbatim | quote the page verbatim; do not paraphrase-and-cite |
| discovery role | a search may ONLY discover candidate urls; a snippet is never a citation |

## .what "distinct" excludes

| pattern | distinct count | verdict |
|---------|----------------|---------|
| one guideline url cited 7 times | 1 | ❌ fails |
| 5 real bhrowser reads + 2 search snippets | 5 | ❌ fails |
| 7 urls, but 3 reads returned empty/dead | 4 | ❌ fails |
| same doc at two mirrors (e.g. NIST + publisher) of one study | counts as 2 (different pages) | ✅ allowed, but prefer breadth |
| 7 different pages, each read + quoted | 7 | ✅ passes |

## .pattern

```
1. search to discover candidate urls (this step cites no source)
2. bhrowser-read each url; keep only the ones that return real content
3. quote each page verbatim in the body
4. list every distinct url in ## .sources
5. count the distinct urls — if < 7, read more before the doc is done
```

## .how to verify

- open the doc's `## .sources` list
- dedupe the urls
- count the distinct bhrowser-read ones
- confirm each maps to a verbatim quote traceable to that page
- if the count is below 7, the doc is incomplete and blocks

## .exception

- pure navigation/rollup artifacts that make no independent factual claim (e.g. a glossary index
  or a `_.catalogue` summary that only links to other docs) — these inherit their citations from
  the docs they point to
- well-known, non-controversial definitions already established in an authoritative in-context
  source (still prefer to cite)

## .enforcement

- research doc with fewer than 7 distinct bhrowser-read sources = blocker
- padded count (repeats, snippets, dead reads counted as sources) = blocker
- any citation sourced from WebFetch or WebSearch = blocker

## .see also

- `rule.require.bhrowser-citations.[rule].md` — the quality bar per citation (companion rule)
- `howto.cite-via-bhrowser.[lesson].md` — the concrete gather loop
