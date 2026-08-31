# inventory.of=symptom.expression · convergent=account-takeover

## .what

the **convergent symptom.expression node** for the shared endpoint every credential-theft case on
this vector arrives at: **account takeover** — the retrospective surface a person sees *after* a
credential was captured, whatever upstream case captured it. this node is not a `case=` of its own;
it is the **shared tail** that `case=evil-twin`, `case=captive-portal-phish`, and `case=passive-sniff`
each converge on. rather than restate the same account-alert sign + detect/respond in three briefs,
they each point here (`rule.forbid.friction-hazards`, decompose-for-recompose: one node, many cases).

> ⚠️ **not professional security advice — informational only.** a reason-frame over public sources;
> its output is signal for a person or a qualified security professional, never a substitute for one.

> **recommendation disclaimer.** the guidance below is offered to the best of our knowledge from the
> info found in research — it carries **no guarantee of success or outcome**, and must be reviewed by
> a qualified security professional against your own real network, device, and threat model before
> reliance. it is groundwork for that review, not a substitute for it.

> 🚨 **escalation — act now if this is live.** if you believe you are under active attack or your
> accounts are compromised, disconnect, change passwords from a trusted device, and contact your
> security team or provider now. this node is the "how would i know?" surface, so it carries the
> carve-out directly (`motto.not-security-advice`): a live sign below is a reason to act, not only to
> read.

## .why a convergent node

the four-node causal frame is **many-to-many**: one exposure fans out to many mechanisms, and the
same endpoint is reached by several cases. account takeover is the clearest such endpoint — an
evil-twin mitm, a forged captive portal, and a plaintext passive sniff all end the same way: a
credential moves, and the person finds out later through an account anomaly. that tail is **identical
across those cases** — same signs, same response, same citations — so it lives once, here. the
*diagnosis* remains the **path** that produced the takeover (which upstream case), not the takeover
alone; each case brief keeps its own distinctive live signs and links here only for the shared tail.

## .the signs (the retrospective detection surface)

### 1. an account alert after a public-wifi session

the sign that marks this endpoint is an account anomaly that surfaces *after* the session — the
compromise is usually silent in the moment. Kaspersky states the delay directly:

> "The victim only becomes aware of this later when they realize unauthorized transactions have taken
> place in their account, causing them financial loss." — Kaspersky, *Evil Twin Attacks* [S7]

so a login-from-unknown-location alert, an unrequested password reset, or an unrecognized charge
after a public-wifi session is the retrospective sign this node exists to name.

### 2. the data that tends to move

CISA names the categories that surface this way, so a person knows what to watch:

> "This data may include credit card numbers, username and password combinations, and other personal
> information." — CISA, *Securing Wireless Networks* [S1]

### 3. lateral spread — one loss becomes many

a captured credential is rarely contained to the account it unlocked. Wikipedia names the spread:

> "The attacker is also able to connect to other networks associated with the users' credentials." —
> Wikipedia, *Evil twin (wireless networks)* [S5]

so a takeover of one account is a reason to check every account that shared the credential — the
reused-password cascade is part of this endpoint's blast radius.

### 4. the mechanism behind the theft — plaintext capture

for the passive-sniff and unsecured-login path, the credential moves because the transaction was in
the clear. Wikipedia names it:

> "When users log into unsecured (non-HTTPS) bank or e-mail accounts, the attacker intercepts the
> transaction, since it is sent through their equipment." — Wikipedia, *Evil twin (wireless networks)* [S5]

### 5. the impersonation surface — you talked to the attacker

Cloudflare frames the general observable that yields the credential in the first place — the party
you transacted with may have been the attacker:

> "The attackers can then collect information as well as impersonate either of the two agents." —
> Cloudflare, *On-path attacker* [S4]

### 6. the harvest surface — a forged login page

for the portal-phish path, the credential is *typed into* the attacker's page. MITRE names the
capture surface:

> "Upon logging into the malicious Wi-Fi access point, a user may be directed to a fake login page or
> captive portal webpage to capture the victim's credentials." — MITRE ATT&CK T1557.004 [S3]

### 7. the calibration — why this endpoint is the narrow residual

account takeover is the endpoint that survives *despite* modern transport encryption, so it is the risk
worth attention precisely because most others are closed. the FTC states the baseline:

> "Today, most websites do use encryption to protect your information. Because of the widespread use of
> encryption, connecting through a public Wi-Fi network is usually safe." — FTC, *Are Public Wi-Fi
> Networks Safe?* [S8]

so a captured credential now comes from the *residual* paths (a forged portal, a plaintext app, a
cert-alert tap-through), not from a routine sniff — which is why the retrospective account signal, not
an in-the-moment read alarm, is the tell that matters.

## .the answer axes

- **detect** — this endpoint has **no reliable live sign**; it surfaces retrospectively. watch for:
  (1) an account alert (unknown-location login, unrequested reset, unrecognized charge) after a
  public-wifi session; (2) the data categories CISA names in motion; (3) lateral activity on accounts
  that shared a password. absence of a live sign is **not** proof of safety — the capture is silent.
  detection is therefore an *ongoing* posture, not a single moment — NIST frames it as a lifecycle
  activity: "The security of each WLAN is heavily dependent on how well each WLAN component ... is
  secured throughout the WLAN lifecycle, from initial WLAN design and deployment through ongoing
  maintenance and monitoring." [S2]
- **respond** — from a **trusted** device (cellular or a known network, never the suspect one):
  rotate the affected credential and anywhere it was reused, enable/verify two-factor, and review
  recent account activity. treat a login-from-unknown-location or unrequested-reset alert as live and
  act now (see the escalation carve-out above).
- **eliminate** — detection is the backstop, not the fix; the eliminations that stop the credential
  from capture at all (vpn/cellular, no cert tap-through, verify the portal domain, never type an
  account password into a wifi portal) live in each convergent case's exposure/symptom-mechanism
  briefs. the cross-case defense that limits blast radius: a unique password + two-factor per
  account, so one capture does not cascade (sign #3).

## .likelihood

**band: the retrospective account alert is the common real-world tell for this endpoint — more
reliable than any in-the-moment sign, because the capture itself is typically silent.** the honest
message: you rarely catch account takeover as it happens; you catch it after, through the account,
and you limit its blast radius in advance with unique credentials + two-factor. ordinal judgment from
the cited sources, not a measured rate.

## .the convergent cases

the cases that arrive at this endpoint — each keeps its own distinctive live signs, and links here
for this shared tail:

- `case=evil-twin` — mitm position; its live signs (cert alert, wips anomaly, impersonation) are its
  own; the delayed account alert converges here.
- `case=captive-portal-phish` — forged-portal harvest; its live signs (wrong-domain portal, wrong-
  secret request) are its own; the after-the-fact account alert converges here.
- `case=passive-sniff` — silent plaintext capture; it has almost no live sign, so this retrospective
  tail is nearly its whole detection surface.

`case=deauth-dos` does **not** converge here: a deauth is a connectivity event, not a credential
theft, so an account alert after a deauth points to a *paired* case (evil-twin re-join, cracked
passphrase), not to the deauth itself.

## .sources

read verbatim via the **bhrowser** (HEADFUL, session `<your-own-session>`), 2026-08-21. WebSearch/WebFetch
were used only to discover candidate URLs, never as citations (`rule.require.bhrowser-citations`).

- [S1] CISA · Securing Wireless Networks — https://www.cisa.gov/news-events/news/securing-wireless-networks
- [S2] NIST · SP 800-153 Guidelines for Securing WLANs — https://csrc.nist.gov/pubs/sp/800/153/final
- [S3] MITRE ATT&CK · T1557.004 Adversary-in-the-Middle: Evil Twin — https://attack.mitre.org/techniques/T1557/004/
- [S4] Cloudflare · What is an on-path attacker? — https://www.cloudflare.com/learning/security/threats/on-path-attack/
- [S5] Wikipedia · Evil twin (wireless networks) — https://en.wikipedia.org/wiki/Evil_twin_(wireless_networks)
- [S7] Kaspersky · What is an Evil Twin Attack? — https://usa.kaspersky.com/resource-center/preemptive-safety/evil-twin-attacks
- [S8] FTC · Are Public Wi-Fi Networks Safe? — https://consumer.ftc.gov/articles/are-public-wi-fi-networks-safe-what-you-need-know

(7 distinct bhrowser-read sources; `rule.require.seven-distinct-citations` satisfied.)

## .see also

- `inventory.of=symptom.expression.case=evil-twin.md` — the mitm case that converges here
- `inventory.of=symptom.expression.case=captive-portal-phish.md` — the phish case that converges here
- `inventory.of=symptom.expression.case=passive-sniff.md` — the silent-capture case that converges here
- `define.causal-chain.[lesson].md` — the many-to-many frame (why one endpoint, several paths)
- `readme.md` — the vector overview + case index
