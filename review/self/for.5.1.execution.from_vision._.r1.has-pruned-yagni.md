# self review r1 — has-pruned-yagni

> for each component: was it requested? is it the minimum viable way? did i add abstraction
> "for flexibility", features "while i'm here", or premature optimization?

i audited every new file and every function against the vision. the build is lean — but two additions go beyond what the vision spelled out and deserve a flag.

---

## verdict

mostly minimal. one real flag: the **terraform read-only allowlist** has 10 entries; the vision named only 5. i justify the extra 5 as *required* for "plan stays open", but `init` is a genuine judgment call worth a callout. one minor redundancy: `set --quant infinite` overlaps `allow`.

---

## flag 1 — terraform allowlist expanded beyond the vision's 5

the vision said: "`plan`, `validate`, `show`, `output`, `fmt` pass through ungated." i shipped `provision.terraform.sh:152`:

```
TF_READONLY=" plan validate show output fmt init get providers version graph "
```

— i added `init get providers version graph`.

- **was it requested?** the 5 were; the other 5 were not.
- **is it gold-plate?** i argue **no, it's required for the prescribed behavior**: "plan stays open." you cannot `terraform plan` without a prior `terraform init` (and `get`/`providers`). a gate on `init` at prod would block the very plan workflow the wisher asked to keep open. `version`/`graph` are pure reads — a gate on them would be an absurd footgun (a prod grant to print the terraform version).
- **the honest exception is `init`.** `terraform init` can migrate backend state on a backend-config change — not pure-read. i left it ungated because it is a prerequisite for plan and does not apply infra changes. but this is a *judgment call* the vision did not make. **flagged for the wisher.**
- **how handled:** kept the list (it serves the requirement), documented the fail-closed rationale inline, and raise `init` here as an open call. if the wisher wants `init` gated, it's a one-word delete from the allowlist.

## flag 2 — `set --quant infinite` overlaps `allow` (minor)

`uses.local.sh` accepts `set --quant infinite`, which produces the same state as `allow`. the vision prescribed `set --quant N` *and* `allow` as distinct affordances.

- **is it redundant?** mildly — two paths to one state. but it mirrors the `git.commit.uses` reference exactly (which accepts `--quant infinite`), costs one branch, and is what a user familiar with the reference would try. i kept it for consistency with the named reference rather than invent a divergence. low-risk; noted, not removed.

---

## non-issues (audited, genuinely minimal)

- **the shared engine + `--meter` param** — this IS the prescribed design ("one engine, two meters"), not speculative abstraction. without it the two meters would be copy-paste forks (the vision's awkward #5 warns against exactly that).
- **three scope handlers (local/global/org)** — each is a wish requirement ("repo, org, and global scope"). none is speculative.
- **`uses.check.sh` as a separate gate** — prescribed as the consumer choke point; keeps the 4 consumer skills to a 2-line insert each. minimal.
- **`del` command + `del_local_uses`** — prescribed (`block`/`del`). not extra.
- **`get` shows local/org/global** — prescribed ("check current lock state"); a single read across the three scopes, no extra machinery.
- **no speculative extras**: no audit log, no expiry timer, no telemetry, no config knobs, no per-env support beyond prod (callers only ever gate prod). i resisted all "while i'm here" temptations.
- **no premature optimization**: plain jq reads/writes, no cache, no batch logic. correctness-first, as the scale warrants.

---

## conclusion

the implementation is close to minimal-viable. the only genuine scope question is the terraform allowlist — and even there the extra entries serve the prescribed "plan stays open", not flexibility-for-its-own-sake. the one true judgment call (`init` ungated) is now flagged for the wisher rather than shipped in silence. `set --quant infinite` is a deliberate consistency choice with the named reference, not gold-plate.
