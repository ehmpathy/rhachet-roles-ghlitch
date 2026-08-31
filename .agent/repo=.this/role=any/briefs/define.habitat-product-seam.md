# define.habitat-product-seam

## .what

the one seam where 🧿 **guardian** and 🛡️ **hardener** meet. their subjects differ — hardener
secures the **product** (the artifact you ship), guardian protects the **habitat** (the environment
an inhabitant lives and works in). but the two are not fully disjoint, because **a product is built
inside a habitat**. so a compromised habitat can poison an otherwise-clean product. that propagation
path is the seam.

> **note — internal architecture doc, not security advice.** this brief defines a role boundary for
> the roles in this repo. it is dev-side architecture, not guidance to a person about their own
> network or device, so it is out of scope for the not-security-advice disclaimer (the same carve-out
> `howto.cite-via-bhrowser` takes). the hazard *class* it names is real; a brief on it for a person
> would be a bhrowser-cited hazard doc, not this define.

## .why it matters — the "no overlap" correction

the role readmes state "distinct scopes, no overlap." that is *almost* right and one word wrong.
the **subjects** are distinct (product vs habitat), but there is exactly **one shared seam**, and it
is high-value: a product's integrity is only as sound as the habitat that assembled it. a clean
source tree, reviewed line by line, still ships compromised if the build habitat around it was
breached. so "no overlap" becomes **"distinct subjects, one shared seam."**

## .the mechanism — build-integrity / supply-chain

a product is assembled **in** a habitat: a build host, a ci runner, a camp-grove ec2 where an agent
works. if that habitat's perimeter is breached, the breach crosses into the artifact:

- **infil** — a poisoned dependency, a malicious base image, or a prompt-injection payload the
  build agent obeys → the poison is baked **into** the product, though the published source is clean
- **exfil** — the habitat's secrets leak out (the keys that sign releases, ci tokens) → future
  artifacts can be forged, though the product's own code never changed

the product's code review passes. the compromise entered through the **habitat**, not the source —
which is precisely why a product-only audit cannot catch it, and why the seam needs both roles.

the canonical public case is the SolarWinds build compromise: the build system was breached, so
signed updates carried a backdoor to many downstream consumers while the published source stayed
clean. (well-known illustration; a hazard brief for a person would cite it verbatim via the
bhrowser.)

## .who owns the seam — both, from their own side

neither role alone closes it. each holds one half:

- **guardian (habitat side)** — hold the habitat unpoisoned. watch the perimeter: infil of a
  poisoned dep or a hostile payload, exfil of a build secret. trace the habitat compromise through
  the same `exposure.mechanism → symptom.mechanism → symptom.expression` chain, with eliminate /
  detect / respond.
- **hardener (product side)** — do not let a poisoned habitat corrupt the product. the artifact must
  not blindly trust its build environment: pinned deps, reproducible builds, an SBOM, signed
  artifacts, least-privilege build credentials.

guardian holds the habitat clean; hardener holds a dirty habitat's poison out of the product. the
seam is closed only when both hold.

## .the boundary, restated

| the case | owner |
|----------|-------|
| a weakness in shipped product code (e.g. an injection bug) | 🛡️ hardener |
| a threat to the habitat itself (e.g. an agent's ec2 on a hostile network) | 🧿 guardian |
| a **habitat compromise that propagates into the product** (build / supply-chain) | **the seam — both** |

## .see also

- `src/domain.roles/guardian/readme.md` · `src/domain.roles/hardener/readme.md` — the boundary line
  this brief refines (the "no overlap" correction)
- `src/domain.roles/guardian/briefs/im_a.guardian.md` — the habitat/ward frame (watch + ward + humble)
- `src/domain.roles/guardian/briefs/howto.apply-causal-chain.[lesson].md` — the four-node chain a
  habitat-side infil/exfil vector would trace
