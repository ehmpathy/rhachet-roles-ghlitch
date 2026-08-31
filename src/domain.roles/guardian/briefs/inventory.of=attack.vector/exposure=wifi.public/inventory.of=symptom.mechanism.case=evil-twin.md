# inventory.of=symptom.mechanism · case=evil-twin

## .what

the **symptom.mechanism** node for `case=evil-twin` — the compromise that follows once a device has
associated to the rogue ap: the attacker holds a **man-in-the-middle (mitm)** position over the
victim's traffic. this brief states the compromise, *why the elimination prevents it*, and — critically
— the **honest calibration** of what that mitm position can and cannot reach in the https era.

> ⚠️ **not professional security advice — informational only.** a reason-frame over public sources;
> its output is signal for a person or a qualified security professional, never a substitute for one.

> **recommendation disclaimer.** the guidance below is offered to the best of our knowledge from the
> info found in research — it carries **no guarantee of success or outcome**, and must be reviewed by
> a qualified security professional against your own real network, device, and threat model before
> reliance. it is groundwork for that review, not a substitute for it.

## .the compromise (the state)

once the victim's device routes through the attacker's ap, the attacker becomes the person's gateway —
a classic on-path / man-in-the-middle position:

> "On-path attackers place themselves between two devices (often a web browser and a web server) and
> intercept or modify communications between the two. The attackers can then collect information as
> well as impersonate either of the two agents. In addition to websites, these attacks can target
> email communications, DNS lookups, and public WiFi networks." — Cloudflare, *On-path attacker* [S4]

Wikipedia names it as the same class and its purpose:

> "This type of attack, a kind of man-in-the-middle attack, may be used to steal the passwords of
> unsuspecting users, either by monitoring their connections or by phishing, which involves setting up
> a fraudulent web site and luring people there." — Wikipedia, *Evil twin (wireless networks)* [S5]

from that position, MITRE catalogs what the attacker can then do — read, alter, and harvest:

> "Once a user is logged into the fraudulent Wi-Fi network, the adversary may able to monitor network
> activity, manipulate data, or steal additional credentials." — MITRE ATT&CK T1557.004 [S3]

CISA states the concrete data at stake when the traffic is reachable:

> "Because the victim is connecting to the internet through the attacker's system, it's easy for the
> attacker to use specialized tools to read any data the victim sends over the internet. This data may
> include credit card numbers, username and password combinations, and other personal information." —
> CISA, *Securing Wireless Networks* [S1]

## .the honest calibration — what the mitm position actually reaches

this is the node where folklore and fact diverge, so it must be stated with care. the mitm position is
real, but **transport-layer encryption (tls/https) neutralizes most of what it could once reach.** the
FTC states the shift directly:

> "In the past, if you used a public Wi-Fi network to get online, your information was at risk. That's
> because most websites didn't use encryption to scramble the data and protect it from hackers snooping
> on the network." ... "Today, most websites do use encryption to protect your information. Because of
> the widespread use of encryption, connecting through a public Wi-Fi network is usually safe." —
> FTC, *Are Public Wi-Fi Networks Safe?* [S8]

the attacker's attempt to intercept an https session fails at the certificate check, and hsts closes
the downgrade path. MDN's canonical airport scenario shows the mechanism halt before it completes:

> "The attacker intercepts the request with a fake HTTPS server, but does not have a valid certificate
> for the domain." ... "The browser displays an invalid certificate error, and does not allow the user
> to bypass it, thus preventing them from giving their password to the attacker." — MDN,
> *Strict-Transport-Security* [S6]

so the mitm position **remains dangerous only along the paths that route around tls**:

1. **plaintext / non-https traffic** — a site or app that never used tls is read in the clear. Wikipedia:
   "When users log into unsecured (non-HTTPS) bank or e-mail accounts, the attacker intercepts the
   transaction, since it is sent through their equipment." [S5]
2. **captive-portal phish** — a forged "sign in to wifi" page the person types into (its own case,
   `case=captive-portal-phish`); the attacker never needs to break tls because the person hands over the
   credential. MITRE: "a user may be directed to a fake login page or captive portal webpage to capture
   the victim's credentials." [S3]
3. **cert-alert tap-through** — if the person clicks past the invalid-certificate error that [S6] shows
   the browser raise, the tls protection they were handed is discarded by hand.

## .why the elimination prevents it

the elimination from the exposure.mechanism brief — a trusted vpn, or a route over cellular — works
*because it denies the mitm position anything to read*. Kaspersky states the mechanism of the fix:

> "A VPN or Virtual Private Network protects you from evil twin attacks by encrypting your data on the
> internet no matter the network you are using. ... encrypts or scrambles your online activity before
> sending it to the network, making it impossible for a hacker to read or understand." — Kaspersky [S7]

NIST frames the same at the design layer: the compromise is a failure of a wlan component (the client's
link), and the defense is to secure that link end-to-end rather than trust the local network:

> "The security of each WLAN is heavily dependent on how well each WLAN component—including client
> devices, access points (AP), and wireless switches—is secured throughout the WLAN lifecycle." —
> NIST SP 800-153 [S2]

## .the answer axes

- **eliminate** — a trusted vpn (or cellular) collapses the compromise: the mitm sees ciphertext only
  ([S7], [S4]). tls + hsts already close the passive-read and downgrade paths for well-configured sites
  ([S6], [S8]). what remains is behavioral: never tap through a cert alert, never type into an
  unverified portal.
- **detect** — the observable signals are in `inventory.of=symptom.expression.case=evil-twin.md` (a cert
  alert, a wrong-domain portal, a later account alert).
- **respond** — disconnect; if a credential may have crossed a plaintext path or a forged portal, rotate
  it from a trusted device and check for a login-from-unknown-location.

## .likelihood

**band: the position is common; a *data-theft* outcome is uncommon-for-tls-traffic, and remains
plausible only along the three residual paths above.** this split is the whole point of the node — the
mitm state is easy to reach, but modern transport encryption means that to reach the state is no longer
the same as to reach the data. ordinal judgment from the cited sources, not a measured rate.

## .the many-to-many note

the same symptom.mechanism here (credential theft → account takeover) is *also* reached by
`case=captive-portal-phish` without any evil-twin ap at all — so account takeover is a shared endpoint,
and the diagnosis is the **path**, not the endpoint. referenced across cases, not duplicated.

## .sources

read verbatim via the **bhrowser** (HEADFUL, session `<your-own-session>`), 2026-08-21. WebSearch/WebFetch
were used only to discover candidate URLs, never as citations (`rule.require.bhrowser-citations`).

- [S1] CISA · Securing Wireless Networks — https://www.cisa.gov/news-events/news/securing-wireless-networks
- [S2] NIST · SP 800-153 Guidelines for Securing WLANs — https://csrc.nist.gov/pubs/sp/800/153/final
- [S3] MITRE ATT&CK · T1557.004 Adversary-in-the-Middle: Evil Twin — https://attack.mitre.org/techniques/T1557/004/
- [S4] Cloudflare · What is an on-path attacker? — https://www.cloudflare.com/learning/security/threats/on-path-attack/
- [S5] Wikipedia · Evil twin (wireless networks) — https://en.wikipedia.org/wiki/Evil_twin_(wireless_networks)
- [S6] MDN (Mozilla) · Strict-Transport-Security (HSTS) — https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Strict-Transport-Security
- [S7] Kaspersky · What is an Evil Twin Attack? — https://usa.kaspersky.com/resource-center/preemptive-safety/evil-twin-attacks
- [S8] FTC · Are Public Wi-Fi Networks Safe? — https://consumer.ftc.gov/articles/are-public-wi-fi-networks-safe-what-you-need-know

(8 distinct bhrowser-read sources; `rule.require.seven-distinct-citations` satisfied.)

## .see also

- `inventory.of=exposure.mechanism.case=evil-twin.md` — how the position is reached
- `inventory.of=symptom.expression.case=evil-twin.md` — the observable signs
- `define.causal-chain.[lesson].md` — the four-node frame (why mechanism ≠ expression)
- `readme.md` — the vector overview + case index
