# howto.cite-via-bhrowser

## .what

the concrete steps to gather a citation through the bhrowser, which is the **only** sanctioned source of citations in this repo.

see `rule.require.bhrowser-citations.[rule].md` for why WebFetch and WebSearch are forbidden.

> **why this doc carries no security disclaimer.** every guardian *guidance* doc holds the
> not-security-advice motto and the recommendation disclaimer (`rule.require.recommendation-disclaimer`).
> this howto deliberately does **not** — it is internal **dev guidance** on how to operate the bhrowser
> (a runbook for an agent), **not** security advice to a person about their network or device. the
> disclaimer rule scopes to docs that recommend a security course of action to a person; a tool runbook
> is out of that scope, so the exemption is by design, not an oversight.

## .prereqs

one-time, per machine — run in this order:

```sh
npx rhachet roles link --repo bhrowser --role playwright
pnpm add -D playwright@1.60.0   # the hoist — pin EXACTLY bhrowser's version (read it from rhachet-roles-bhrowser's package.json; 1.60.0 here). see defect note below
npx playwright install chromium
```

the middle step — the **hoist** — is not optional on a pnpm repo. run it **before** the first
`browser.start`, or that command aborts. it is a `package.json` change, so it **survives reinstall**;
that is why it is a prereq step, not a patch. here is the defect it heads off:

⚠️ **known startup defect (bhrowser@0.1.0) — `browser.start` may fail before it launches.**
`browser.start.sh` probes the chromium version with `npx playwright ... --dry-run` under
`set -euo pipefail`. when `pnpm` installs playwright into the store without a top-level hoist,
`npx playwright` cannot resolve, the pipeline aborts non-zero, and the shell dies at that line with
an opaque `MalfunctionError: command failed` — **before** the chromium fallback it already contains
can run. this is a third upstream defect (kin to the two below), worth an upstream report. the hoist
above is the durable fix (it survives reinstall); apply it and this defect never fires.

## .the loop

> **`<your-own-session>` is a placeholder** — substitute a **distinct, task-scoped** name of your
> own (e.g. `<role>-<task>`, like `observer-logs` or `hardener-audit`) and use that same name in
> every `--session` below. the commands carry the placeholder, not a literal name, on purpose: two
> agents that reuse one name
> collide on the same session — the tab-focus race `rule.require.bhrowser-own-session` exists to
> remove, so a copy-pasted gather must be distinct-by-construction, not distinct-by-recall.

### 1. start the browser

```sh
rhx browser.start --mode HEADFUL --session <your-own-session>
```

stays open across commands. stop it with `rhx browser.stop --session <your-own-session>` when done.

(HEADFUL + an own named session are required — see `rule.require.bhrowser-headful` and
`rule.require.bhrowser-own-session`.)

> **re-run contract.** a second `browser.start` on a session that is already open is **not** a safe
> no-op — it can leave an orphaned window or collide. if a gather fails mid-loop, `browser.stop
> --session <your-own-session>` first, then start fresh; never start a name that may still be open.

### 2. write a playbook

playbooks live in `.play/temporary/` (scratch) or `.play/permanent/` (reusable).

```ts
import type { Browser, Page } from 'playwright';

export const action = async (input: { page: Page; browser: Browser }) => {
  await input.page.goto('https://example.com', {
    waitUntil: 'domcontentloaded',
  });
  return { title: await input.page.title(), url: input.page.url() };
};
```

### 3. run it

pass the `--play` path as an **absolute** path (a relative path is rejected — see the defect table
below), e.g. via `$PWD`:

```sh
rhx browser.action --session <your-own-session> --play "$PWD/.play/temporary/my.play.ts"
```

### 4. capture the page

```sh
rhx browser.describe --session <your-own-session>                   # lists the open tabs + their urls
# snapshot the tab whose url is the one you navigated. select it BY URL — re-run browser.describe
# immediately before this snapshot and read the index it reports for that url now, never a stale
# index captured earlier or a hardcoded 0 (a HEADFUL session can reorder/add tabs between calls;
# see rule.require.bhrowser-own-session)
rhx browser.snapshot.html --session <your-own-session> --tab <index-from-describe-now> --url '<that-tab-url>'   # the url is the durable selector; the tab index can race on a HEADFUL session, so read it from the describe you JUST ran (above) — writes snapshot.html
```

### 5. quote verbatim

read the emitted `snapshot.html` and quote from it directly. cite the url plus the claim it supports.

## .three upstream defects (bhrowser@0.1.0)

three known bhrowser defects can surface during a gather. for each, **prefer the reinstall-durable
workaround** — a package or call-site change that survives an `npm install` — over any mutation of
`node_modules`, per `rule.require.solve-at-cause`:

| defect | symptom | durable workaround (preferred) |
|--------|---------|--------------------------------|
| `browser.start` aborts at the chromium probe | opaque `MalfunctionError: command failed` at `browser.start.sh:194`, because `npx playwright` cannot resolve when pnpm did not hoist playwright | **hoist playwright** (`pnpm add -D playwright@1.60.0`, the same pin as the prereqs) so `npx playwright` resolves — see the prereqs note above; survives reinstall |
| `--play` rejected any non-absolute path | `ERR_INVALID_MODULE_SPECIFIER` / "not a valid package name", surfaced as an `UnexpectedCodePathError` | **pass an absolute `--play` path** — survives reinstall, mutates no vendored file |
| `--url` failed on a lone end slash | `URL verification failed` with `expected: "example.com"` vs `actual: "example.com/"` — strings that look like they match | **pass the `--url` exactly as `browser.describe` reports it** (trailing slash included) — survives reinstall, mutates no vendored file |

the two original defects — the `--play` non-absolute-path rejection and the `--url` end-slash
rejection — are reported upstream as ehmpathy/rhachet-roles-bhrowser#5. the third, the `browser.start`
chromium-probe abort, is **not yet filed** — it is worth a separate upstream report. for all three,
the durable workaround above is the sanctioned interim, and the real fix is the upstream patch land.

> ⚠️ **avoid a `node_modules` patch.** a local edit to a vendored file is a **maintenance hazard**:
> it is silently wiped by any reinstall and will cost a future reader debug hours
> (`rule.forbid.maintenance-hazards`). the durable call-site workarounds above make a `node_modules`
> patch unnecessary — every catalogued defect has a reinstall-safe call-site fix, so the sanctioned
> fix shape is always the durable workaround, never a vendored-file edit. a new defect earns a new
> call-site solve, filed upstream — not a local patch.

the ergonomics of the one opaque error this doc warns about most — the `browser.start`
chromium-probe abort, which surfaces as `MalfunctionError: command failed` at `browser.start.sh:194`
with no hint of the absent playwright hoist — are tracked separately as
ehmpathy/rhachet-roles-bhrowser#6. so a reader who hits that message can follow #6 for a clearer one.

## .see also

- `rule.require.bhrowser-citations.[rule].md` — the rule this enacts
- `rule.require.seven-distinct-citations.[rule].md` — >= 7 distinct sources per research doc
- `rule.require.bhrowser-headful.[rule].md` — HEADFUL mode required
- `rule.require.bhrowser-own-session.[rule].md` — own named session required
