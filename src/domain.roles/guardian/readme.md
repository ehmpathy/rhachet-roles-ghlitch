## 🧿 guardian

- **scale**: habitat-level, cyber-health
- **focus**: attack vectors, exposure/symptom causal chains, elimination, detection
- **maximizes**: an inhabitant kept safe — a cited inventory of *what the hazards are, how to
  eliminate them, and how to detect them*

an **active watchguard and protector** for cyber health. the guardian protects a **habitat** — the
environment an inhabitant (a person, an agent) lives and works in. it does for a habitat's digital
exposure what a clinician does for physical health: it traces a cited **causal chain** from an
exposure to its observable harm.

its mark is the **nazar** (🧿), the evil-eye ward — from the Arabic *naẓar*, "the gaze / to watch."
the name is the job: a ward that keeps the watchful gaze, protects rather than attacks, and stays
**humble** — for security is a cat-and-mouse game, and pride is the way in the adversary takes. see
`briefs/im_a.guardian.md` for the mark's full etymology and the deep envy/pride history it carries.

**what ships today** is the cited **inventory** — the briefs under `briefs/`, each of which holds
*what the hazard is, how to eliminate it, and how to detect it* with verbatim sources. the **answer-router** —
the invocation surface that takes an inhabitant's plain question and navigates it to the brief that
answers it — is a **planned follow-on** the inventory is the foundation for; `skills/` is empty
until then.

## what it wards

the guardian wields one mark — the **nazar** (🧿), the watchful gaze — and wards the habitat's
perimeter along the two directions a compromise crosses it:

- 🦠 **infil** — infiltration into the habitat: a poisoned dep, a hostile payload, a rogue gateway
- 🩸 **exfil** — exfiltration out of the habitat: a leaked secret, data bled across the perimeter

each attack-vector inventory traces these through the causal chain; the infil/exfil split is the
native frame for a bounded habitat such as a camp-grove ec2.

## scope

the guardian owns the full cyber-health assessment for an attack vector:

| stage | what it covers |
|-------|----------------|
| inventory | the cited briefs — every way an exposure can harm you, mechanism by mechanism |
| eliminate | per hazard: what breaks the mechanism (the prevention) |
| detect | the observable signs a hazard has fired (the detection surface) |
| respond | what to do once hit (recovery) |

the knowledge base is an **inventory** of `attack.vector=$x` cases, each traced through the four-node
chain `exposure.expression → exposure.mechanism → symptom.mechanism → symptom.expression`. each
vector's inventory lives under `briefs/inventory.of=attack.vector/`.

## the causal chain

| node | what it is |
|------|-----------|
| exposure.expression | the lever pulled — the action or exposure taken |
| exposure.mechanism | *how* the exposure enables harm |
| symptom.mechanism | the compromise that follows — the pathological state |
| symptom.expression | the observable sign — the detection surface |

## disclaimer

> ⚠️ **this is not professional security advice.** the guardian is informational only and does not
> assess your specific network, device, or situation. consult a qualified security professional for
> any real assessment.
>
> if you believe you are under active attack or your accounts are compromised, disconnect, change
> passwords from a trusted device, and contact your security team or provider now.

## .see also

- 🛡️ hardener (`../hardener/readme.md`) — the system-scale twin. guardian protects the **habitat**
  (the environment an inhabitant lives and works in); hardener secures **the product** (the artifact
  shipped). distinct subjects, **one shared seam** — a product can be poisoned by the habitat it is
  built in. see `.agent/repo=.this/role=any/briefs/define.habitat-product-seam.md`.
