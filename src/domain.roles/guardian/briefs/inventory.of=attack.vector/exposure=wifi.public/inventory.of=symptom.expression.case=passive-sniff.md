# inventory.of=symptom.expression · case=passive-sniff

## .what

the **symptom.expression** node for `case=passive-sniff` — the observable surface of a silent read. the
core fact of this node is that **a pure passive sniff produces almost no live sign** — so its
"detection" is really *proactive verification* (is my traffic encrypted?) plus the retrospective account
alert. this node states that honestly rather than invent alarms that do not exist.

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

## .the core property — silence

a passive sniff is a receive-only act on a broadcast medium; the attacker transmits no frames to the
victim, so there is no packet, alert, or anomaly on the victim's device to observe. Cisco Meraki's
frame of wifi as an open broadcast makes the point — any device can *listen* without a signal of its
own:

> "Wi-Fi is a broadcast medium that enables any device to eavesdrop and participate either as a
> legitimate or rogue device." — Cisco Meraki, *802.11w MFP* [S9]

so unlike evil-twin (which raises a cert alert) or deauth-dos (which drops your connection), passive-sniff
has **no in-the-moment tell**. the detection surface is therefore *proactive*, not reactive.

## .the proactive sign — is my traffic encrypted?

the one thing a person *can* observe is the state of their own encryption — the presence of the https
lock. the FTC gives the check:

> "How do you know your connection is encrypted? Look for a lock symbol or https in the address bar to
> the left of the website address. This works on a mobile browser, too. It can be hard to tell if a
> mobile app uses encryption, but the majority do." — FTC, *Are Public Wi-Fi Networks Safe?* [S8]

read this correctly: for passive-sniff, **the https lock is a real green light** (unlike the
captive-portal case, where a lock can be hollow) — because here there is no attacker to terminate your
tls; a valid lock means the sniffer reads ciphertext. the *absence* of the lock on a sensitive page is
the only pre-loss sign, and it marks exactly the plaintext residue Wikipedia describes:

> "When users log into unsecured (non-HTTPS) bank or e-mail accounts, the attacker intercepts the
> transaction, since it is sent through their equipment." — Wikipedia, *Evil twin (wireless networks)*
> [S5]

CISA reinforces the proactive stance — the guidance is to *ensure* encryption ahead of time, because
you will not get an alert after:

> "Ensure that all the access points you connect to use at least WPA2 encryption." — CISA, *Securing
> Wireless Networks* [S1]

## .the retrospective sign — a later account alert → convergent node

the only *after-the-fact* sign is the shared one: if a plaintext credential was captured and used, it
surfaces as an account anomaly — a login-from-unknown-location or an unrecognized transaction after use
of a plaintext service on open wifi. because a passive sniff has almost no live sign, this retrospective
tail is nearly the whole detection surface — yet it is **shared** with every credential-theft case, so
it lives once, in the convergent node. see
`inventory.of=symptom.expression.convergent=account-takeover.md` for the full sign, its detect/respond
guidance, and its citations. what is passive-sniff-specific is the *silence itself* (above) and the
proactive https-lock check; the account-takeover tail is the path's shared endpoint.

## .the answer axes

- **detect** — there is no live sign to watch for; instead **proactively verify** the https lock on any
  sensitive page (a valid lock here *is* sufficient — [S8]), treat an absent lock as the one pre-loss
  red flag, and watch for the retrospective account alert (the shared tail — see
  `convergent=account-takeover.md`). where a network offers Enhanced Open (owe), the link is encrypted
  regardless [S11].
- **respond** — no live response exists; if a plaintext credential may have been captured, rotate it
  from a trusted device.
- **eliminate** — because detection is so thin, this case is defended almost entirely by **prevention**:
  tls everywhere + a vpn on untrusted networks (see the mechanism briefs).

## .likelihood

**band: the live-detection surface is effectively empty; the proactive https-lock check is the real
control, and the retrospective account alert is the only after-the-fact tell.** the honest message is
that you cannot "watch for" a passive sniff — you prevent it, and you verify encryption up front.
ordinal judgment from the cited sources, not a measured rate.

## .the many-to-many note

the retrospective account-alert sign is shared with `case=evil-twin` and `case=captive-portal-phish` —
one endpoint, several upstream cases — so it is deduped into
`inventory.of=symptom.expression.convergent=account-takeover.md` rather than restated here. what is
*unique* to passive-sniff is the near-total absence of a live sign, which is itself the diagnostic
signature: no alarm does not mean no exposure.

## .sources

read verbatim via the **bhrowser** (HEADFUL, session `<your-own-session>`), 2026-08-21. WebSearch/WebFetch
were used only to discover candidate URLs, never as citations (`rule.require.bhrowser-citations`).

- [S1] CISA · Securing Wireless Networks — https://www.cisa.gov/news-events/news/securing-wireless-networks
- [S5] Wikipedia · Evil twin (wireless networks) — https://en.wikipedia.org/wiki/Evil_twin_(wireless_networks)
- [S8] FTC · Are Public Wi-Fi Networks Safe? — https://consumer.ftc.gov/articles/are-public-wi-fi-networks-safe-what-you-need-know
- [S9] Cisco Meraki · 802.11w Management Frame Protection — https://documentation.meraki.com/Wireless/Design_and_Configure/Architecture_and_Best_Practices/802.11w_Management_Frame_Protection_MFP
- [S11] Wi-Fi Alliance · Security (WPA3 + Enhanced Open) — https://www.wi-fi.org/security

(5 distinct bhrowser-read sources of its own for the case-specific signs; the shared account-takeover
tail's citations live in `convergent=account-takeover.md`. `rule.require.seven-distinct-citations` is
satisfied across the case ∪ convergent union — see the reworked count guard.)

## .see also

- `inventory.of=exposure.mechanism.case=passive-sniff.md` — how the link is read
- `inventory.of=symptom.mechanism.case=passive-sniff.md` — the compromise + calibration
- `inventory.of=symptom.expression.case=captive-portal-phish.md` — where a lock can be hollow (contrast)
- `define.causal-chain.[lesson].md` — the four-node frame
- `readme.md` — the vector overview + case index
