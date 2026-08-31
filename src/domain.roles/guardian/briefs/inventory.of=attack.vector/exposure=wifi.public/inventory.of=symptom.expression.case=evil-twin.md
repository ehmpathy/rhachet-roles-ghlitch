# inventory.of=symptom.expression · case=evil-twin

## .what

the **symptom.expression** node for `case=evil-twin` — the *observable signs* that the compromise has
fired: the detection surface a person (or a professional) can actually watch. this is the node that
answers "how would i know?" and carries the **detect** and **respond** guidance.

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

## .the signs (the detection surface)

### 1. an unexpected certificate alert — the strongest live sign

the single most decisive sign is the browser's invalid-certificate error. it is the moment the rogue
ap's attempt to intercept a tls session becomes visible, because the attacker cannot present a valid
certificate for the real domain. MDN's airport scenario states exactly this:

> "The attacker intercepts the request with a fake HTTPS server, but does not have a valid certificate
> for the domain." ... "The browser displays an invalid certificate error, and does not allow the user
> to bypass it, thus preventing them from giving their password to the attacker." — MDN,
> *Strict-Transport-Security* [S6]

**read this sign as: stop.** a cert alert on a site you know should be valid, over untrusted wifi, is
the visible edge of a mitm attempt — never tap through it (that tap-through is the very act that
converts a blocked attack into a successful one; see symptom.mechanism).

### 2. a "connection is encrypted" check that fails

the inverse sign is the *absence* of the lock. the FTC gives the person a positive check to run:

> "How do you know your connection is encrypted? Look for a lock symbol or https in the address bar to
> the left of the website address. This works on a mobile browser, too. It can be hard to tell if a
> mobile app uses encryption, but the majority do." — FTC, *Are Public Wi-Fi Networks Safe?* [S8]

a sensitive site that is *not* on https on an untrusted network is the plaintext-capture path made
visible — Wikipedia states the loss when it is not: "When users log into unsecured (non-HTTPS) bank or
e-mail accounts, the attacker intercepts the transaction, since it is sent through their equipment." [S5]

### 3. a captive-portal / login page on a wrong or unfamiliar domain

a fake sign-in page is a sign in itself — the request for credentials where none should be asked. MITRE:

> "Upon logging into the malicious Wi-Fi access point, a user may be directed to a fake login page or
> captive portal webpage to capture the victim's credentials." — MITRE ATT&CK T1557.004 [S3]

Kaspersky names the forged portal as the harvest surface:

> "Evil twin hackers set up a copy of this page, hoping to trick unsuspecting victims into disclosing
> their login credentials." — Kaspersky, *Evil Twin Attacks* [S7]

**read this sign as: verify the domain.** a legitimate captive portal is the venue's own domain over
https; a request for an email/bank password to "sign in to wifi" is never legitimate.

### 4. the delayed sign — an account alert after the fact → convergent node

the evil-twin compromise is often silent in the moment and only visible later, as an account anomaly:
a login-from-unknown-location alert, an unrequested password reset, or an unrecognized transaction
*after* a public-wifi session. this retrospective tail is **shared** with every credential-theft case
on this vector, so it lives once, in the convergent node — see
`inventory.of=symptom.expression.convergent=account-takeover.md` for the full sign, its detect/respond
guidance, and its citations. what is evil-twin-specific are the *live* signs above (#1–#3, #5–#6); the
account-takeover tail is the path's shared endpoint, not a sign unique to this case.

### 5. the professional's sign — wips anomaly

for an operator (not the individual), a wireless intrusion prevention system surfaces the ap itself:

> "Wireless intrusion prevention systems (WIPS) can identify traffic patterns indicative of
> adversary-in-the-middle activity and scan for evils twins and rogue access points." — MITRE ATT&CK
> T1557.004 (M1031) [S3]

### 6. the impersonation sign — you reach "the wrong agent"

Cloudflare frames the general observable of on-path attacks — the party you talk to may be the
attacker in place of the real one, which surfaces as odd redirects, wrong content, or a session that
behaves unlike the real service:

> "The attackers can then collect information as well as impersonate either of the two agents." —
> Cloudflare, *On-path attacker* [S4]

## .the answer axes

- **detect** — the live signs above, in priority order: (1) a cert alert = stop; (2) an absent https
  lock on a sensitive site; (3) a wrong-domain captive/login portal; (5) wips anomaly (operator);
  (6) impersonation-shaped oddities. the (4) retrospective account/login alert is the shared tail —
  see `convergent=account-takeover.md`.
- **respond** — on any live sign: disconnect from the network, do not tap through cert alerts, and stop
  sensitive activity. on a retrospective sign (sign 4): from a **trusted** device (cellular or a known
  network), change the affected password, enable/verify two-factor, and review recent account activity.
  CISA's baseline elimination — confirm the network name before you join — stops the case before it
  reaches this node at all [S1].
- **eliminate** — detection is the backstop, not the fix; the elimination (vpn/cellular, no cert
  tap-through) lives in the exposure/symptom-mechanism briefs.

## .likelihood

**band: the cert-alert sign is reliable-when-present but rare (it only fires along the tls-intercept
path most attackers avoid); the retrospective account-alert sign is the more common real-world tell.**
this asymmetry matters: absence of a live sign is *not* proof of safety, because the residual paths
(plaintext, forged portal, tap-through) can leave no in-the-moment trace. ordinal judgment from the
cited sources, not a measured rate.

## .the many-to-many note

the retrospective account-alert sign (#4) is shared with `case=captive-portal-phish`,
`case=passive-sniff`, and any other case that ends in credential theft — one endpoint, several upstream
cases — so it is deduped into `inventory.of=symptom.expression.convergent=account-takeover.md` rather
than restated here. the diagnosis is the **path** that produced the sign, not the sign alone.

## .sources

read verbatim via the **bhrowser** (HEADFUL, session `<your-own-session>`), 2026-08-21. WebSearch/WebFetch
were used only to discover candidate URLs, never as citations (`rule.require.bhrowser-citations`).

- [S1] CISA · Securing Wireless Networks — https://www.cisa.gov/news-events/news/securing-wireless-networks
- [S3] MITRE ATT&CK · T1557.004 Adversary-in-the-Middle: Evil Twin — https://attack.mitre.org/techniques/T1557/004/
- [S4] Cloudflare · What is an on-path attacker? — https://www.cloudflare.com/learning/security/threats/on-path-attack/
- [S5] Wikipedia · Evil twin (wireless networks) — https://en.wikipedia.org/wiki/Evil_twin_(wireless_networks)
- [S6] MDN (Mozilla) · Strict-Transport-Security (HSTS) — https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Strict-Transport-Security
- [S7] Kaspersky · What is an Evil Twin Attack? — https://usa.kaspersky.com/resource-center/preemptive-safety/evil-twin-attacks
- [S8] FTC · Are Public Wi-Fi Networks Safe? — https://consumer.ftc.gov/articles/are-public-wi-fi-networks-safe-what-you-need-know

(7 distinct bhrowser-read sources; `rule.require.seven-distinct-citations` satisfied.)

## .see also

- `inventory.of=exposure.mechanism.case=evil-twin.md` — how the position is reached
- `inventory.of=symptom.mechanism.case=evil-twin.md` — the compromise + honest calibration
- `define.causal-chain.[lesson].md` — the four-node frame (why expression ≠ mechanism)
- `readme.md` — the vector overview + case index
