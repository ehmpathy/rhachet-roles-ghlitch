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

## .a header is NOT atomic — split it rather than skip the bucket

the most common excuse for an un-bucketed child is "the composer's header is not printed
yet, so there is no parent tree to nest under." check that claim before you accept it. a
header is a **sequence of independent lines**, not one indivisible block, and usually only
a *few* of its fields depend on the work that precedes the child.

the canonical case is the prod gate. all five deployer composers call `uses._.check.sh`
**before** their own header, deliberately — a blocked prod write must never reach the
credential work. that sequence is real and must not change. but it does NOT force an
un-bucketed gate, because the header splits:

| field | depends on | renders |
|---|---|---|
| `⛵ <skill> --wish/--env/--mode`, `wish`, `env`, `mode`, `auth` | parsed args only | **above** the gate |
| `identity` (declastruct), `dir` (terraform) | the work below the gate | **below** the gate |

so the composer prints the asked-for half, buckets the gate under it, does the credential
work, then prints the landed half. the safety sequence is untouched and the child is
properly contained:

```
⛵ provision.declastruct --wish <WISH> --env prod --mode apply
   ├─ wish: <WISH>
   ├─ env: prod
   ├─ mode: apply
   ├─ auth: via-keyrack
   ├─ check the gate...
   │  ├─
   │  │
   │  │  🦺 provision.uses --env prod --gate for-cicd
   │  │     └─ authorized via github-environment approval (CI)
   │  │
   │  └─
   ├─ identity
```

**the test:** before you claim a child cannot be bucketed, name the *specific field* of the
header that depends on the work between them. if every field above that point is knowable
from parsed args, the header splits and the bucket is available.

### .the two costs a split imposes, and how to pay them

a header that moves up changes what comes after it. both costs are real and both have a
settled answer:

1. **belays downstream are no longer pre-header belays.** they must NOT become bare in-tree
   leaves: a belay that inherits the header's `chartin course...` mascot reads as a run that
   started fine, and the exit code is the only clue it failed. keep each belay
   **self-contained** — its own `🐈 belay that...`, its own artifact header — and seam it off
   the header tree with a blank line.

2. **a belay on stderr cannot close a tree that went to stdout.** the header renders on
   stdout; credential belays render on stderr. an in-tree belay would hand a caller who
   captures only stderr a set of orphan leaves with no tree above them. self-containment
   fixes this too — which is why it is the rule for every post-header belay, whatever
   its stream.

also note: `run_sub_bucket` reads the child as `2>&1`, because a gutter cannot interleave
two streams and preserve their order. a child that spoke on **stderr** when invoked
directly therefore arrives on the **composer's stdout** once bucketed. clamp that stream
change explicitly rather than let a test drift onto whichever stream happens to carry it.

## .the residual shape — a precondition with genuinely no parent

a bucket expresses **containment**: a child that does work as part of a parent's
*in-progress* tree. that presumes the parent's tree is already open on screen, which holds for
`provision.database → use.rds.capacity` — the header prints, then the child runs under a
labeled branch.

a **precondition** looks like a different shape: it runs before the composer's header, and it
may terminate the run outright. the prod gate reads that way at first glance.

it is **not** an exemption. as the section above shows, the header splits and the gate nests.
all five deployer composers bucket their gate today. before you conclude a precondition has no
parent, apply the split test — name the header field that genuinely blocks. in every case met
so far, the answer was that no field did, and the bucket was available.

a true exemption would need a composer whose **first** header line is itself derived from the
child's work. one has not been found. if you find one, record it here with the field named,
rather than reach for a seam because a bucket looked hard.

> a seam instead of a bucket was tried on this rule and retired. it delineated the two blocks
> but produced no containment, and its justification ("there is no parent tree") turned out to
> rest on the un-checked premise that a header is atomic. do not re-derive it.

## .a bucket must never frame an empty child

a frame around no output is a defect, not a neutral wrapper:

```
   ├─ check the gate...
   │  ├─
   │  │
   │  │
   │  └─
```

a labeled item promises the reader that a child did work here. five lines of scaffold that
wrap not one line of output breaks that promise, and it is worse than the un-bucketed shape
it replaced.

**the frame is not the defect — the silent child is.** the fix belongs in the child, never in
a conditional frame at the call site. a sub-skill that takes a real action must SAY so
(`rule.require.status-feedback`); if one of its outcomes is silent while its kin report,
that asymmetry is the bug the empty bucket just made visible.

the canonical case: `uses._.check.sh` had three authorization paths — the cicd gate and the
quota grant both reported, while `allowed:local:infinite` exited `0` in silence. a prod write
was authorized with no line in the log to say why. the empty bucket surfaced it; the repair
was to make the third path speak like the other two.

> this is why a bucket earns its cost: it converts a child's silence from invisible into
> unmissable.

### .nor a SHAPE-BROKEN one — grade the kin arms as a SET

silence is the loud version of this defect. the quiet version is a child whose arms answer in
**different shapes**: one renders a tree, its sibling renders a sentence. the bucket is not
empty, so no line looks wrong — but the frame now holds a different thing depending on which
branch the child took, and a reader cannot tell the two apart at a glance.

the same skill supplied the canonical case a second time. after `allowed:local:infinite` was
taught to speak, `uses._.check.sh` had four authorization paths, and three rendered a proper
block:

```
🦺 deploy.uses --env prod
   └─ authorized via local unlimited grant
```

while the quota-grant arm alone answered with a bare one-liner:

```
🐈 deploy.uses: prod use consumed (2 → 1 left)
```

a mascot with no tree under it, and no header to name which meter authorized the write. five
composers frame this gate, so five buckets held a tree on one branch and a sentence on the next.

**the tell is in how it was clamped.** the suite already asserted the set — "not one of them
authorizes prod without a word" — and the quota arm passed it, because it *did* say a word. an
assertion about PRESENCE cannot see a break in SHAPE. grade the shape over the set too:

```ts
for (const out of [scene.infinite, scene.quota, scene.cicd]) {
  const lines = out.stderr.split('\n').filter((line) => line !== '');
  expect(lines[0]).toMatch(/^🦺 (deploy|provision)\.uses --env prod/);
  expect(lines[1]).toMatch(/^ {3}└─ authorized via /);
  expect(lines).toHaveLength(2);
}
```

> a set assertion that every arm SAYS something is the floor. the ceiling is that every arm
> says it the same way.

### .a MULTI-LINE child message needs a glyph on EVERY line

when you bank a child's failure and re-render it as a tree item, remember the message is
routinely **multi-line** — an aws error is a summary line plus an `aws: [ERROR]: ...` line.

```bash
# 👎 glyphs only the FIRST line; every line after it lands at column 0
echo "      ├─ $err"

# 👍 each line gets its own item, so the depth holds for all of them
while IFS= read -r errline; do
  [[ -z "$errline" ]] && continue
  echo "      ├─ $errline"
done <<< "$err"
```

this is the stray defect reborn one layer in: the repair that moved a child's error from a
glyph-less stderr line INTO the tree re-created the same stray, because it treated a message
as one line. it was caught the first time the clamp ran against a real refused credential —
which is the argument for reaching a real failure rather than an assertion on the happy path.

## .clamp the frame with a SNAPSHOT, never toContain alone

the empty bucket above passed every `toContain` assertion written against it — the item label
was present, the frame lines were present, the exit code was right. only a snapshot showed
that the middle was hollow.

so for every composer × every child outcome (cleared and blocked), snapshot the render:

- a `toContain` proves a line exists **somewhere**; it cannot see shape, order, or a gap
- a partial matrix is the real hazard. four of ten renders were clamped here, and the six
  un-clamped ones spanned two composers whose output no test had ever observed
- the tell to hunt: kin `when` blocks under one `given`, where some snapshot and some
  assert only `exit N` + `toContain`. that asymmetry is where an un-seen render hides

add a cross-composer clamp too — assert every composer emits the **identical** frame, with a
negative control on the column-0 shape. one skill's frame that drifts is the dialect
`rule.require.consistent-skill-contracts` forbids, at the render layer.

## .the exemption — forward-contract payloads

do **NOT** bucket a pass-through payload whose stdout is a **forward contract** — output a
named caller reads verbatim, and would misread under an indent.

**there is currently NO such site in this repo.** every skill that once claimed this
exemption — `provision.database`, `provision.declastruct`, `provision.terraform`, `deploy` —
claimed it in a comment, and every one of those comments was false when finally checked. all
four are framed today. treat the exemption as a door that has never yet been opened, not as
a category with known members.

the old canonical example was `provision.database --mode plan`, whose comment read "CI greps
it (`| tee ./plan.log`)". an org-wide search found not one workflow that invokes the skill,
and the consolidation dream that *plans* to adopt it
(declapract-typescript-ehmpathy `.dream/2026_07_19.consolidate-ci-schema-provision-via-ghlitch`,
blocker 3) asks for an **explicit** signal — a `--tee <path>`, a stdout marker, or a dedicated
exit code — and names the accidental column-0 passthrough as what it wants replaced. so the
canonical example was wrong twice over: no live caller, and the planned caller wants the
opposite.

**the lesson that generalizes:** a forward contract that matters gets declared — a flag, a
marker, an exit code. an *accidental* one, where a caller happens to parse whatever falls out
at column 0, is a contract nobody agreed to and nobody clamped. if a real consumer appears,
give it an explicit signal and keep the frame.

the first test: is the child a **raw payload** a caller parses (a data blob, JSON, a schema
diff) — or does it **render** (headers, tree items, progress)? a render is never a payload
(see below). but pass the payload test and you still owe the three-part contract proof in
`.verify the contract before you honor the exemption`.

### .a tree is never a payload — even a foreign one

the test asks whether the child renders a **tree**, not whether it is one of *ours*. a
third-party tool that draws its own treestruct is a kin skill for this purpose and gets
the frame.

`provision.declastruct` got this wrong for a full route. declastruct emits `🌊` / `🔮` /
`🥥` headers and tree items — plainly a render, not a data blob — yet it ran un-framed at
column 0, and every reviewer who read the skill accepted it, because the exemption was
claimed one line up in a comment.

### .verify the contract before you honor the exemption

the exemption is only real if a caller **actually reads** the output. name that caller, and
open the file. an exemption backed by a comment is backed by no contract at all.

the declastruct claim read:

> the plan/apply stdout is propagated unmodified, so a caller can `| tee ./plan.log` and grep it

and it was false. `.github/workflows/.declastruct.yml` pipes **`npx declastruct` directly**
and never invokes the skill. no caller anywhere consumed the skill's stdout. the comment
had been inherited, restated, and never checked (`rule.require.trust-but-verify`).

that same sentence had been copied into three kin skills. once one was checked, all four
fell — which is the tell for this whole class: **a claim that appears verbatim in several
skills was copied, not derived, and has been verified at most once, possibly never.**

before you exempt a child, confirm all four:

1. **a named caller** — a specific workflow file, command, or consumer, cited by path
2. **that caller reads THIS skill's stdout** — not the wrapped tool's, which it may well
   invoke directly instead
3. **the read would break under an indent** — a grep, a parse, an artifact upload
4. **no explicit signal would serve better** — if a flag, a marker, or an exit code could
   carry it, that is the fix, and the frame stays. an accidental passthrough is the weakest
   possible contract: un-declared, un-clamped, and broken by any render change

if you cannot cite the file, there is no contract. bucket it.

### .a deferral needs evidence too

the reasons NOT to frame a child get checked far less than the reasons to frame one, because
no test reddens when a deferral is wrong. `provision.database` survived three rounds of this
work on two unverified reasons — "there's a dream that plans to consume this" (the dream said
the opposite) and "it is the brief's canonical example" (the brief was simply wrong).

name the artifact your deferral rests on, and open it. a filename you have not read is not
evidence.

### .clamp the exemption, do not assert it

an exemption is a claim about a **render** — so it needs a render to check. every deployer
skill that claimed one had zero cases that reached the wrapped tool: each belayed earlier,
at the credential read. the exempt output had never been produced by a test, let alone
observed.

so for each exemption, add a negative control that:

- **reaches the tool** — stub the credential read and the tool itself if need be, and
  assert `exit 0` first, so a case that stops short at a belay does not quietly hold
- **pins the column** — `toMatch(/^<marker>$/m)` plus `not.toContain('│  <marker>')`
- **shows the contrast** — where one run holds both shapes, assert the ghlitch child IS
  bucketed beside the un-bucketed payload. that is what makes the boundary legible

and the same clamp discipline applies to a FRAMED child, inverted:

- **pins the gutter** — `toContain('      │  <marker>')` for the positive, plus
  `not.toMatch(/^<marker>$/m)` as the negative control. without the negative, a
  double-render satisfies the positive and is still wrong
- **proves the frame is not hollow** — assert the open, the close, AND that a content line
  sits between: `not.toMatch(/ {6}├─\n {6}│\n {6}│\n {6}└─/)`
- **separates two children by DEPTH** — where a run frames two, assert each at its own
  indent. equal depths would mean one merged bucket, which the one-per-invocation rule
  forbids

### .a slice marker is part of the render contract

a snapshot that slices a volatile tail must cut on a **literal label**, never a frame shape,
and must **throw** when the marker is absent.

both halves were learned the hard way here. `case18` sliced at the shape `'\n      ├─'`,
which worked only while the connectivity item was the tree's `└─` close and thus the sole
6-space frame. once a second child took over as the close, that item became a `├─`, its
frame moved to `   │  ` — the same depth the gate's frame already occupied — and the shape
marker started to cut at whichever bucket came first, silently truncated away the very
property the case existed to show.

before that, the stale marker had matched **not one line**, and `split(...)[0]` happily
returned the entire string: tsx internals, stack traces, and a per-run temp path, straight
into the snapshot. a slice that silently no-ops is a failhide (`rule.forbid.failhide`) — so
assert the marker was found:

```ts
const marker = '   ├─ lets get some sun...';
const at = out.indexOf(marker);
if (at === -1) throw new Error(`slice marker absent: ${JSON.stringify(marker)}`);
const head = out.slice(0, at + marker.length);
```

### .match a forwarded marker EXACTLY

when a caller greps a forwarded payload, the grep is part of the contract, and it is as
un-clamped as the render was. `.declastruct.yml` searched for a capital-E `Everything is
in sync` while declastruct emits `🎉 everything is in sync!` — one letter apart, so the
grep never matched and the no-op fast path was dead code for its whole life.

it failed **safe** (an in-sync plan still sought apply approval), which is exactly why it
survived unseen. read the marker out of the tool's source, match it with `grep -qF`, and
cite where it comes from.

## .one header per MASCOT PHASE — never one per paragraph

a skill prints its artifact header **once** per mascot block, and every item after it is a
`├─` continuation of that one tree. the only `└─` is the last item before the next mascot.

the defect is a skill that reprints its own header between paragraphs:

```
🦺 use.vpc.tunnel --env prep      # tree 1
   └─ env: prep

🦺 use.vpc.tunnel --env prep      # tree 2
   └─ unlock the keyrack...
      ├─ … ─┘

🦺 use.vpc.tunnel --env prep      # tree 3
   ├─ account: …
```

three headers for **one** run. it is not a cosmetic complaint:

- a reader cannot tell a continuation from a fresh invocation. inside a parent's gutter —
  where these skills usually run — three headers read as three child calls
- **every bucket depth becomes a lie.** each one-item block closes with `└─`, so every
  child is framed at 6 spaces as though the tree had ended. the depth is supposed to
  encode whether work follows; reprinted headers make it encode zero
- the reprint is *why* the shape looked plausible. `└─ env: prep` is correct for a
  one-item tree, so tree 1 looks fine in isolation and no reader questions it

**the test:** count the artifact headers in one run. it must equal the number of mascot
phases (typically two — one for the course, one for the outcome). more than that, and the
skill fragmented its tree.

**the fix is not to delete a header, it is to continue the tree.** the first item becomes
`├─`, the reprints are dropped, and each bucket's indent is re-derived from its item's
glyph. a post-header belay then needs an explicit close (see below), which is the cost
that made the reprint tempting in the first place.

clamp it directly — a snapshot alone lets a reader nod past it:

```ts
const headers = stdout.split('\n').filter((line) => line.startsWith('🦺 use.vpc.tunnel'));
expect(headers).toEqual([
  '🦺 use.vpc.tunnel --env prep',
  '🦺 use.vpc.tunnel --env prep',
]);
```

## .sweep by CHILD, never by command name

when you audit a repo for un-framed children, **enumerate every streaming child**. do not
grep a list of expected command names.

that method was tried here and it missed four sites. the sweep was
`^\s*(npm run|npx |terraform |bash "\$|rhx keyrack unlock)`, and it walked straight past:

| site | what hid it |
|---|---|
| `use.rds.capacity` → `pg_isready` | behind a `timeout 180 bash -c "until …"` wrapper |
| `use.testdb` → `npm run start:testdb` | inside an `if …; then` condition, not at line start |
| `use.testdb` → `docker compose down -v` | `docker` was never on the list |
| `aws.cloudformation.rollback` → `aws … continue-update-rollback` | `aws` was never on the list |

a name-based sweep can only find the children you already knew about, which is precisely
the set that does not need to be found. worse, it returns **zero matches** and reads as
proof of absence.

sweep the other way instead: list every line in every skill that runs *anything*, then
subtract the ones whose output is **captured** (`$(...)`, `| while`, `-o file`) or
**silenced** (`>/dev/null`). whatever is left streams, and everything that streams is
either framed or an explicitly-proven payload.

## .the standing backstop — audit the RECORDED bytes, repo-wide

a sweep is a moment; it grades the repo as it stood the day you ran it. the durable form is a
test that walks every `__snapshots__/*.snap` in the repo and grades the renders inside them:
`src/domain.roles/render.contract.integration.test.ts`.

it grades the whole-render invariants no single suite can see, because each per-skill suite
only ever looks at its own skill:

- **headers ≤ mascots** — the reprint defect, over every recorded render at once
- **headers ≥ 1** — a mascot phase opened and never answered
- **each header sits directly under a mascot** — the two-line render shape

its value is that a **new skill enrolls itself** the moment it records its first snapshot. no
one has to remember to add it to a list.

### .the audit's own three lessons

1. **cut on the entry boundary.** grade each `exports[...]` record separately. sweep the file
   as one blob and a header from one entry pairs with a mascot from the next, so the reprint
   defect hides in the seam between two clean records.

2. **unwrap jest's string quoting.** jest serializes a value as `"..."` INSIDE the template
   literal, so the first render line reads `"🐈 chartin course...` with the quote glued to the
   mascot. an audit that skips the unwrap counts one fewer mascot than the render holds and
   reports **every** healthy two-phase run as a reprint. this exact bug fired on first run —
   342 false offenders — so the unwrap now carries its own clamp:
   `expect(renders.filter((r) => r.body.startsWith('"'))).toEqual([])`.

3. **a sweep tool needs a failfast of its own.** a glob that matches zero files makes every
   assertion pass vacuously, and the green reads as proof of absence
   (`rule.forbid.failhide`). assert the corpus is non-empty before you grade it.

> a tool that audits for silent defects can hold one. clamp the auditor, not only the audited.

## .where

- all ghlitch composer skills that invoke ANY child and surface its output — a peer ghlitch
  skill or a third-party tool alike
- current sites, five deployer composers and three operator skills:
  - `provision.database` → the prod gate, `use.rds.capacity` (→ `use.vpc.tunnel`), the schema run
  - `provision.declastruct` → the prod gate, `rhx keyrack unlock`, the declastruct run
  - `provision.terraform` → the prod gate, the terraform run
  - `deploy` → the prod gate, the serverless run
  - `aws.cloudformation.rollback` → the prod gate
  - `use.rds.capacity` → `use.vpc.tunnel`, the `pg_isready` capacity poll
  - `use.vpc.tunnel` → `rhx keyrack unlock`, the declastruct tunnel apply
  - `use.testdb` → the start, the docker self-heal, the retry, the container-log dump
- exempt: a composer that already silences the child (`>/dev/null`), e.g. `invoke.command` / `invoke.vital`
- exempt: a child whose frame could never CLOSE — `aws logs tail --follow` in
  `aws.cloudwatch.logs.query` never ends, so a bucket around it is an open bracket, not a
  frame. close the tree first, then hand the terminal over
- **not** exempt merely for being silent. `aws … continue-update-rollback` answers with no
  output, and a bucket there would frame an empty child — so it is captured and spoken for
  (`├─ rollback continued`) instead. silence is a reason to speak FOR a child, never a
  reason to leave it un-delineated

## .how

```bash
# composer skill — sourced ONCE, unconditionally, at the top.
#
# it belongs above the header, not inside a branch. every composer here first sourced it
# inside its prod-gate branch, because the gate was the only child at the time; the next
# child added below then reached `run_sub_bucket` undefined on any non-prod run. a helper
# used by two children is not the property of either one.
DEPLOYER_SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPERATOR_SKILL_DIR="$(cd "$DEPLOYER_SKILL_DIR/../../operator/skills" && pwd)"
source "$OPERATOR_SKILL_DIR/_.nest.sh"

# ... header, then each child under its own labeled item
echo "   ├─ lets get some sun..."
run_sub_bucket "   │  " "$SKILL_DIR/use.rds.capacity.sh" --env "$ENV" || exit $?

echo "   └─ plan schema changes..."
run_sub_bucket "      " npm run provision:schema:plan || exit $?
```

**the indent follows the item's branch glyph.** a `├─` item at 3 spaces hosts its frame at
`   │  ` (the gutter continues past it); a `└─` item at 3 spaces hosts its frame at
`      ` (6 spaces — the tree is closed, so no gutter). get this wrong and the frame
detaches from the item that introduced it.

**do NOT prefix an env var onto the call** — `GRANT=plan run_sub_bucket ...` is a variable
assignment in front of a *shell function*, whose scope is shell-mode dependent (bash keeps it
after the function returns in posix mode). `export` on its own line instead.

`run_sub_bucket`:
- emits the `├─` … `└─` frame with the required blank `│` spacers
- prefixes each child line with the `│  ` gutter (bare `│` for a child blank line)
- streams live, preserves the child exit code

**always append `|| exit $?`** — run_sub_bucket runs the child in a process
substitution, so a bare call would not reliably trip `set -e`. forward the
exit code so a child failure fail-fasts exactly like a direct call would.

### .pick the variant by whether the child CAN fail

`_.nest.sh` exports two operations, and the wrong one leaves a half-drawn tree:

| the child... | use | why |
|---|---|---|
| cannot fail the run (or the caller continues on failure) | `run_sub_bucket … \|\| exit $?` | a plain frame; the `\|\| exit $?` forwards the code |
| can fail, and a failure must halt the composer | `run_sub_bucket_or_belay <indent> <close_item> …` | closes the PARENT tree before it exits |

```bash
# a child that can fail — the gate. `|| exit $?` alone is NOT enough here.
echo "   ├─ check the gate..."
run_sub_bucket_or_belay "   │  " "⛵ provision.declastruct" "blocked at the gate" \
  bash "$DEPLOYER_SKILL_DIR/uses._.check.sh" --meter provision.uses --env prod
```

### .the belay it emits is a BLOCK, and its mascot follows the exit code

two properties the helper carries, both learned the hard way:

- **the artifact param is mandatory** — the belay used to end on a bare `🐈 belay that...`
  with no block under it. five composers each closed a blocked run on a cat, and the outcome
  was stated only *inside* the tree, at the depth the reader was just told to skip. a mascot
  takes an artifact block; a bare one is a phase opened and never answered
- **the mascot is chosen by `rc`, never hardcoded** — `belay that...` on exit 2 (a
  constraint, the caller has a fix to make), `wet paws...` on any other non-zero (a
  malfunction, the run broke). the hardcoded `belay that...` told every malfunction's caller
  to go fix their own input (`rule.require.exit-code-semantics`)

the *shape* is identical on both codes — a per-code structure would be the dialect
`rule.require.consistent-skill-contracts` forbids. only the cat differs, and it must.

**why a bare `|| exit $?` is wrong for a child that can fail.** the *bucket* closes —
`run_sub_bucket` prints its own `└─` before it returns — but the **composer's** tree does not.
its last line is the labeled branch item that hosted the bucket, with no `└─` for the tree that
item belongs to. the caller is left with items under no close, beneath a mascot that already
claimed the run was underway, and the verdict buried at the bucket's gutter depth instead of
stated at column 0.

`run_sub_bucket_or_belay` returns 0 untouched on success (the tree stays open to continue), and
on failure closes the tree with `└─ <close_item>`, belays at column 0, and forwards the child's
exit code. the `close_item` names the **outcome** in the shared close-line vocabulary
(`rule.require.consistent-skill-contracts`), never the cause — the cause is already in the
bucket the reader just saw.

### .a child you capture still needs a voice

a child whose output you capture, or that answers with none at all, is exempt from the *frame* —
never from the *tree*. speak for it with a plain item:

```bash
# `continue-update-rollback` answers with no output on success. a bucket here would frame an
# empty child; capture it and say what happened instead.
echo "   ├─ anchors away!"
if ! ROLLBACK_SAID="$(aws cloudformation continue-update-rollback --stack-name "$STACK_NAME" 2>&1)"; then
  echo "   └─ halted: aws rejected the rollback"
  # … belay, with $ROLLBACK_SAID's lines as tree items
  exit 1
fi
echo "   ├─ rollback continued"
```

capture **both** streams. a tool that is silent on success still speaks on failure, and an
un-captured error lands at column 0 mid-tree beside a `set -e` exit that closes no tree at all.

## .examples

### positive — each invocation in its own bucket, at its own depth

```
⛵ provision.database --which livedb --env prep --mode plan
   ├─ which: livedb
   ├─ env: prep
   ├─ mode: plan
   ├─ lets get some sun...          # a ├─ item, so its frame sits at `   │  `
   │  ├─
   │  │
   │  │  🐈 rise and shine...
   │  │  🦺 use.rds.capacity --env prep
   │  │     ├─ env: prep
   │  │     └─ lets open the channel...
   │  │        ├─
   │  │        │
   │  │        │  🦺 use.vpc.tunnel --env prep
   │  │        │     └─ points at localhost:7821
   │  │        │
   │  │        └─
   │  │  🦺 use.rds.capacity
   │  │     └─ database ready
   │  │
   │  └─
   └─ plan schema changes...        # the └─ close, so its frame sits at 6 spaces
      ├─
      │
      │  Everything is up to date
      │
      └─
```

two children, two frames, two depths — which is what proves they are separate buckets
rather than one merged frame. the third-party schema run is framed exactly like the ghlitch
child above it: a render is a render, whoever wrote it.

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
| clear the prod gate (uses._.check) | `check the gate...` |
| unlock the keyrack (rhx keyrack unlock) | `unlock the keyrack...` |
| poll the db for capacity (pg_isready) | `await capacity...` |
| continue a stuck rollback (aws cloudformation) | `anchors away!` |
| start the local testdb (npm run start:testdb) | `start testdb...` |
| clear a wedged container (docker) | `start failed — self-heal...` |

coin new ones in the same spirit as needed. no emoji, no gerunds. the label should
echo what the sub-skill actually does — match its vibe, not fight it (a wake-the-db
child pairs with a sun/rise phrase, not a drop-anchor one).

## .enforcement

- composed ghlitch sub-skill output streamed un-bucketed at column 0 = blocker
- two sub-skill invocations merged into one bucket = blocker
- a forward-contract payload wrongly bucketed (breaks the caller's parse) = blocker
- a gerund in the bucket item label = blocker (rule.forbid.gerunds)

on the header split:

- "the header is not printed yet" offered as grounds to skip a bucket, with no named
  header field that actually blocks = **blocker**. the claim must cite the field
- a blank-line seam used in place of a bucket = **blocker**. a seam delineates; it does
  not contain, and the shape it settles for is the one this rule exists to retire
- a post-header belay rendered as bare in-tree leaves, so it inherits the header's success
  mascot = **blocker** (the caller reads a failure as a clean start)
- a post-header belay on stderr whose tree went to stdout = **blocker** (orphan leaves for
  anyone who captures one stream)
- a test that asserts a bucketed child's output on the stream it used *before* it was
  bucketed = **blocker** (`run_sub_bucket` reads `2>&1`; pin the real stream)

on the tree the buckets hang from:

- an artifact header reprinted between paragraphs of ONE run = **blocker**. count the
  headers; they must equal the mascot phases
- a line that is neither blank, nor a mascot, nor an artifact header, nor a `├─`/`└─` tree
  item = **blocker** (`   continue rollback...` and `   events` were both this)
- a bucket whose indent does not follow its item's glyph — a `├─` item framed at 6 spaces,
  or a `└─` item framed at `   │  ` = **blocker**. the depth is a claim about whether work
  follows, and a wrong one misleads
- a suite with no clamp on the header count = **nitpick**; a snapshot shows the reprint but
  a reader nods past it

on the sweep that finds these:

- an audit that greps a command ALLOWLIST and reports zero un-framed children = **blocker**.
  it cannot see a child behind a wrapper (`timeout … bash -c`), inside an `if` condition, or
  under a command the list never named. enumerate the children, then subtract the captured
  and the silenced

on the frame's own integrity:

- a bucket that frames an empty child = **blocker**; fix the child's silence, never make the
  frame conditional
- a STUB louder or quieter than the tool it stands in for = **blocker**. a silent tool with a
  chatty stub makes an empty bucket look full in the test and hollow in production; a chatty
  tool with a silent stub does the reverse. match the real tool's volume
- a composer × child-outcome render with no snapshot = **blocker**; `toContain` cannot see a
  hollow frame
- kin `when` blocks where some snapshot the render and some assert only `exit N` = **blocker**
  (the partial matrix that hides an un-seen render)
- a composer whose frame shape differs from its kin = **blocker**
  (`rule.require.consistent-skill-contracts`, at the render layer)
- a CHILD whose arms answer in different shapes — one a tree, one a sentence — so the frame
  holds a different thing per branch = **blocker**
- a suite that grades a child's arms as a set for PRESENCE ("each says something") but never
  for SHAPE = **blocker**; presence cannot see the shape break
- a banked multi-line child message rendered with a glyph on only its first line = **blocker**
  (the stray, reborn one layer in)
- a belay that ends on a BARE mascot, with no artifact block beneath it = **blocker** (a
  phase opened and never answered)
- a belay mascot hardcoded rather than chosen by the exit code = **blocker** (`belay that...`
  on a malfunction blames the caller for a broken run)
- a shape that varies BY exit code — a different structure for 1 than for 2 = **blocker**;
  only the mascot may differ

on the audit that backstops all of the above:

- a repo-wide render audit that sweeps a `.snap` as one blob rather than per entry =
  **blocker** (the reprint hides in the seam between two clean records)
- such an audit with no failfast on an empty corpus = **blocker** (`rule.forbid.failhide` —
  a zero-match glob makes every assertion pass and reads as proof of absence)
- such an audit with no clamp on its own parser = **blocker**; the jest quote-unwrap bug
  turned every healthy two-phase render into a false offender on first run

## .see also

- `.agent/repo=ehmpathy/role=ergonomist/briefs/cli/rule.require.treestruct-output.md` — the bucket shape
- `rule.forbid.gerunds` — item labels must be gerund-free
- `_.nest.sh` — the `run_sub_bucket` helper
