# rule.require.nest-subskill-output-in-buckets

## severity: blocker

when a ghlitch skill composes another ghlitch skill and lets its output reach the terminal, it must frame that sub-skill's output inside its own treestruct sub.bucket — under a labeled, ghlitch-vibe item.

---
---
---

# deets

## .what

a composer skill (e.g. `provision.database`) that invokes a sub-skill (e.g. `use.rds.capacity`) and streams the sub-skill's stdout to the terminal must:

1. print a **branch item** with a ghlitch-vibe label (e.g. `🐾 make port...`)
2. frame the sub-skill's **full output** inside a prescribed treestruct **sub.bucket** (`├─` … `│` gutter … `└─`), indented under that item

one bucket **per sub-skill invocation** — never merge two sub-skill calls into one bucket. the nest mirrors the call hierarchy, so each invocation is clearly delineated under its own header.

use the shared helper: `source "$DIR/_.nest.sh"` then `run_sub_bucket "<indent>" <cmd> [args...]`.

## .why

composed skills each print their own two-header block (`🐈` mascot + `🦺`/`⛵` artifact tree). streamed raw at column 0 they run together, undelineated — a wall of noise where you cannot tell which header belongs to which skill. a bucket frame around each:

- makes the call hierarchy scannable (child clearly nested under parent)
- keeps every skill's own header intact, just indented under a labeled branch
- conforms to the ergonomist `rule.require.treestruct-output` sub.bucket shape

## severity: blocker

undelineated stacked output erodes the pit-of-success ergonomics the treestruct convention exists to provide. a wall of five headers at column 0 is exactly the confusion the bucket frame prevents.

## .the exemption — forward-contract payloads

do **NOT** bucket a pass-through payload whose stdout is a **forward contract** — output a caller (or CI) reads verbatim. the canonical case: `provision.database --mode plan` forwards `sql-schema-control`'s stdout, and CI greps it (`| tee ./plan.log`, `grep "Everything is up to date"`) to decide whether a gated apply runs. an indent on that output would corrupt the contract.

the test: is the child a **ghlitch skill** (has its own `🐈`/`🦺`/`⛵` vibes)? → bucket it. is it a **raw payload** a caller parses (schema output, a data blob, JSON)? → leave it verbatim at column 0.

## .where

- all ghlitch composer skills that invoke a peer ghlitch skill and surface its output
- current sites: `provision.database` → `use.rds.capacity` → `use.vpc.tunnel`
- exempt: a composer that already silences the child (`>/dev/null`), e.g. `invoke.command` / `invoke.vital`

## .how

```bash
# composer skill
source "$SKILL_DIR/_.nest.sh"
echo "   └─ lets get some sun..."
run_sub_bucket "      " "$SKILL_DIR/use.rds.capacity.sh" --env "$ENV" || exit $?
```

`run_sub_bucket`:
- emits the `├─` … `└─` frame with the required blank `│` spacers
- prefixes each child line with the `│  ` gutter (bare `│` for a child blank line)
- streams live, preserves the child exit code

**always append `|| exit $?`** — run_sub_bucket runs the child in a process
substitution, so a bare call would not reliably trip `set -e`. forward the
exit code so a child failure fail-fasts exactly like a direct call would.

## .examples

### positive — each invocation in its own bucket, forward payload raw

```
⛵ provision.database --which livedb --env prep --mode plan
   ├─ which: livedb
   ├─ env: prep
   ├─ mode: plan
   └─ lets get some sun...
      ├─
      │
      │  🐈 rise and shine...
      │  🦺 use.rds.capacity --env prep
      │     ├─ env: prep
      │     └─ lets open the channel...
      │        ├─
      │        │
      │        │  🦺 use.vpc.tunnel --env prep
      │        │     └─ points at localhost:7821
      │        │
      │        └─
      │  🦺 use.rds.capacity
      │     └─ database ready
      │
      └─

   plan schema changes...
   Everything is up to date        # forward contract — raw at column 0
```

### negative — stacked at column 0, undelineated

```
⛵ provision.database --which livedb --env prep --mode plan
   └─ mode: plan
   ensure database connectivity...
🐈 rise and shine...
🦺 use.rds.capacity --env prep
   └─ env: prep
🐈 chartin course...
🦺 use.vpc.tunnel --env prep
   └─ env: prep
...five headers, no delineation, cannot tell parent from child
```

## .the item labels

the branch item is a short ghlitch-vibe phrase (sailor cat, nautical), **no gerunds** (see rule.forbid.gerunds — prefer imperatives/exclamations):

| sub-skill intent | label |
|------------------|-------|
| wake the db (use.rds.capacity) | `lets get some sun...` |
| open the vpc tunnel (use.vpc.tunnel) | `lets open the channel...` |

coin new ones in the same spirit as needed. no emoji, no gerunds. the label should
echo what the sub-skill actually does — match its vibe, not fight it (a wake-the-db
child pairs with a sun/rise phrase, not a drop-anchor one).

## .enforcement

- composed ghlitch sub-skill output streamed un-bucketed at column 0 = blocker
- two sub-skill invocations merged into one bucket = blocker
- a forward-contract payload wrongly bucketed (breaks the caller's parse) = blocker
- a gerund in the bucket item label = blocker (rule.forbid.gerunds)

## .see also

- `.agent/repo=ehmpathy/role=ergonomist/briefs/cli/rule.require.treestruct-output.md` — the bucket shape
- `rule.forbid.gerunds` — item labels must be gerund-free
- `_.nest.sh` — the `run_sub_bucket` helper
