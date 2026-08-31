# rule.require.bhrowser-headful

## .what

every bhrowser session in this repo must start in **HEADFUL** mode:

```sh
rhx browser.start --mode HEADFUL --session <your-own-session>
```

never start a research session in `HEADLESS`.

## .why

- **headless is the worst-case fingerprint.** reddit, google, duckduckgo, and cloudflare all
  flag a headless / datacenter browser on sight. a headless session walks straight into
  "you've been blocked by network security", `/sorry/index` redirects, and cloudflare "just a
  moment…" challenges — the exact walls that stall a citation gather.
- **headful alone defeats most walls.** a headful browser presents a real fingerprint, so most
  of the time the captcha or antibot wall never appears in the first place.
- **headful keeps the human in the loop.** when a wall *does* persist, the human at the terminal
  can see the open window and solve an image captcha in seconds. a headless window gives them no
  visible surface to act on.
- **it protects the citation guarantee.** the whole point of `rule.require.bhrowser-citations`
  is that we never fabricate a quote to pass a guard. headful is what makes the real render
  reachable, so we never have to.

## .the rule

| mode | verdict |
|------|---------|
| `HEADFUL` | **required** — the default for all research |
| `HEADLESS` | **forbidden** for citation gather |

## .caveat

- headful needs a display available to the process. if there is genuinely no display **and** no
  human reachable, that is the rare true block — surface it, never fabricate around it.

## .enforcement

- a bhrowser session started in `HEADLESS` for citation gather = **blocker**

## .see also

- `rule.require.bhrowser-own-session.[rule].md` — the paired session-isolation rule
- `rule.require.bhrowser-citations.[rule].md` — why a real render matters
