# rule.require.bhrowser-citations

## .what

all factual claims must be backed by citations gathered through the **bhrowser** (from `rhachet-roles-bhrowser`).

**WebFetch and WebSearch are forbidden as citation sources.**

## .why

WebSearch and WebFetch are not trustworthy for ground truth:

- **WebSearch** returns summaries and snippets, not source text. results can be stale, misread, or fabricated by the search engine.
- **WebFetch** is an opaque api. we cannot verify what it actually retrieved, whether the page rendered, or whether content was silently truncated or summarized.

the **bhrowser** is trusted: it drives a real browser, so it renders the page as a human would see it and returns what is genuinely there. a claim traced through the bhrowser is verifiable ground truth.

in a security registry, a wrong citation is not a cosmetic defect — it can carry into guidance a human acts on. the bar is absolute.

## .the rule

| source type | acceptable for citations? |
|-------------|--------------------------|
| WebSearch snippets | **NO** — forbidden outright |
| WebFetch content | **NO** — forbidden outright |
| bhrowser content | **YES** — quote verbatim |
| pdf reads | **YES** — quote verbatim |
| direct api responses | **YES** — include response data |

## .pattern

```
1. use the bhrowser to reach the source
2. quote verbatim from what the bhrowser returned
3. cite the url + the specific claim it supports
```

## .examples

### bad — webfetch or websearch

```
open wifi lets attackers read your traffic.
source: websearch snippet
```

### good — bhrowser verified

```
CISA states that on public wifi "the security of the network is
unknown and your information could be intercepted."
source: bhrowser read of https://www.cisa.gov/...
verbatim: "When you use a public Wi-Fi network ..."
```

## .enforcement

- claim without bhrowser verification = blocker
- websearch-only or webfetch-only citation = blocker

## .exception

- well-known facts (e.g. "tls encrypts data in transit")
- definitions from authoritative sources already in context
- internal repo references

## .see also

- `rule.require.seven-distinct-citations.[rule].md` — the count bar (>= 7 distinct sources per doc)
- `rule.require.bhrowser-headful.[rule].md` — the headful-mode rule
- `rule.require.bhrowser-own-session.[rule].md` — the session-isolation rule
- `howto.cite-via-bhrowser.[lesson].md` — the concrete gather loop
