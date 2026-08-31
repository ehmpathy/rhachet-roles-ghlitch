# rule.require.bhrowser-own-session

## .what

every agent that drives the bhrowser must start and use its **own named session** — never the
shared `default` session:

```sh
rhx browser.start --mode HEADFUL --session <your-own-session>   # e.g. <role>-<task>
rhx browser.action  --session <your-own-session> --play <play>.ts
rhx browser.stop    --session <your-own-session>                # clean up when done
```

pick a distinct, task-scoped name. do not omit `--session` (which falls back to `default`).

## .why

- **`default` may belong to a human or another agent.** to drive it steps on their tabs,
  cookies, and navigation — and they step on yours.
- **shared sessions cause tab collisions — observed, not hypothetical.** mid-gather of
  citations on the `default` session, a `browser.action` navigated one tab while
  `browser.describe` / `browser.snapshot` saw a *different* focused tab, so the snapshot failed
  its url-verification guard. an own session removes that whole class of race.
- **isolation keeps state clean.** cookies, logins, and captcha-solve state from one line of
  research must not leak into another. a named session is a clean, disposable boundary you can
  stop and discard with no disturbance to anyone else.
- **it makes cleanup safe.** `browser.stop --session <mine>` tears down only my window, never a
  human's open work.

## .the rule

| session | verdict |
|---------|---------|
| own named session (`--session <task>`) | **required** |
| shared `default` session | **forbidden** for agent research |

## .enforcement

- a bhrowser `action` / `snapshot` run against `default` (or with `--session` omitted) in an
  agent gather = **blocker**

## .see also

- `rule.require.bhrowser-headful.[rule].md` — the paired headful-mode rule
- `rule.require.bhrowser-citations.[rule].md` — why the render must be real and verifiable
