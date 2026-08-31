# define.causal-chain

## .what

the canonical ontology for how an attack leads to an observable harm in this role. a guardian
assessment is a path through a **four-node causal chain**, exposure-side to symptom-side:

```
exposure.expression ──▶ exposure.mechanism ──▶ symptom.mechanism ──▶ symptom.expression
```

> ⚠️ **not professional security advice — informational only.** a reason-frame; its output is
> signal for a person or a qualified security professional, never a substitute for one.

> **recommendation disclaimer.** the guidance below is offered to the best of our knowledge from the
> info found in research — it carries **no guarantee of success or outcome**, and must be reviewed by
> a qualified security professional against your own real network, device, and threat model before
> reliance. it is groundwork for that review, not a substitute for it.

## .the four nodes

| node | what it is | nature | wifi.public example |
|------|-----------|--------|---------------------|
| **exposure.expression** | the action / exposure taken — a lever you can pull or withhold | an event | a device auto-joins an open ssid named "Airport Free WiFi" |
| **exposure.mechanism** | *how* the exposure enables harm — the weakness that lets it | a **process / pathway** | 802.11 ssids are unauthenticated, so a client associates to an attacker's access point |
| **symptom.mechanism** | the compromise that follows — the pathological state | a **state / position** | the attacker holds a man-in-the-middle position over all traffic |
| **symptom.expression** | the observable sign — the detection surface | an observation | an unexpected cert alert, a captive portal on a wrong domain, a login from an unknown location |

## .the chain is many-to-many, not linear

the two `mechanism` nodes share a word but sit at different layers, and the edges between every
layer are **many-to-many**:

- one **exposure.expression** can act through several **exposure.mechanisms** (a join to an open
  network exposes you to both passive capture *and* an active man-in-the-middle)
- one **exposure.mechanism** can produce several **symptom.mechanisms** (a man-in-the-middle position
  enables a dns spoof *or* a captive-portal phish *or* plaintext capture)
- one **symptom.mechanism** can arise from several **exposure.mechanisms** (a stolen credential
  reached via an evil-twin *or* a captive-portal phish)
- one **symptom.mechanism** can present as several **symptom.expressions** (a man-in-the-middle
  shows as a cert alert *and* a later login-from-unknown-location alert)

```
exposure.expression ─┐   exposure.mechanism ─┐   symptom.mechanism ─┐   symptom.expression
  join open wifi     ┼─▶  unauth ssid assoc  ┼─▶  mitm position     ┼─▶  cert alert
  tap a portal       ┼─▶  no link encryption ┼─▶  credential theft  ┼─▶  wrong-domain portal
  auto-join a name   ┘   trusted portal ui    ┘   plaintext capture  ┘   login from unknown place
```

so `exposure.mechanism` ≠ `symptom.mechanism`: the first is a **process** (verb-like, "how it
enables harm"), the second is a **state** (noun-like, "what compromise now holds"). many pathways,
many compromises, cross-wired.

## .the map to mhedic

this frame is the cyber twin of the mhedic diagnostician's four-node medical chain. the terms map:

| guardian (cyber) | mhedic (medical) |
|------------------|------------------|
| `exposure.expression` | `cause:exposure` |
| `exposure.mechanism` | `cause:mechanism` |
| `symptom.mechanism` | `effect:mechanism` |
| `symptom.expression` | `effect:symptom` |

we adopt the wish's `exposure/symptom` vocabulary (not mhedic's `cause/effect`) because it reads
truer for cyber: an *exposure* is the lever, a *symptom* is the sign.

## .the adversary caveat

unlike physiology, cyber harm has an **adversary** — an actor with intent and capability. the four
nodes still hold, but with two extensions:

- **adversary intent/capability** rides as an attribute on `exposure.mechanism` — *how* an exposure
  enables harm depends on who is present to exploit it
- attacks chain: a `case` may reference a **downstream `case`** to compose a multi-stage kill-chain
  (evil-twin → captive-portal-phish → account takeover), rather than one forced flat chain

## .why the split matters

- **exposure-side vs. symptom-side** cleanly separates the two things you can act on:
  - the `exposure.*` pair is *why it can happen* → what you change to **eliminate** the hazard
  - the `symptom.*` pair is *what goes wrong* → what you watch to **detect** it, and **respond** to
- **the layers map to the answer axes**:
  - `exposure.mechanism` → the **elimination** target (break the weakness that enables the attack)
  - `symptom.mechanism` → the compromise the elimination prevents
  - `symptom.expression` → the **detection** surface (the observable sign)

## .see also

- `howto.apply-causal-chain.[lesson].md` — the step-by-step over the frame
- `inventory.of=attack.vector/exposure=wifi.public/readme.md` — the first vector, traced through the frame
- `.agent/repo=.this/role=any/briefs/rule.require.bhrowser-citations.[rule].md` — every node claim must trace to a cited source
