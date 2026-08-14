# rule.require.consistent-skill-contracts

# tldr

## severity: blocker

every ghlitch skill must use **the same flag and the same terms** for the same purpose. one
concept, one flag, one value set, across every role and every skill.

- **no synonyms** — two words for one concept
- **no alternates** — two flags that do one job
- **no aliases** — a second accepted form, even "just for one release"

if `provision.declastruct` says `--gate for-cicd`, then `provision.database` says `--gate for-cicd`.
not `--auth as-cicd`, not `--cicd`, not `--gate cicd`.

---
---
---

# deets

## .what

the ghlitch skills are one surface, split across roles for organization — never for dialect. a
human who learns `--env prep --mode plan` on one skill has learned it on all of them.

this rule governs **the caller-faced contract**: flag names, value sets, defaults, and the domain
words used in help text and errors. it applies the moment two skills share a purpose, whatever
roles they live under.

## .why

- **one surface, one vocabulary.** a dialect per skill turns a learned contract into a per-skill
  lookup. the human pays that cost on every invocation, forever
- **recognition over recall** — a consistent flag is recognized; a per-skill variant must be
  recalled (`rule.require.discoverability`)
- **a divergent flag is a silent trap.** `--auth as-cicd` on one skill and `--auth via-ambient` on
  its kin means a transposed command belays at best, and does the **wrong** correct-looking act at
  worst
- **aliases are the slow version of the same defect.** a second accepted form doubles the
  vocabulary permanently, because the deprecated one never dies on schedule. one word, one sense
  (`rule.require.ubiqlang`, `rule.forbid.ambiguous-labels`)

## severity: blocker

an inconsistent contract costs the human a re-read on every skill they meet, and costs the
codebase a permanent second vocabulary. both compound.

## .where

- every skill under `src/domain.roles/*/skills/`
- the caller-faced surface: flag names, value sets, defaults, `--help` text, error and hint phrasing
- **not** internal variable names, and not a genuinely distinct purpose that merely sounds similar

## .the shared vocabulary

when a skill needs one of these purposes, it uses **exactly** this flag and this value set:

| purpose | flag | values | default |
|---|---|---|---|
| which environment | `--env` | `test\|prep\|prod\|camp` | **none** — always required (`rule.forbid.default-env`) |
| preview vs execute | `--mode` | `plan\|apply` (`sync` where the skill has a reconcile path) | none — required |
| where credentials come from | `--auth` | `via-keyrack\|via-ambient` | `via-keyrack` |
| whose gate clears a prod write | `--gate` | `for-ehmpath\|for-cicd` | `for-ehmpath` |
| self-documentation | `--help`, `-h`, `help` | — | — (`rule.require.skill-help`) |

extend this table when a new shared purpose appears. a skill that needs a purpose already listed
does **not** get to coin its own word for it.

## .the close-line vocabulary

the contract is not only the flags a skill **takes** — it is also the words it **says**. when a
skill exits mid-tree it must close that tree with a `└─` item that names the outcome, and the
first word of that item is drawn from a two-value set, keyed to the exit code:

| word | exit | sense | example |
|---|---|---|---|
| `blocked:` | 2 | a **constraint** — the caller must fix something | `└─ blocked: absent tunnel config` |
| `halted:` | 1 | a **malfunction** — the run broke, not the caller | `└─ halted: absent credentials` |

the split mirrors `rule.require.exit-code-semantics` exactly, so the word and the code can never
disagree. a reader who sees `halted:` knows to retry; one who sees `blocked:` knows to go fix
their config. that is the whole value of the pair, and a third word (`failed:`, `stopped:`,
`aborted:`) destroys it by making the reader check the exit code anyway.

`run_sub_bucket_or_belay` takes its `close_item` from the same set — it is a parameter precisely
so the composer names the outcome in these words (`blocked at the gate`).

the close-line names the **outcome**, never the cause. the cause is already stated in the belay
block (or the bucket) below it; a close-line that repeats it is noise, and one that states a
different cause is a contradiction the reader must then untangle.

## .the value prefixes

each prefix carries exactly one sense. do not mix them:

| prefix | sense | example |
|---|---|---|
| `via-X` | **channel** — by way of X | `--auth via-keyrack` |
| `for-X` | **caller-kind** — the mode that applies for an X caller | `--gate for-cicd` |
| `as-X` | **persona** — in the identity of X | `--auth as-ehmpath` (kin: `git.commit.push`) |

pick the prefix by the sense the values actually carry, and test it against the **whole** value
set — not one value. a prefix that reads well for one value and badly for another is the wrong
prefix.

## .the test

> "does another ghlitch skill already do this job? then does mine say it the same way?"

- yes, and yes → consistent
- yes, but differently → **rename mine to match**; if the extant word is the worse one, rename
  **both** (a hardcut), never keep two

## .no aliases — not even for migration

it is a temptation to keep the old form one release, so live callers migrate on their own clock.
**do not**, unless the wisher explicitly asks for it in a given case. an alias:

- doubles the vocabulary for as long as it lives, which is always longer than promised
- makes the deprecated form appear supported, because it works
- defers the cost onto every future reader instead of the few callers who must edit one line

prefer a **hardcut** with a belay that names the replacement — the caller learns the new word once,
at the moment they need it:

```
🐈 belay that...

⛵ provision.declastruct
   ├─ retired flag value: --auth as-cicd
   ├─ fix: replace it with --auth via-ambient --gate for-cicd
   └─ why: identity and prod-write approval are separate axes
```

## .examples

### 👍 positive — one contract, many skills

```bash
rhx provision.declastruct --wish ./resources.ts --env prep --mode plan
rhx provision.database    --which livedb        --env prep --mode plan
rhx provision.declastruct --wish ./resources.ts --env prod --mode apply --gate for-cicd
rhx provision.database    --which livedb        --env prod --mode apply --gate for-cicd
```

`--env`, `--mode`, `--gate` mean the same and read the same everywhere. only `--wish` / `--which`
differ, because the subject genuinely differs.

### 👎 negative — a dialect per skill

```bash
rhx provision.declastruct --env prod --mode apply --gate for-cicd   # one word
rhx provision.database    --env prod --mode apply --auth as-cicd    # 👎 another word, same job
rhx deploy                --stage prod                              # 👎 --stage vs --env
rhx invoke.command        --environment prod                        # 👎 a third form
```

## .enforcement

- two skills that use different flags for the same purpose = **blocker**
- two skills that use different value sets for the same purpose = **blocker**
- a synonym flag (`--stage` beside `--env`) = **blocker**
- an alias value kept for compatibility, absent an explicit wisher decision = **blocker**
- a value prefix used against its sense (`as-keyrack` — keyrack is a vault, never a persona)
  = **blocker**
- a genuinely distinct purpose that merely resembles a shared one = **false positive**; say why in
  the help text

on what the skill says, not only what it takes:

- a non-zero exit taken while a tree is open, with no `└─` close = **blocker** (the half-drawn
  tree; see `rule.require.nest-subskill-output-in-buckets`)
- a `└─` that closes a tree on a **non-zero exit**, whose first word is neither `blocked:` nor
  `halted:` = **blocker**
- such a close-line whose word contradicts the exit code (`blocked:` with exit 1) = **blocker**
- such a close-line that restates the cause instead of the outcome = **nitpick**
- a `└─` that closes a tree on a **zero exit** = **false positive**. it is the tree's natural
  last item (`└─ deployed to prep`, `└─ database ready`) and takes no prefix; the two words mark
  an interruption, so a run that was never interrupted must not wear one

## .see also

- `rule.require.ubiqlang` (mechanic) — one canonical word per concept; this is its cli surface
- `rule.forbid.ambiguous-labels` (ergonomist) — one label, one sense
- `rule.forbid.term.addition.synonym` (architect) — the term-level twin
- `rule.forbid.default-env` — why `--env` is the one shared flag that never defaults
- `rule.require.skill-help` — the help text this vocabulary appears in
- `rule.require.exit-code-semantics` (mechanic) — the exit codes the close-line words mirror
- `rule.require.nest-subskill-output-in-buckets` — where the close-line sits, and why a
  mid-tree exit needs one
