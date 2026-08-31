# prototype — ingress/egress overlay on `case=evil-twin`

> **status: prototype, not shipped.** this file lives under `refs/research/` — it is a concrete
> shape for the wisher to weigh the ingress/egress frame extension (yield §"frame extension —
> ingress/egress dual perspective"), **not** a shipped guardian brief. it re-reads the extant
> `case=evil-twin` node briefs through the directional lens so the shape is visible before a
> decision. it deliberately does not re-cite; it points at the shipped briefs that already carry the
> verbatim citations.

## .what this shows

the wish's final question: *"evaluate our frame perspective against the ingress vs egress dual
perspective? i.e., block inbound infiltration, vs block outbound exfiltration."*

the answer, made concrete: the causal chain (the file skeleton) is **unchanged**; each mechanism
node gains a `direction:` read, and the **eliminate** axis regroups into **break-the-ingress** vs
**break-the-egress**. no file moves — an attribute add + an eliminate-bullet regroup.

## .the direction key

| tag | sense | who moves the bytes |
|-----|-------|---------------------|
| `ingress` | inbound infiltration | attacker pushes **in** — associate, inject, forge |
| `egress` | outbound exfiltration | user data leaks **out** — captured, logged, tracked |
| `both` | a man-in-the-middle position holds **both** directions at once | attacker sits astride the flow |
| `neither` | availability-only — breaks the link, reads no data either way | denial-of-service |

## .the overlay — evil-twin, node by node

### exposure.mechanism — `direction: ingress`
> shipped: `inventory.of=exposure.mechanism.case=evil-twin.md`

802.11 SSIDs are unauthenticated, so a client associates to the strongest name-match and the attacker
AP becomes the gateway. the flow that matters here is **inbound**: the attacker inserts their AP
**into** the victim's path. this is the ingress foothold every downstream compromise stands on.

### symptom.mechanism — `direction: both`
> shipped: `inventory.of=symptom.mechanism.case=evil-twin.md`

from the gateway seat the attacker holds a full man-in-the-middle position — **both** directions at
once:
- **ingress half:** push a forged captive portal at the user, inject a dns answer, attempt a
  downgrade. (attacker → victim)
- **egress half:** capture plaintext, log dns queries, read anything a cert-lax app sends in the
  clear. (victim → attacker)

this `both` read is exactly why evil-twin cannot be a single-direction file — the one mechanism spans
the pair.

### symptom.expression — the detection surface (direction-neutral)
> shipped: `inventory.of=symptom.expression.case=evil-twin.md`

the observable signs (a cert alert, a wrong-domain portal, a later login-from-unknown-location) are
where a symptom **surfaces**, not where the bytes flow — so the direction tag is a property of the
*mechanism* nodes, not the *expression* node. this is a tell that `direction:` is mechanism-scoped
metadata, not a case-wide label.

## .the eliminate axis, regrouped by direction

the shipped brief's `## .the answer axes` → **eliminate** reads as one list; the overlay splits it so
a reader sees which control cuts which direction:

- **break-the-ingress** (stop the attacker's inbound insert + forgeries)
  - disable SSID auto-join, so the client does not silently associate to the rogue AP (cuts the
    exposure.mechanism foothold itself).
  - never tap through a cert alert — the alert **is** the ingress downgrade attempt surfaced; a
    tap-through is what converts a blocked inject into a real compromise.
  - never type into an unverified captive portal — a forged portal is an inbound forgery.
- **break-the-egress** (stop the outbound leak of user data)
  - a trusted vpn (or cellular): the man-in-the-middle sees ciphertext only, so the egress capture
    yields no usable data ([S7], [S4] in the shipped brief).
  - tls + hsts already close the passive-read + downgrade egress paths for well-configured sites
    ([S6], [S8]) — the residual egress leak is the minority of cert-lax / plaintext apps.

note the payoff: a person now sees that a **vpn is an egress control** (it does not stop the
attacker's association, it stops the outbound leak of your data) while **cert-alert discipline is an
ingress control** (it stops the inbound downgrade). the single flat "eliminate" list obscured that
split; the directional regroup makes it legible.

## .likelihood (unchanged)

the `band:` label is orthogonal to direction and carries over verbatim from the shipped
`symptom.mechanism` brief: *the mitm position is common; a data-theft outcome is
uncommon-for-tls-traffic.* the directional overlay does not change the ordinal judgment — it names
*which direction* the residual risk lives in (the egress leak of cert-lax traffic).

## .verdict from the prototype

- the two frames **compose** cleanly — the causal chain stays the skeleton, direction rides on top.
- `both` is real and common (every mitm case is `both`), which is the decisive evidence **against** a
  case×direction file dimension: it would force `case=evil-twin` to smear across two files.
- the **eliminate regroup** is where the lens pays off for a reader — it turns "here are five
  controls" into "here is what keeps them out vs. what keeps your data in."
- the lens is **confidentiality-only**: a `neither` case (a deauth denial-of-service) gains no value
  from it, which confirms direction must be an overlay, never the primary partition.

## .see also

- yield §"frame extension (wisher-gated) — ingress/egress dual perspective" — the tracked decision
- `inventory.of=exposure.mechanism.case=evil-twin.md` · `inventory.of=symptom.mechanism.case=evil-twin.md`
  · `inventory.of=symptom.expression.case=evil-twin.md` — the shipped, cited briefs this re-reads
- `define.causal-chain.[lesson].md` — the frame the overlay rides on
