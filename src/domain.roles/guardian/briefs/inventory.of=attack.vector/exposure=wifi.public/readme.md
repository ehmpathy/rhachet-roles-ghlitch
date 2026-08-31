# inventory.of=attack.vector · exposure=wifi.public

## .what

the public-wifi hazard map: every way a network you don't administer can harm your cyber health,
traced cause→effect through the four-node causal chain (`define.causal-chain.[lesson].md`) and split
into one **case** per distinct way in. this index makes no independent claim — every risk claim lives
in a case brief, each backed by **≥7 bhrowser-read sources**.

> ⚠️ **not professional security advice — informational only.** this is a reason-frame over public
> sources. its output is signal for a person or a qualified security professional, never a
> substitute for one.

> **recommendation disclaimer.** any guidance here is offered to the best of our knowledge from the
> info found in research — it carries **no guarantee of success or outcome**, and must be reviewed by
> a qualified security professional against your own real network, device, and threat model before
> reliance. it is groundwork for that review, not a substitute for it.

## .the two-minute answer

the whole vector at a glance — per case: how it lets harm in, how likely, the top move to shut it,
the top sign it fired. each row is a **pointer**; the full band / eliminate / detect / respond
substance, with citations, lives in that case's briefs (see the inventory map below).

| case | the weakness (exposure.mechanism) | likelihood band | eliminate (top move) | detect (top sign) |
|------|-----------------------------------|-----------------|----------------------|-------------------|
| `evil-twin` | ssids are unauthenticated — your device joins the strongest name it recognizes | common position; data theft uncommon on tls | route over cellular or a trusted vpn; never tap through a cert alert | an unexpected certificate alert; a wrong-domain portal |
| `captive-portal-phish` | the "sign in to wifi" page is user-trusted and forgeable | common | verify the portal is the venue's real domain over https; never enter an account password to "sign in" | a login page on a wrong or unfamiliar domain |
| `passive-sniff` | open links carry unencrypted frames any nearby radio can read | low residual in the tls era | keep sensitive traffic on https; a trusted vpn covers the rest | an absent https lock on a sensitive site |
| `deauth-dos` | management frames are unauthenticated — a forged deauth drops you | availability-only — mitigate, not eliminate | prefer networks with protected management frames (802.11w) | repeated, unexplained disconnects |

## .whats in this inventory

**four cases**, one per distinct way a public network exposes you. each case is a matched set of
three cited briefs that walk the causal chain:

- `inventory.of=exposure.mechanism.case=$sub` — **how** the network lets the harm in
- `inventory.of=symptom.mechanism.case=$sub` — **the compromise** itself (the pathophysiology)
- `inventory.of=symptom.expression.case=$sub` — **the signs**, so you can detect + respond

plus two shared nodes the cases point to, not repeat:

- `inventory.of=symptom.expression.convergent=account-takeover` — the endpoint `evil-twin`,
  `captive-portal-phish`, and `passive-sniff` all converge on (a stolen credential, found later via
  an account alert). deduped here once, with its own ≥7 citations.
- `inventory.of=sources.case=trust` — the trust-tier source allowlist + read-dates every case draws from.

one exposure fans out to many compromises, and a shared compromise (account takeover) is reached by
several cases — so the **diagnosis is the path, not the endpoint**, and a shared endpoint lives once
as a convergent node. a fifth case earns its place only when it names a **distinct** exposure.mechanism.

## .the vector

`wifi.public` = **any wireless network you don't administer** — airport, cafe, hotel, conference —
open or shared-key. the shared trait: you can't vouch for who runs the access point, who else is on
the link, or what sits between you and the internet. open exposes the link layer; a shared-key
(wpa2-psk) network still lets any other password-holder observe or intrude (noted per case).

## .the honest calibration

ranked by **real residual risk**, not folklore. in the https-everywhere / hsts era, tls closes most
passive-read attacks at the transport layer. what still bites routes *around* tls — a forged portal
you type into, a cert alert you tap through, a plaintext app that never used tls. so the much-feared
sniff is largely closed; the forgeable portal is the top real risk. each case carries this with citations.

## .the likelihood band

each case states an ordinal **band** (e.g. *common*, *low residual*) — a calibrated judgment from the
cited sources, never a measured rate. we use a `band:` prose label, not a bare `pNN` code: a `pNN`
would imply a precision the sources don't support, against the honest-under-quantification aim.

## .scope + depth

covers the **link + access** layer — hazards that follow once you join a network you don't control.
out of scope: hazards on any network (a weak or re-used password = device/account hygiene) and an
already-compromised device (a different vector). the cases are complete at the **protocol-mechanism**
layer; **cve-class ground-truth** (krack cve-2017-13077, wpa3 sae, hsts-preload, portal-detection
urls) is a documented follow-on bhrowser pass, not silently absent.

## .see also

- `define.causal-chain.[lesson].md` — the four-node frame these cases trace
- `howto.apply-causal-chain.[lesson].md` — the step-by-step that produces each case
- `inventory.of=symptom.expression.convergent=account-takeover.md` — the shared endpoint node
- `inventory.of=sources.case=trust.md` — the trust-tier source allowlist
- `rule.require.bhrowser-citations.[rule].md` · `rule.require.seven-distinct-citations.[rule].md` — the citation instrument + the ≥7-source bar
- `motto.not-security-advice.[motto].md` — the disclaimer discipline
