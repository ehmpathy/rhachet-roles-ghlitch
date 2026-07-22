# handoff → sql-schema-control: rename change `id` to `slug`

## .what

rename the `ChangeDefinition` natural-key field (and its CLI flag) from **`id`** to **`slug`**
across sql-schema-control's config, CLI, changelog table, and domain objects. a **clean rename**
— `slug` replaces `id`, **no deprecated aliases**, no dual-accept window.

## .why

`id` is overloaded. in the ehmpathy ubiqlang (domain-objects), a domain object has:
- a **primary** key — the artificial, system-generated identifier (a db `id`)
- a **unique** key — the natural, human-authored identifier

the change definition's `id` is a **human-authored natural key**, not a system-generated one.
its own source comment says so:

> `id: string; // id ensures file moves preserve hash relationship`
> — `src/domain.objects/ChangeDefinition.ts:19`

authors write it by hand in `control.yml` (`init_service_user`, `init/data.postal_to_geocode`),
and it is deliberately decoupled from the file path so a file move preserves the changelog link.
that is precisely a **slug**: a stable, human-readable natural key. to call it `id` invites
confusion with the artificial primary keys that `id` conventionally denotes, and it desyncs from
the domain-objects vocabulary the rest of the ehmpathy stack speaks.

downstream, `rhachet-roles-ghlitch`'s `provision.database --mode sync` exposes this value as
**`--slug`** and passes it straight through — it expects sql-schema-control's `--slug` to work.

## .scope — what to rename

`slug` replaces `id` everywhere the **change definition's natural key** appears. do NOT touch any
genuinely-artificial `id` (there may be none, but verify).

### 1. domain object — `src/domain.objects/ChangeDefinition.ts`
- zod schema field `id: z.string()` → `slug: z.string()`
- interface field `id: string` → `slug: string`
- keep the "preserve hash relationship on file move" comment; it explains the natural key.

### 2. CLI — `src/contract/cli.ts` (the `sync` command, ~`:51-65`)
- `.requiredOption('--id <changeId>', 'reference id of the change definition')`
  → `.requiredOption('--slug <changeSlug>', 'the change definition slug (natural key)')`
- action arg `options.id` → `options.slug`
- the call `getAndSyncChangeLogForChangeDefinition({ configPath, changeId: options.id })`
  → `{ configPath, changeSlug: options.slug }`

### 3. command operation — `src/domain.operations/commands/getAndSyncChangeLogForChangeDefinition.ts`
- param `changeId` → `changeSlug`
- the match against `targetDefinition` — swap the `.id` comparison to `.slug`.

### 4. changelog persistence — the change_log table
- the column that records the change's natural key (currently `id`) → `slug`.
- **this is the migration-sensitive part.** provide a `type: change` migration that renames the
  column, so extant changelogs keep their history. (sql-schema-control eats its own dog food here.)
- audit every read/write of that column: `syncChangeLogWithChangeDefinition`,
  `getAppliedChangeDefinitionFromDatabase`, `getStatusForChangeDefinition`,
  `getDifferenceForChangeDefinition`, `getReferenceIdForDefinition`.

### 5. config yml — `type: change` definitions
- the authored field `id:` → `slug:` in every `control.yml` / `*.yml` change definition.
- consumer repos (svc-jobs, svc-notifications, …) update their yml in lockstep with the release.

### 6. docs + tests
- `readme.md` `sync` example + command table (`:221-237`).
- every `new ChangeDefinition({ id: ... })` in tests → `{ slug: ... }`.
- update snapshots.

## .release note

a clean rename breaks the contract — ship it as a **major**. consumer repos update their
`control.yml` (`id:` → `slug:`) and any direct `--id` callers (`--id` → `--slug`) at the same
version bump. the changelog column-rename migration must run as part of the upgrade so extant
history survives.

## .grounded in reality (verified in ehmpathy/sql-schema-control @ origin/main)

- `src/domain.objects/ChangeDefinition.ts:9-25` — `id` is the natural key; comment confirms.
- `src/contract/cli.ts:51-65` — `sync` command; `.requiredOption('--id <changeId>', …)`;
  passes `changeId: options.id` to `getAndSyncChangeLogForChangeDefinition`.
- `src/domain.operations/commands/getAndSyncChangeLogForChangeDefinition.ts` — the sync entrypoint.
- `src/domain.operations/schema/changeDefinition/**` — changelog read/write ops that key off the field.
- `readme.md:221-237` — documented `sync --id` contract to update.

## .acceptance

- `sql-schema-control sync --slug <slug>` reconciles the changelog (parity with the old `--id`).
- `--id` and `id:` are **gone** — no alias, no dual-accept.
- `control.yml` change definitions use `slug:`.
- extant changelogs migrate cleanly (no lost history).
- `rhachet-roles-ghlitch` passes `--slug` straight through, no translation.
