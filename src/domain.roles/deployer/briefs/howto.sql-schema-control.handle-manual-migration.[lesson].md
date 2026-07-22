# howto.sql-schema-control.handle-manual-migration

## .what

the applied playbook for the **change** class: what to do when `plan` flags a
`MANUAL_MIGRATION`, how to author the ALTER as a `type: change` so `apply` runs and records
it, and when to reach for `--mode sync` to reconcile a change applied out-of-band.

this is the procedure. the concept behind it — the two classes and how the changelog tracks a
change — is the companion brief `howto.sql-schema-control.change-vs-resource.[lesson].md`.
read that first if "change vs resource" is unfamiliar.

## .why

sql-schema-control auto-converges **resources** by diff, but it cannot auto-generate every
ALTER. when it hits one, it flags `MANUAL_MIGRATION` and **skips** it — the change is on you.
the wrong move is a raw one-off apply outside the tool: it runs untracked, drifts from
control, and re-applies on the next run. the right move keeps all of it under plan/apply
control, tracked in the changelog. this brief is that move.

---

## the situation: a MANUAL_MIGRATION

`plan` flags a resource ALTER it will not auto-apply, and skips it:

```
$ rhx provision.database --which livedb --env prep --mode plan
   ...
   ↓ [MANUAL_MIGRATION] ./tables/voice_call.sql (resource:table:voice_call) [skipped]
```

the resource's live shape has drifted from its declaration in a way the tool cannot resolve
on its own (e.g. a column type change with data implications). left alone, every `plan`
re-flags it and every `apply` skips it — the schema never converges.

## the fix: author the ALTER as a `type: change`

express the exact ALTER as a one-off change definition, so `apply` runs it once and records
it in the changelog.

### 1. write the sql

```sql
-- provision/schema/sql/changes/2026_07_20.voice_call_duration.sql
ALTER TABLE voice_call ALTER COLUMN duration TYPE integer USING duration::integer;
```

### 2. register it in control.yml

```yaml
# control.yml — add to definitions:
  - type: change
    id: 2026_07_20.voice_call_duration    # the change's natural key (stable, hand-authored)
    path: ./changes/2026_07_20.voice_call_duration.sql
```

the `id:` is the change's **natural key** — stable and decoupled from the file path, so a
later file move keeps the changelog record intact. (our `provision.database` skill surfaces
this same key as `--slug`; see the `sync` step below.)

### 3. plan, then apply

```bash
$ rhx provision.database --which livedb --env prep --mode plan     # previews the new change
$ rhx provision.database --which livedb --env prep --mode apply    # runs it, records the changelog
```

`apply` runs the sql once and writes the change's key + hash to the changelog. the next
`plan` reads it as `UP_TO_DATE` and skips it — no drift, no double-apply.

> why not a raw one-off apply? a raw `psql`/`pg` run outside sql-schema-control leaves the
> changelog untouched. the change is untracked, so the next `apply` cannot tell it ran — and
> the schema silently drifts from control. to author it as a `type: change` keeps the source
> of truth in one place.

## the reconcile: `--mode sync`

sometimes a change is applied **out-of-band** — a human runs the sql by hand in an incident,
before it was recorded. now reality has the change but the changelog does not, so the next
`apply` would try to run it **again**.

`--mode sync` fixes exactly this: it writes the change's changelog record **without a re-run**
of the sql.

> ⚠️ upstream dependency — read before you run: our skill passes `--slug` straight through, but
> the currently-shipped sql-schema-control still names this flag `--id`. until the upstream
> `id`→`slug` rename lands and your repo's pinned version bumps, a `sync` run surfaces an
> `--id`-vs-`--slug` mismatch from the tool. the rename is tracked at
> `.behavior/v2026_07_20.fix-database-change/refs/handoff.sql-schema-control.rename-id-to-slug.md`.
> `plan` and `apply` are unaffected. the clean run below is the post-rename target state.

```bash
$ rhx provision.database --which livedb --env prep --mode sync --slug 2026_07_20.voice_call_duration
```

```
🐈 smooth sailin!

⛵ provision.database --which livedb --env prep --mode sync --slug 2026_07_20.voice_call_duration
   ├─ change: 2026_07_20.voice_call_duration
   └─ changelog reconciled (no sql executed)
```

`--slug` is the change's natural key — the `id:` you authored in `control.yml`. after sync,
the changelog and reality agree, and the next `apply` is a clean no-op.

### apply vs sync — which do i want?

| your situation | use | effect |
|----------------|-----|--------|
| the change has **not** run against this db | `--mode apply` | runs the sql **and** records the changelog |
| the change **already ran** by hand, changelog is stale | `--mode sync --slug <key>` | records the changelog only — **no** sql runs |

> ⚠️ `sync` is sharp: it asserts a change is already live without a check. only sync a change
> you are certain has run. a wrongful sync marks an un-run change as applied, so the real
> change never happens.

## prod is gated

both `apply` and `sync` mutate the database (apply runs DDL; sync writes the changelog), so
against `--env prod` both consult the `provision.uses` prod gate. `plan` reads only and stays
open. a blocked prod write exits 2 with an escalation hint — ask a human to grant a use.

## the whole loop, end to end

```
plan flags MANUAL_MIGRATION
   → write the ALTER as a type: change (control.yml)
   → plan (preview)  →  apply (runs + records)
   → changelog remembers  →  future applies skip it

(if a change was run by hand instead)
   → sync --slug <key>  →  changelog reconciled, no re-run
```

## .see also

- `howto.sql-schema-control.change-vs-resource.[lesson].md` — the concept behind this: the two
  classes, and how the changelog tracks a change by key + hash
- `src/domain.roles/deployer/skills/provision.database.sh` — the skill: `plan` / `apply` / `sync`
- `.behavior/v2026_07_20.fix-database-change/refs/handoff.sql-schema-control.rename-id-to-slug.md`
  — why `sync --slug` depends on an unshipped upstream `id`→`slug` rename
- [sql-schema-control](https://github.com/ehmpathy/sql-schema-control) — the tool this role drives
