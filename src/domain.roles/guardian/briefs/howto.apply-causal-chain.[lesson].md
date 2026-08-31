# howto.apply-causal-chain

## .what

the step-by-step to trace one attack `case` through the four-node frame
(`define.causal-chain.[lesson].md`) and land it as a matched set of cited briefs.

> ⚠️ **not professional security advice — informational only.** a reason-frame; its output is
> signal for a person or a qualified security professional, never a substitute for one.

> **recommendation disclaimer.** the method below is offered to the best of our knowledge from the
> info found in research — it carries **no guarantee of success or outcome**, and must be reviewed by
> a qualified security professional against your own real network, device, and threat model before
> reliance. it is groundwork for that review, not a substitute for it.

## .the steps

### 1. anchor the case

name the `case=$sub` from its **exposure.mechanism** — the distinct weakness it exploits
(`evil-twin`, `captive-portal-phish`, `passive-sniff`, `deauth-dos`). the case slug adopts the
field's own term (per `rule.require.ubiqlang`). the `exposure.expression` (the lever the person
pulls) is the case anchor itself, so it needs no inventory of its own.

### 2. trace the three nodes into three briefs

for each case, emit one brief per further node:

| brief | the node | what it holds |
|-------|----------|---------------|
| `inventory.of=exposure.mechanism.case=$sub.md` | exposure.mechanism | *how* the exposure enables harm + the **elimination** that breaks it |
| `inventory.of=symptom.mechanism.case=$sub.md` | symptom.mechanism | the compromise that follows + why the elimination prevents it |
| `inventory.of=symptom.expression.case=$sub.md` | symptom.expression | the observable signs + the **detection** guidance |

### 3. fit each item with its three answers

per the wish, every item carries the guardian's three answer axes:

- **eliminate** — what breaks the mechanism (route over cellular, a trusted vpn, never tap through a
  cert alert). state whether the hazard can be *eliminated* or only *mitigated*.
- **detect** — the observable sign (`symptom.expression`) that tells the person it fired.
- **respond** — what to do once hit (disconnect, rotate credentials from a trusted device).

### 4. calibrate honestly

rank by **real residual risk**, not folklore. in the https-everywhere era, most passive-read attacks
are closed by tls + hsts; say so, and name the *few* paths that remain (captive-portal phish, a
cert-alert tap-through, plaintext apps). label likelihood as an ordinal band, honest about
under-quantification — never a fake measured rate.

### 5. cite each claim via the bhrowser

every factual claim traces to a **bhrowser**-read source, quoted verbatim, **≥7 distinct sources**
per research doc (`rule.require.bhrowser-citations`, `rule.require.seven-distinct-citations`).
WebSearch/WebFetch are forbidden as citations. carry the disclaimer
(`rule.require.recommendation-disclaimer`).

### 6. note platform inline

keep chains **platform-agnostic**; call out platform/device posture (patched iPhone vs. unpatched
laptop) inline only where it changes the verdict — do not partition the file tree by platform.

## .the many-to-many check

before you close a case, confirm the cross-wire holds: does one exposure fan out to several
compromises? does the same symptom reach back to more than one case? if a `symptom.mechanism`
(e.g. account takeover) is reached by two cases, reference the kin case rather than duplicate it —
the diagnosis is the *path*, not the endpoint.

## .see also

- `define.causal-chain.[lesson].md` — the frame this applies
- `inventory.of=attack.vector/exposure=wifi.public/readme.md` — the worked vector
