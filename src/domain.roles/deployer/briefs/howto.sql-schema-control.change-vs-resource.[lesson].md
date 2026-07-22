# howto.sql-schema-control.change-vs-resource

## .what

sql-schema-control manages your database schema through **two classes** of definition:
**changes** and **resources**. this brief explains what each class is, when to reach for
each, and how the **changelog table** tracks a change so it runs exactly once.

this is the mental model. the applied playbook — what to do when a plan flags a
`MANUAL_MIGRATION`, and when to `sync` — lives in the companion brief
`howto.sql-schema-control.handle-manual-migration.[lesson].md`.

## .why

`provision.database` drives sql-schema-control. to use it well you must know which class a
piece of schema belongs to, because the two behave differently:

- a **resource** is reconciled by a diff against live state — declarative.
- a **change** is run once and recorded in a changelog — imperative.

pick the wrong class and you get drift (a change that never converges) or a double-apply (a
one-off sql that runs again). the classes are the vocabulary the rest of this role speaks.

---

## the two classes

| class | what it is | how it applies | idempotent by |
|-------|-----------|----------------|---------------|
| **resource** | declarative DDL for a live object — a table, function, procedure | `apply` diffs the definition against live state and converges it | state diff (re-apply is a no-op when live == declared) |
| **change** | an adhoc set of sql statements — a one-off migration, a data backfill, a user grant | `apply` runs it once, then records it in the changelog | changelog record (re-apply is a no-op once recorded) |

both classes live side by side in one `control.yml` `definitions:` list. a repo mixes them
freely — a `type: resource` for each table, a `type: change` for each one-off.

```yaml
# control.yml (excerpt)
definitions:
  - type: change                          # a one-off, tracked in the changelog
    id: init_service_user
    path: ./init/user.service.sql
  - type: resource                        # a live object, diffed against state
    path: ./tables/notification.sql
```

## how the changelog tracks a change

the changelog is a table sql-schema-control maintains in your database. for each applied
change it records:

- the change's **natural key** — a stable, human-authored id (authored as `id:` in
  `control.yml` today; our `provision.database` skill surfaces it as `--slug`). it is
  decoupled from the file path on purpose, so a file move preserves the record.
- a **hash** of the change's sql.

> note: the `id:`/`--slug` name split is deliberate but transitional — the currently-shipped
> sql-schema-control still calls this key `id` everywhere (config field and the `sync --id`
> flag). the upstream `id`→`slug` rename is tracked at
> `.behavior/v2026_07_20.fix-database-change/refs/handoff.sql-schema-control.rename-id-to-slug.md`;
> until it lands, `--mode sync --slug` depends on it (see the companion brief).

on each `plan`/`apply`, sql-schema-control compares the definition to the changelog:

| changelog state | status | `apply` does |
|-----------------|--------|--------------|
| no record for this key | `NOT_APPLIED` | run the sql, record it |
| record present, hash matches | `UP_TO_DATE` | no-op (already applied) |
| record present, hash differs | `OUT_OF_DATE` | re-apply (if `reappliable`) |

this is why a change runs **once**: after the first `apply`, its key + hash sit in the
changelog, so the next `plan` reads it as `UP_TO_DATE` and skips it.

## when to reach for each

| you have… | use a… | because |
|-----------|--------|---------|
| a table / function / procedure whose shape you declare | **resource** | you want live state to converge to your declaration, and stay converged |
| a one-off ALTER, a data backfill, an initial seed, a grant | **change** | it runs once; there is no state to converge to — it is an event, not a state |
| a resource ALTER that `plan` flags `MANUAL_MIGRATION` (see below) | **change** | sql-schema-control cannot auto-generate the ALTER; express it as a change → see the companion brief |

> rule of thumb: if you can describe the **end state**, it is a resource. if you can only
> describe the **step to take**, it is a change.

## the `MANUAL_MIGRATION` hand-off

a resource whose live shape has drifted from its declaration in a way sql-schema-control
cannot auto-alter is flagged `MANUAL_MIGRATION` and **skipped** by `apply`:

```
↓ [MANUAL_MIGRATION] ./tables/voice_call.sql (resource:table:voice_call) [skipped]
```

that skip is where the two classes meet: the fix is to author the ALTER as a **change**, so
`apply` runs and records it. the full playbook — and the `--mode sync` reconcile for a change
run out-of-band — is the companion brief.

## .see also

- `howto.sql-schema-control.handle-manual-migration.[lesson].md` — the applied workflow: turn
  a `MANUAL_MIGRATION` into a `type: change`, and when to `--mode sync`
- `src/domain.roles/deployer/skills/provision.database.sh` — the skill that drives
  `plan` / `apply` / `sync`
- [sql-schema-control](https://github.com/ehmpathy/sql-schema-control) — the tool this role drives
