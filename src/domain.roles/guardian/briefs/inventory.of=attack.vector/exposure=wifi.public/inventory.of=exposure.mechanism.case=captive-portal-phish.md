# inventory.of=exposure.mechanism · case=captive-portal-phish

## .what

the **exposure.mechanism** node for `case=captive-portal-phish` — *how* a forged "sign in to wifi"
page turns a person's join of public wifi into a credential theft. the weakness here is not a protocol
flaw but a **trusted user-interface pattern** the attacker clones.

> ⚠️ **not professional security advice — informational only.** a reason-frame over public sources;
> its output is signal for a person or a qualified security professional, never a substitute for one.

> **recommendation disclaimer.** the guidance below is offered to the best of our knowledge from the
> info found in research — it carries **no guarantee of success or outcome**, and must be reviewed by
> a qualified security professional against your own real network, device, and threat model before
> reliance. it is groundwork for that review, not a substitute for it.

## .the mechanism

the weakness is that the **captive portal is an expected, user-trusted sign-in step** — and the person
is conditioned to type into it. Wikipedia defines the legitimate pattern the attacker exploits:

> "A captive portal is a web page accessed with a web browser that is displayed to newly connected
> users of a Wi-Fi or wired network before they are granted broader access to network resources.
> Captive portals are commonly used to present a landing or log-in page which may require
> authentication, payment, acceptance of an end-user license agreement/acceptable use policy, or
> survey completion." — Wikipedia, *Captive portal* [S12]

because the person *expects* a login page on public wifi, a cloned one raises no alarm. MITRE catalogs
the forged-portal step as the credential-capture surface of an evil-twin ap:

> "Upon logging into the malicious Wi-Fi access point, a user may be directed to a fake login page or
> captive portal webpage to capture the victim's credentials." — MITRE ATT&CK T1557.004 [S3]

Kaspersky names the step directly — the attacker copies the generic login page and waits:

> "Before you can sign in to many public Wi-Fi accounts, you must submit data on a generic login page.
> Evil twin hackers set up a copy of this page, hoping to trick unsuspecting victims into disclosing
> their login credentials. Once the hackers have those, they can log in to the network and control
> it." — Kaspersky, *Evil Twin Attacks* [S7]

the phish path is a distinct route to compromise that does **not** need to break any encryption — the
person hands over the credential by hand. Wikipedia frames the phish as the alternative to
traffic-monitoring:

> "This type of attack ... may be used to steal the passwords of unsuspecting users, either by
> monitoring their connections or by phishing, which involves setting up a fraudulent web site and
> luring people there." — Wikipedia, *Evil twin (wireless networks)* [S5]

the delivery vehicle is usually the same unauthenticated-ssid weakness that seeds the evil-twin case —
a rogue ap the person joins because its name looks right. CISA's baseline countermeasure targets
exactly this join:

> "Always confirm the name and password of a public Wi-Fi hotspot prior to use. This will ensure you
> are connecting to a trusted access point." — CISA, *Securing Wireless Networks* [S1]

crucially, the FTC notes that **encryption on the portal does not make it safe** — a phishing portal
can serve https and still be hostile, because the hazard is *who runs the page*, not whether the link
is encrypted:

> "They also create fake websites and encrypt them to make you think they're safe when they're not. If
> you visit a scammer's website, your data may be encrypted on its way to the site, but it won't be
> safe from scammers operating the site." — FTC, *Are Public Wi-Fi Networks Safe?* [S8]

MDN's hsts mechanism is the one structural defense that *can* interrupt a portal-shaped intercept of a
real domain — a forged page for a known hsts host raises a cert error the browser will not let the
person bypass:

> "The attacker intercepts the request with a fake HTTPS server, but does not have a valid certificate
> for the domain." ... "The browser displays an invalid certificate error, and does not allow the user
> to bypass it." — MDN, *Strict-Transport-Security* [S6]

## .the answer axes

- **eliminate** — the mechanism is stopped when the person does not enter a credential into an
  unverified page. **verify the portal is the venue's own domain over https** before you type; a
  legitimate wifi portal never asks for your *email or bank* password ([S1], [S8]). where a real
  known-domain login is intercepted, hsts blocks the forgery with a cert error [S6]. **verdict:** the
  forged-portal *presentation* cannot be eliminated at the person's layer (an attacker can always show
  a page) — so this node is **mitigated by verification behavior**, not eliminated; the fix is to deny
  the credential, not to prevent the page.
- **detect** — the observable signs live in the symptom.expression brief (a wrong/unfamiliar portal
  domain, an absent https lock, a request for a password that a wifi login should never need).
- **respond** — if you typed a credential into a suspect portal, treat it as compromised: rotate it
  from a trusted device and enable/verify two-factor (see symptom.mechanism / symptom.expression).

## .likelihood

**band: common, and higher in relative importance over time.** as tls closes the passive-read paths
([S8]), the forged portal is one of the *residual* routes that route around encryption entirely — the
person is the vector, not the cipher. ordinal judgment from the cited sources, not a measured rate.

## .the many-to-many note

this exposure.mechanism (a forged trusted page) shares its endpoint — credential theft → account
takeover — with `case=evil-twin`. the same rogue ap often *hosts* both the mitm position and the fake
portal ([S3], [S7]), so the two cases compose into a kill-chain rather than sit apart; referenced,
not duplicated.

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

- `inventory.of=symptom.mechanism.case=captive-portal-phish.md` — the compromise this enables
- `inventory.of=symptom.expression.case=captive-portal-phish.md` — the observable signs
- `inventory.of=exposure.mechanism.case=evil-twin.md` — the kin case that often hosts this portal
- `define.causal-chain.[lesson].md` — the four-node frame
- `readme.md` — the vector overview + case index
