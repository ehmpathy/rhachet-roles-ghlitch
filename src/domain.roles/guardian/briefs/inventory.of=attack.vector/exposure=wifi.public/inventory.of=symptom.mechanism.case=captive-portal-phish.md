# inventory.of=symptom.mechanism · case=captive-portal-phish

## .what

the **symptom.mechanism** node for `case=captive-portal-phish` — the compromise that follows once a
person has typed a credential into a forged portal: **credential theft that ends in account takeover**.
this brief states the compromise, why the elimination prevents it, and why this path is the residual
danger tls does *not* close.

> ⚠️ **not professional security advice — informational only.** a reason-frame over public sources;
> its output is signal for a person or a qualified security professional, never a substitute for one.

> **recommendation disclaimer.** the guidance below is offered to the best of our knowledge from the
> info found in research — it carries **no guarantee of success or outcome**, and must be reviewed by
> a qualified security professional against your own real network, device, and threat model before
> reliance. it is groundwork for that review, not a substitute for it.

## .the compromise (the state)

the moment the person submits credentials to the attacker's page, the attacker holds them. Kaspersky
states the state and its immediate consequence:

> "Evil twin hackers set up a copy of this page, hoping to trick unsuspecting victims into disclosing
> their login credentials. Once the hackers have those, they can log in to the network and control
> it." — Kaspersky, *Evil Twin Attacks* [S7]

MITRE frames the harvested credential as the pivot to further compromise:

> "Once a user is logged into the fraudulent Wi-Fi network, the adversary may able to monitor network
> activity, manipulate data, or steal additional credentials." — MITRE ATT&CK T1557.004 [S3]

the stolen credential is rarely single-use: it commonly unlocks *other* accounts, because people reuse
passwords. Wikipedia notes the lateral reach directly:

> "The attacker is also able to connect to other networks associated with the users' credentials." —
> Wikipedia, *Evil twin (wireless networks)* [S5]

CISA names the specific data classes at stake — the same set whether stolen by capture or by phish:

> "This data may include credit card numbers, username and password combinations, and other personal
> information." — CISA, *Securing Wireless Networks* [S1]

## .why this path is the residual danger

this is the node that makes the honest calibration matter. tls/https closes the *passive-read* paths
of public wifi, but the phish routes **around** tls entirely — the person voluntarily submits the
secret, so no cipher is defeated. the FTC states the trap precisely: encryption on the malicious page
is no protection at all.

> "They also create fake websites and encrypt them to make you think they're safe when they're not. If
> you visit a scammer's website, your data may be encrypted on its way to the site, but it won't be
> safe from scammers operating the site." — FTC, *Are Public Wi-Fi Networks Safe?* [S8]

so the presence of the https lock — the very sign that tells a person a passive-sniff is defeated — is
*not* a defense here, because the encrypted channel terminates at the attacker. this is why
captive-portal-phish sits near the top of the residual-risk order while passive-sniff sits near the
bottom.

## .why the elimination prevents it

the elimination is behavioral, and it works because it denies the attacker the one input they need —
the person's own action. CISA's countermeasure stops the delivery (the person never joins the rogue ap
that serves the portal):

> "Always confirm the name and password of a public Wi-Fi hotspot prior to use. This will ensure you
> are connecting to a trusted access point." — CISA, *Securing Wireless Networks* [S1]

and MDN's hsts is the structural backstop for the sub-case where the forged page impersonates a *known*
domain — the browser refuses to submit to a certificate it cannot validate:

> "The browser displays an invalid certificate error, and does not allow the user to bypass it, thus
> preventing them from giving their password to the attacker." — MDN, *Strict-Transport-Security* [S6]

Wikipedia frames the whole class as mitm whose phish variant is defeated by distrust of the fraudulent
site:

> "This type of attack, a kind of man-in-the-middle attack, may be used to steal the passwords of
> unsuspecting users ... by phishing, which involves setting up a fraudulent web site and luring people
> there." — Wikipedia, *Evil twin (wireless networks)* [S5]

## .the answer axes

- **eliminate** — do not enter credentials into an unverified portal; verify the venue domain over
  https; never supply an email/bank password to a "wifi login" ([S1], [S8]). hsts blocks the
  known-domain variant [S6]. because the person is the vector, the durable defense is also account-level:
  a **unique password per site** (so one stolen credential does not cascade — the lateral reach [S5]
  describes) and **two-factor authentication** (so a stolen password alone is insufficient).
- **detect** — the observable signs are in `inventory.of=symptom.expression.case=captive-portal-phish.md`.
- **respond** — if a credential was submitted: from a **trusted** device, rotate it at once, rotate it
  anywhere it was reused, enable/verify two-factor, and watch for a login-from-unknown-location.

## .likelihood

**band: this is the top-ranked residual path for public wifi.** the compromise is uncommon in absolute
terms but, *conditional on an attack*, it is the most likely one to succeed in the https era —
precisely because it does not depend on a break of encryption ([S8]). ordinal judgment from the cited
sources, not a measured rate.

## .the many-to-many note

the endpoint here — credential theft → account takeover — is the **same** symptom.mechanism reached by
`case=evil-twin` via traffic interception. one compromise, two upstream cases: the diagnosis is the
**path**, and the phish path is the one tls does not close.

## .sources

read verbatim via the **bhrowser** (HEADFUL, session `<your-own-session>`), 2026-08-21. WebSearch/WebFetch
were used only to discover candidate URLs, never as citations (`rule.require.bhrowser-citations`).

- [S1] CISA · Securing Wireless Networks — https://www.cisa.gov/news-events/news/securing-wireless-networks
- [S3] MITRE ATT&CK · T1557.004 Adversary-in-the-Middle: Evil Twin — https://attack.mitre.org/techniques/T1557/004/
- [S5] Wikipedia · Evil twin (wireless networks) — https://en.wikipedia.org/wiki/Evil_twin_(wireless_networks)
- [S6] MDN (Mozilla) · Strict-Transport-Security (HSTS) — https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Strict-Transport-Security
- [S7] Kaspersky · What is an Evil Twin Attack? — https://usa.kaspersky.com/resource-center/preemptive-safety/evil-twin-attacks
- [S8] FTC · Are Public Wi-Fi Networks Safe? — https://consumer.ftc.gov/articles/are-public-wi-fi-networks-safe-what-you-need-know
- [S12] Wikipedia · Captive portal — https://en.wikipedia.org/wiki/Captive_portal

(7 distinct bhrowser-read sources; `rule.require.seven-distinct-citations` satisfied.)

## .see also

- `inventory.of=exposure.mechanism.case=captive-portal-phish.md` — how the credential is elicited
- `inventory.of=symptom.expression.case=captive-portal-phish.md` — the observable signs
- `inventory.of=symptom.mechanism.case=evil-twin.md` — the kin path to the same endpoint
- `define.causal-chain.[lesson].md` — the four-node frame
- `readme.md` — the vector overview + case index
