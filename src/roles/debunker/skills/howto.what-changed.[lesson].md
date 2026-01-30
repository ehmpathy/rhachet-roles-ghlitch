# howto: track down regressions with "what changed?"

## .what

use git history to identify which change introduced a regression, instead of guesses or full code reads

## .why

- regressions mean behavior **used to work** and now doesn't
- the cause is always in the **diff** between the good and broken states
- git history tells you exactly what changed — no guesses required
- faster than code reads: you only examine what's different

## .when

use this when:
- tests that passed now fail
- behavior changed unexpectedly
- ci was green, now it's red
- "it worked yesterday"

## .how

### 1. understand the failure

first, know what's broken:

```sh
# see test errors from ci
npx rhachet run --skill show.gh.test.errors

# or run locally
npm run test:acceptance:locally
```

note the **expected** vs **realized** behavior — this tells you what to look for in the diff.

### 2. check recent commits

```sh
git log --oneline -5
```

output:
```
e9d5054 fix(deps): bump brains to dev deps
7789198 chore(release): v0.7.2
1e67b48 fix(context): upgrade to latest rhachet
```

### 3. examine the suspect commit

```sh
# see which files changed
git show e9d5054 --stat

# see the actual diff
git diff HEAD~1 -- package.json
```

### 4. connect the diff to the failure

ask: "how could this change cause the failure i observe?"

**example from this repo:**

- **failure**: tests expected `"ref not found"` error, but review succeeded
- **diff**: `"rhachet-roles-bhrain": "link:."` → `"rhachet-roles-bhrain": "0.7.0"`
- **connection**: `link:.` runs local built code; `0.7.0` runs published npm code
- **root cause**: published v0.7.0 lacks the error handler the tests expect

### 5. verify with bisect (if needed)

when the culprit isn't obvious from recent commits:

```sh
git bisect start
git bisect bad HEAD
git bisect good <known-good-commit>
# git will guide you through binary search
```

## .example: the full flow

```sh
# 1. see what failed
npx rhachet run --skill show.gh.test.errors
# → "Expected: 'ref not found', Received: review output"

# 2. check recent commits
git log --oneline -3
# → e9d5054 fix(deps): bump brains to dev deps

# 3. see what that commit changed
git show e9d5054 --stat
# → package.json changed

git diff HEAD~1 -- package.json
# → rhachet-roles-bhrain: "link:." → "0.7.0"

# 4. aha! acceptance tests run against node_modules/rhachet-roles-bhrain
#    link:. = local dist/ (has new error handler)
#    0.7.0 = published package (lacks error handler)

# 5. fix: revert the change
```

## .key insight

> the answer is always in the diff
>
> don't guess — let git tell you what changed

## .see also

- `howto.bisect.[lesson]` — binary search for harder-to-find regressions
- `howto.acceptance-test-setup.[lesson]` — why `link:.` matters for this repo
