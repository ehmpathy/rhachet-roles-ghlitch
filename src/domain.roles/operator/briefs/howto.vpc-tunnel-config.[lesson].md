# howto.vpc-tunnel-config

## .what

explains the shape of `database.tunnel` config that `use.vpc.tunnel` reads, why it splits
into a near end and a far end, how it maps onto the declared aws vpc tunnel, and a checklist
to run when a tunnel misbehaves.

## .why

the config lives in the consumer repo, not in this role repo — `use.vpc.tunnel` reads it via
that repo's `getConfig()`. so the skill is only as correct as the config it is handed. a
repeat failure mode proves the cost of an undocumented shape:

> a consumer bypasses the per-env config files and hardcodes a single map keyed by env,
> where **every env points at the prod host**:
> ```ts
> test: { host: 'aws.ssmproxy.db.prod', port: 15432 },
> prep: { host: 'aws.ssmproxy.db.prod', port: 15432 },
> prod: { host: 'aws.ssmproxy.db.prod', port: 15433 },
> ```
> the tunnel opens an alias for the prod host but the app expects the env-specific host, so
> the connection fails. the fix is to drop the map and use the per-env config files, each
> with its own host + port.

the knowledge that "each env needs its own host + port" is easy to lose. this brief keeps it
in the repo so the next tunnel bug is a lookup, not a rediscovery.

---

## the two ends of an ssm tunnel

an ssm tunnel has two ends, and the config splits along that line:

| config fields | end | role | who consumes |
|---------------|-----|------|--------------|
| `bastion`, `cluster`, `aws.account` | far | the inputs to **open** the tunnel: route ssm through the bastion into the rds cluster | `use.vpc.tunnel` only |
| `local.host`, `local.port` | near | where the tunnel **binds** locally; the alias resolves to `127.0.0.1` | whoever connects after it is open (the app, `use.rds.capacity`'s poll) |

the far end is provider vocabulary — how to reach the remote. the near end is the local
connection point everyone downstream actually uses.

## the config shape

config is **per-env files**, not one object with an env-keyed map. `getConfig` reads
`config/*.json` and selects the file for the current env (the skill exports `STAGE=$ENV`).
so `getConfig()` returns the **flat** config for that one env — there is no env key inside
it. the skill reads `getConfig().database.tunnel.local.host`, never `...tunnel.prep.host`.

```
config/
├── test.json     // host: "localhost" (local testdb, no tunnel)
├── prep.json     // host: "aws.ssmproxy.mydb.prep", port: 15432
└── prod.json     // host: "aws.ssmproxy.mydb.prod", port: 15433
```

each file carries the same flat shape. the tunnel keys the skill reads are shown below — a
**partial slice**; the file also holds the base config keys (`organization`, `project`,
`environment.access`, `aws.namespace`) that every env file already carries:

```jsonc
// config/prep.json (tunnel-relevant keys only)
{
  "aws": { "account": "123456789012" },
  "database": {
    "tunnel": {
      "bastion": { "exid": "vpc-main-bastion" },   // far: ssm target instance
      "cluster": { "name": "mydb-prep" },          // far: rds cluster
      "local": {
        "host": "aws.ssmproxy.mydb.prep",          // near: hostname alias → 127.0.0.1
        "port": 15432                              // near: local bind port
      }
    }
  }
}
```

each env file supplies its **own** values. distinct ports per env (e.g. prep `15432`, prod
`15433`) let both tunnels run at once without a port collision.

## the map onto the declared tunnel

`use.vpc.tunnel.ts` casts the flat config into declastruct's `via` / `into` / `from` shape:

```ts
DeclaredAwsVpcTunnel.as({
  via:  { mechanism: 'aws.ssm', bastion },        // far: config.bastion
  into: { cluster },                               // far: config.cluster
  from: { host: 'localhost', port: local.port },   // near: config.local.port
  status: 'OPEN',
});
// + a host alias: config.local.host → 127.0.0.1 in /etc/hosts
```

so the full path is:

```
app / poll  →  local.host:local.port  (aliased to 127.0.0.1)
            →  ssm session
            →  bastion (in the vpc)
            →  rds cluster:5432   (far port derived from the cluster, not from config)
```

config only picks the **near** port (`local.port`). the far/remote port is the cluster's
own (rds default `5432`), derived by declastruct-aws — not set in config.

### why the config is not the raw `via/into/from` shape

config stays in domain vocabulary (`database.tunnel.local` = "where do i connect locally")
on purpose:

- the app and the capacity poll want the **local** endpoint; they do not care about ssm
  internals. domain vocab serves the consumer.
- config must not couple to a node_modules api shape. if declastruct-aws renamed
  `via`→`through`, every repo's config would break. the skill's `.ts` is the cast layer that
  absorbs that churn (see architect brief `rule.prefer.declastruct`).
- the `test` env has **no tunnel** — `local.host: localhost` short-circuits the ssm path
  entirely. a raw `via/into/from` config would force awkward null far-end fields for the
  no-tunnel case; `local.{host,port}` expresses both "tunnel to a cluster" and "just a
  local testdb" cleanly.

## the localhost short-circuit

when `local.host == localhost` (a local testdb, no bastion), `use.vpc.tunnel` skips the ssm
path and points at `localhost:local.port`. the decision is config-driven (host value), not a
hardcoded `env == test` check — so the env values stay in config.

---

## tunnel issue? check this

run this checklist before you dig into ssm or aws internals:

1. **which env am i on?** confirm `--env` is what you intend. no default — an absent `--env`
   fails fast by design.
2. **per-env host is distinct.** open `getConfig().database.tunnel.local.host` for THIS env.
   the classic bug is every env aliased to the prod host. prep must be a prep host, prod a
   prod host.
3. **per-env port is distinct.** prep and prod must bind different `local.port` values, else
   the second tunnel collides with the first.
4. **the app connects to the same near endpoint the tunnel binds.** the app's db host+port
   must equal `local.host:local.port`. a mismatch = "tunnel is open but the app cannot
   reach it."
5. **far-end config is filled for ssm envs.** `bastion.exid`, `cluster.name`, `aws.account`
   must be real (not `null`) for prep/prod. the skill fails fast and names the absent key.
6. **test uses `localhost`.** if `test` points at an `aws.ssmproxy.*` host it will try to
   open a real tunnel instead of a reach to the local testdb.

## .note — the shape is a declapract standard

the `database.tunnel: { bastion, cluster, local: { host, port } }` + `aws.account` shape is
the standardized config declared by `declapract-typescript-ehmpathy`. every rds-persistent
repo inherits it, so consumers get a pit of success rather than a blank canvas. when you set
tunnel config in a consumer repo, follow that declared shape — do not invent a per-repo
variant (that is what produces the every-env-points-at-prod bug). if a repo's config drifts
from the shape above, align it back to the declapract standard.

## .see also

- `src/domain.roles/operator/skills/use.vpc.tunnel.sh` — reads the config, validates, opens
- `src/domain.roles/operator/skills/use.vpc.tunnel.ts` — casts config → declared tunnel
- `src/domain.roles/operator/skills/use.rds.capacity.sh` — composes the tunnel, then polls
  the near endpoint
- `.agent/repo=.this/role=any/briefs/rule.forbid.config-defaults.md` — never default an
  absent tunnel value
- architect `rule.prefer.declastruct` — why the skill casts into its own shape
