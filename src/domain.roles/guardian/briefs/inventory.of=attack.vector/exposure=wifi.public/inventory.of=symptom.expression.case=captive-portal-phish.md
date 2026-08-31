# inventory.of=symptom.expression · case=captive-portal-phish

## .what

the **symptom.expression** node for `case=captive-portal-phish` — the *observable signs* that a portal
is forged (before you type) and that a credential was harvested (after). this node carries the
**detect** and **respond** guidance for the phish path.

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

## .the signs — before you type (the pre-submission surface)

### 1. the portal domain is wrong, unfamiliar, or not the venue's

a legitimate captive portal is the venue's own domain; a forged one is not. Wikipedia defines the
legitimate pattern so the deviation is legible:

> "A captive portal is a web page ... displayed to newly connected users of a Wi-Fi or wired network
> before they are granted broader access to network resources." — Wikipedia, *Captive portal* [S12]

**read this sign as: check the address bar.** if the "sign in to wifi" page is on a domain that is not
the venue's, or on a bare ip, or shows no https lock, do not type.

### 2. the https lock is absent — or present-but-hollow

the FTC gives the positive check, and its critical caveat:

> "How do you know your connection is encrypted? Look for a lock symbol or https in the address bar to
> the left of the website address." — FTC, *Are Public Wi-Fi Networks Safe?* [S8]

but for *this* case the lock is a weaker sign than usual, because the FTC also warns a scammer's page
can carry https and still be hostile: "your data may be encrypted on its way to the site, but it won't
be safe from scammers operating the site." [S8] so **an absent lock is a red flag, but a present lock is
not a green light** — the domain must also be right.

### 3. a portal that asks for the wrong secret

the decisive behavioral sign: a wifi login that requests your **email, bank, or social password** is
never legitimate. MITRE and Kaspersky both frame the forged page as a credential-capture surface:

> "a user may be directed to a fake login page or captive portal webpage to capture the victim's
> credentials." — MITRE ATT&CK T1557.004 [S3]

> "Evil twin hackers set up a copy of this page, hoping to trick unsuspecting victims into disclosing
> their login credentials." — Kaspersky, *Evil Twin Attacks* [S7]

**read this sign as: stop.** a real wifi portal asks for a room number, a code, or an acceptance of
terms — not the password to an account with no relation to the network.

### 4. a certificate error on a known login domain

if the forged page impersonates a *real* site you know (not a generic portal), the browser surfaces the
strongest possible sign — an unbypassable cert error:

> "The browser displays an invalid certificate error, and does not allow the user to bypass it, thus
> preventing them from giving their password to the attacker." — MDN, *Strict-Transport-Security* [S6]

## .the signs — after the fact (the retrospective surface) → convergent node

phished credentials surface later as account anomalies — a login-from-unknown-location alert, an
unrequested password reset, or an unrecognized charge after a public-wifi session. this retrospective
tail is **shared** with every credential-theft case on this vector, so it lives once, in the convergent
node — see `inventory.of=symptom.expression.convergent=account-takeover.md` for the full sign, its
detect/respond guidance, and its citations. what is captive-portal-phish-specific are the *pre-submission*
signs above (#1–#4); the account-takeover tail is the path's shared endpoint.

## .the answer axes

- **detect** — the pre-submission signs, priority order: (3) a portal that asks for the wrong secret =
  stop; (1) a wrong/unfamiliar portal domain; (4) a cert error on a known login domain; (2) an absent
  https lock (with the caveat that a present lock is not sufficient). the later account alert is the
  shared tail — see `convergent=account-takeover.md`.
- **respond** — if you have not yet typed: disconnect, do not submit. if you have: from a **trusted**
  device, rotate the credential at once and anywhere it was reused, enable/verify two-factor, and review
  recent account activity. do **not** rotate from the suspect network.
- **eliminate** — detection is the backstop; the fix is to deny the credential (see exposure/symptom
  mechanism briefs) and to hold a unique password + two-factor per account so one loss does not cascade.

## .likelihood

**band: the pre-submission signs are reliable but demand active attention (the person must look); the
retrospective account-alert sign is the common real-world tell.** the danger of this case is precisely
that its live signs are *subtle and behavioral* — there is often no scary alert, only a page that looks
right, which is why the "does this portal ask for the wrong secret?" check is the decisive one.
ordinal judgment from the cited sources, not a measured rate.

## .the many-to-many note

the retrospective account-alert sign is shared with `case=evil-twin`, `case=passive-sniff`, and any
credential-theft case — one endpoint, several upstream cases — so it is deduped into
`inventory.of=symptom.expression.convergent=account-takeover.md` rather than restated here. the
diagnosis is the **path** that produced the sign.

## .sources

read verbatim via the **bhrowser** (HEADFUL, session `<your-own-session>`), 2026-08-21. WebSearch/WebFetch
were used only to discover candidate URLs, never as citations (`rule.require.bhrowser-citations`).

- [S3] MITRE ATT&CK · T1557.004 Adversary-in-the-Middle: Evil Twin — https://attack.mitre.org/techniques/T1557/004/
- [S6] MDN (Mozilla) · Strict-Transport-Security (HSTS) — https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Strict-Transport-Security
- [S7] Kaspersky · What is an Evil Twin Attack? — https://usa.kaspersky.com/resource-center/preemptive-safety/evil-twin-attacks
- [S8] FTC · Are Public Wi-Fi Networks Safe? — https://consumer.ftc.gov/articles/are-public-wi-fi-networks-safe-what-you-need-know
- [S12] Wikipedia · Captive portal — https://en.wikipedia.org/wiki/Captive_portal

(5 distinct bhrowser-read sources of its own for the case-specific signs; the shared account-takeover
tail's citations live in `convergent=account-takeover.md`. `rule.require.seven-distinct-citations` is
satisfied across the case ∪ convergent union — see the reworked count guard.)

## .see also

- `inventory.of=exposure.mechanism.case=captive-portal-phish.md` — how the credential is elicited
- `inventory.of=symptom.mechanism.case=captive-portal-phish.md` — the compromise + why tls misses it
- `inventory.of=symptom.expression.case=evil-twin.md` — the kin case's signs
- `define.causal-chain.[lesson].md` — the four-node frame
- `readme.md` — the vector overview + case index
