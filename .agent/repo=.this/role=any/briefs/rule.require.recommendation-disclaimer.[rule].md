# rule.require.recommendation-disclaimer

# tldr

## severity: blocker

every recommendation brief must carry a best-effort disclaimer: the recommendation is to the best
of our knowledge from the info found, carries no guarantee of success, and must be reviewed by a
qualified security professional against the reader's own real scenario before reliance.

a recommendation that omits this disclaimer overstates its own authority. these briefs are research
groundwork, not professional advice — the disclaimer keeps that boundary explicit so a reader never
mistakes a cited recommendation for a sign-off.

---
---
---

# deets

## .what

any brief that makes a **recommendation** — a `rule.prefer.*`, a `rule.avoid.*`, a `howto.*` that
steers a design choice, or any brief that tells the reader what they *should do* — must include a
best-effort disclaimer near the top (in or right after the `## .what`, before the substance).

this stacks on top of, and is distinct from, the `motto.not-security-advice` framework. the
not-security-advice line says "this is not advice"; the recommendation disclaimer adds three
affirmative qualifiers: **best-knowledge**, **no guarantee**, and **review-by-a-real-professional-
for-your-real-scenario**.

## .why

- a recommendation reads as more authoritative than a neutral definition or hazard map — it tells the
  reader what to do. that authority must be bounded, or the reader may treat cited research as a
  professional sign-off.
- the briefs are built from public info found via research. that info can be stale, incomplete,
  platform-specific, or wrong for a reader's exact facts. the recommendation may be sound in
  general and wrong for a specific scenario.
- a qualified security professional who tests the recommendation against the reader's **actual**
  network, device, and threat model is the only path that converts groundwork into reliance-grade
  advice. the disclaimer names that step as required, not optional.

## severity: blocker

a recommendation brief without the disclaimer overstates its authority and invites unearned reliance.
the cost of the omission is a reader who acts on a cited recommendation as if it were vetted for their
scenario — the exact failure mode the whole research discipline exists to prevent. the disclaimer is
one paragraph; its absence is a blocker.

## .where

applies to any brief in `.agent/**` or `src/domain.roles/**/briefs/**` that makes a recommendation:

- every `rule.prefer.*` and `rule.avoid.*` brief
- every `howto.*` brief that recommends a design or a course of action
- any `define.*` / `ref.*` brief whose body issues a "you should / we recommend" steer

it does **not** apply to purely neutral artifacts that make no recommendation — a bare `define.*`
term brief, a `hazard.*` map that only describes risk, or a nav rollup (`_.glossary`, `_.catalogue`).

### the scope-check — does the advice reach a person about their security?

before you flag (or exempt) a `howto.*`, run the reach test: **does this brief steer a person about
their own network, device, or security posture?**

- **yes** → the disclaimer applies. the reader may act on it against their real scenario, so the
  three qualifiers bound that reliance.
- **no** → **exempt**, even if the brief recommends a course of action. an internal **dev-tool
  runbook** — a `howto.*` that instructs an agent how to operate a tool (install a package, run a
  browser command, pass a flag) — recommends actions, but those actions reach a *tool*, not a
  *person's security*. the authority the disclaimer bounds is not in play.

worked example: `howto.cite-via-bhrowser.[lesson].md` tells the reader to run `pnpm add -D
playwright` and various browser commands. by the file-glob alone it is a `howto.*` under `.agent/**`,
so it *looks* in-scope — but by the reach test it is a dev-tool runbook that never advises a person
about their security, so it is exempt. its own in-file note records that carve-out; this scope-check
is why the note is correct, not a loophole.

## .how

place the disclaimer as a blockquote near the top of the brief (in or just after `## .what`). the
disclaimer must express all three qualifiers. a canonical form:

```md
> **recommendation disclaimer.** this recommendation is offered to the best of our knowledge, based
> on the information found in research — it carries **no guarantee of success or outcome**, and it must
> be reviewed by a qualified security professional against your own real network, device, and threat
> model before any reliance. it is groundwork for that review, not a substitute for it.
```

exact text may vary, but it must convey all three: (1) **best knowledge / info found**, (2) **no
guarantee**, and (3) **must be reviewed by a real, qualified professional for the reader's real
scenario**.

## .enforcement

- a recommendation brief without the disclaimer = **blocker**
- a disclaimer that omits any of the three qualifiers (best-knowledge, no-guarantee, review-by-real-
  professional-for-real-scenario) = **blocker**
- a `howto.*` that passes the reach test as a dev-tool runbook (advises about a tool, never a
  person's security) = **false positive** — exempt by the scope-check, no disclaimer owed

## .see also

- `motto.not-security-advice.[motto].md` — the base not-advice framework this rule stacks on
- `rule.require.bhrowser-citations.[rule].md` — the citation-quality rule for the info the
  recommendation rests on
- `rule.require.seven-distinct-citations.[rule].md` — the citation-count bar
