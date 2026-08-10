# rule.forbid.declastruct-provider-assumptions

# tldr

## severity: blocker

never assume which provider a `provision.declastruct` run targets. declastruct provisions **any**
declared resource — aws, github, stripe, postgres, or a provider whose sdk lands next month. the
skill orchestrates a wish file; the **wish file** decides what gets provisioned.

**the line is SUPPORT versus REQUIRE.** the skill may carry provider-aware logic — aws credential
precedence, a github token shape, whatever a provider genuinely needs. what it may never do is
**require** that provider: demand its credentials, belay without them, or word an error as though
every run were one of its runs.

provider-aware logic is legitimate when it is **conditional** (it engages only when that provider's
credentials are actually in play) and **opted into** (the caller's `--auth` declaration, or the
wish's own imports, put them in play — never a guess by the skill).

---
---
---

# deets

## .what

`provision.declastruct` is **provider-agnostic by construction**. it takes a `--wish <file>`, and
that file declares resources against whatever declastruct sdks it imports. the skill's job is to
supply credentials, honor the gate, and hand off to `npx declastruct`. it never learns — and must
never guess — which provider the wish targets.

this rule forbids every shape that smuggles a provider assumption into the skill.

## .why

- **a provider-specific assert breaks unrelated callers.** a check for `AWS_PROFILE` fails a
  github-only wish that holds a perfectly good `GITHUB_TOKEN`. the caller is blocked on a
  credential their run never needed, by a check that claims to be about credentials in general
- **provider-specific error text misdirects.** "absent aws session" sends a caller to
  `aws sso login` when their real gap was a github token. that is
  `rule.require.errors-name-the-fix` broken at the root: the error names a fix for a problem the
  caller does not have
- **the provider set grows.** aws and github are the two in front of us today;
  `declastruct-stripe-sdk` already exists. any enumeration of providers inside this skill rots on
  the next sdk
- **the wish file is the source of truth.** it declares the resources, so it — never the skill —
  knows the provider. to guess in the skill is to duplicate a fact that already lives one layer up,
  and to duplicate it wrongly

## severity: blocker

a provider assumption costs a caller a **wrong diagnosis**: their run belays or dies with the name
of a provider they never used, and the real gap stays invisible. that is the exact defect class
`v2026_08_06.fix-provision-declastruct-auth` was opened to repair — an error that named neither the
true cause nor the true fix.

## .where

- `src/domain.roles/deployer/skills/provision.declastruct.sh` and its tests
- any future skill that wraps `npx declastruct`
- **not** a wish file itself — a wish file is expected to be provider-specific; that is its job

## .how

### 👎 forbidden

```bash
# 👎 asserts an aws credential the wish may not need
if [[ -z "${AWS_PROFILE:-}" && -z "${AWS_ACCESS_KEY_ID:-}" ]]; then
  echo "   ├─ absent aws session" >&2
  exit 2
fi

# 👎 error text presumes the provider
echo "   └─ fix: run aws sso login, then re-run" >&2

# 👎 output line presumes the provider
echo "   ├─ identity: profile $AWS_PROFILE"

# 👎 a flag whose value set names providers
--provider aws|github
```

### 👍 required

speak in terms of the **declared credential source**, never the provider:

```bash
# 👍 the assert is about the source the caller declared, not about any provider
#    via-keyrack yielded no keys for this env => the declaration cannot be honored
if [[ "$AUTH" == "via-keyrack" && "$KEYS_SOURCED" -eq 0 ]]; then
  echo "   ├─ absent credentials: keyrack holds no keys for env=$ENV" >&2
  echo "   ├─ fix: fill them — rhx keyrack fill --owner <owner>" >&2
  echo "   └─ or: declare this shell's own session with --auth via-ambient" >&2
  exit 2
fi
```

and echo **what was supplied**, without a claim about what it is for:

```
   ├─ auth: via-keyrack
   └─ identity
      ├─ AWS_PROFILE = ehmpathy.demo.ehmpath
      └─ GITHUB_TOKEN = (set)
```

the skill reports the credential-carrying variables it supplied. it does not assert that any one of
them is the one the wish needs — that is the wish's business.

### the test

> "if the wish targeted a provider we have never heard of, would this line still be true?"

- yes → provider-agnostic, keep it
- no → apply the support-versus-require test below

### the support-versus-require test

provider-aware logic passes when **all three** hold:

1. **conditional** — it engages only when that provider's credentials are actually in play. an
   aws-shaped step must be a no-op on a github-only run
2. **opted into** — what puts them in play is the caller's `--auth` declaration or the wish's own
   imports. never a sniff, never a default that presumes the provider
3. **narrows, never demands** — it may clear or re-order credentials the caller supplied. it may
   never assert that a given provider's credential must be present

if any of the three fails, the logic **requires** the provider, and that is the blocker.

#### 👍 passes — aws support, no aws requirement

on `--auth via-keyrack`, ambient AWS static keys are cleared so a keyrack-supplied `AWS_PROFILE`
stands alone:

- **conditional** — it fires only when keyrack actually supplied an aws credential for this env; a
  github-only wish never reaches it
- **opted into** — the caller typed `--auth via-keyrack`, which is precisely the declaration "the
  vault decides my credentials, not this shell". `--auth via-ambient` is the opposite opt-in, and
  under it the same aws keys are left exactly as they are
- **narrows** — it removes a competitor, and never asserts that any aws credential must exist

so aws keys are **fully supported on both paths**, and their treatment follows from the caller's
own declaration. that is support without requirement.

#### 👎 fails — the same knowledge, as a demand

```bash
# 👎 REQUIRES aws: belays a github-only wish over a credential it never needed
[[ -z "${AWS_PROFILE:-}" && -z "${AWS_ACCESS_KEY_ID:-}" ]] && exit 2
```

## .note — the sibling hazard: caller-context assumptions

the same failure of imagination shows up one step out: a belay that prescribes a command from the
**caller's** world rather than this package's. this repo is a generic role package consumed by many
orgs, so a hint like `add --owner admin for an iam write`, or a named org-specific wrapper skill,
is wrong for the same reason a provider assumption is — it presumes a context the skill cannot see.

state the **shape** of the fix (`select a session in THIS shell`), never the org's, tier's, or
provider's specific incantation.

## .examples

### positive

```bash
# provider-agnostic: names the source, the env, and a fix in this package's own vocabulary
echo "   ├─ absent credentials: keyrack holds no keys for env=$ENV" >&2
echo "   └─ or: declare this shell's own session with --auth via-ambient" >&2
```

### negative

```bash
# presumes aws, AND prescribes an org-specific tier flag
echo "   ├─ absent ambient aws session: neither AWS_PROFILE nor AWS_ACCESS_KEY_ID is set" >&2
echo "   └─ fix: select a session (add --owner admin for an iam write)" >&2
```

## .enforcement

- a credential assert keyed on one provider's variables = **blocker**
- provider-aware logic that fires unconditionally, rather than only when that provider's
  credentials are in play = **blocker**
- provider-aware logic that is **conditional + opted into + narrowing** = **false positive**; it
  supports the provider without a requirement (see the support-versus-require test)
- error or hint text that names a provider the skill cannot know it needs = **blocker**
- an output line that claims a supplied credential belongs to a given provider = **blocker**
- a flag, enum, or branch in the skill that enumerates providers = **blocker**
- a belay that prescribes an org-specific or tier-specific command = **blocker** (see `.note`)

## .see also

- `rule.require.errors-name-the-fix` (ergonomist) — an error must name the fix for the *caller's*
  problem, which requires no guess about what that problem is
- `rule.forbid.fallbacks` — the adjacent rule against a guess that stands in for a declaration
- `rule.prefer.declastruct.[demo]` (mechanic) — the declastruct pattern, demonstrated on a
  non-aws provider (stripe), which is why this rule exists
