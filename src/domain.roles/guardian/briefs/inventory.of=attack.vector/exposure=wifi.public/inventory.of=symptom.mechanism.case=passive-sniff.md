# inventory.of=symptom.mechanism · case=passive-sniff

## .what

the **symptom.mechanism** node for `case=passive-sniff` — the compromise that follows a silent capture:
**plaintext disclosure** of whatever crossed the open link un-encrypted. this brief states the
compromise and — as the calibration case — why that compromise is now confined to a narrow residue.

> ⚠️ **not professional security advice — informational only.** a reason-frame over public sources;
> its output is signal for a person or a qualified security professional, never a substitute for one.

> **recommendation disclaimer.** the guidance below is offered to the best of our knowledge from the
> info found in research — it carries **no guarantee of success or outcome**, and must be reviewed by
> a qualified security professional against your own real network, device, and threat model before
> reliance. it is groundwork for that review, not a substitute for it.

## .the compromise (the state)

the compromise is disclosure: the attacker reads what the person sent. CISA states the state and the
data classes it exposes:

> "Because your connection is being transmitted 'in the clear,' malicious actors could use sniffing
> tools to obtain sensitive information such as passwords or credit card numbers." — CISA, *Securing
> Wireless Networks* [S1]

Cloudflare frames it as the on-path attacker's collection of what crosses:

> "The attackers can then collect information as well as impersonate either of the two agents. In
> addition to websites, these attacks can target email communications, DNS lookups, and public WiFi
> networks." — Cloudflare, *On-path attacker* [S4]

## .the honest calibration — the compromise now needs plaintext to exist

this is the crux of the case, and it must be stated squarely: **the disclosure only lands on traffic
that was not encrypted end-to-end.** for the modern majority — tls/https — the sniffed bytes are
ciphertext, so the "state" is reached but the data is not. the FTC states the consequence:

> "Today, most websites do use encryption to protect your information. Because of the widespread use of
> encryption, connecting through a public Wi-Fi network is usually safe." — FTC, *Are Public Wi-Fi
> Networks Safe?* [S8]

so the compromise is confined to the **plaintext residue** — the ever-smaller minority of sites and
apps that never used tls. Wikipedia names exactly this residue:

> "When users log into unsecured (non-HTTPS) bank or e-mail accounts, the attacker intercepts the
> transaction, since it is sent through their equipment." — Wikipedia, *Evil twin (wireless networks)*
> [S5]

NIST frames the structural read: the disclosure is a confidentiality failure of an unsecured wlan
component, and the defense is to secure the link's confidentiality end-to-end:

> "The security of each WLAN is heavily dependent on how well each WLAN component—including client
> devices, access points (AP), and wireless switches—is secured throughout the WLAN lifecycle." —
> NIST SP 800-153 [S2]

## .why the elimination prevents it

the elimination denies the sniffer readable content at one of two layers. transport encryption (tls)
already does this for most traffic ([S8]). where traffic is not tls-protected, **Enhanced Open (owe)**
encrypts the link itself even without a password, and a vpn encrypts all traffic above the medium:

> "Wi-Fi Enhanced Open networks provide unauthenticated data encryption to users, an improvement over
> traditional open networks with no protections at all." — Wi-Fi Alliance, *Security* [S11]

and the standards frame (Cisco Meraki) makes the mechanism explicit: encryption is what turns a
readable broadcast into an opaque one — data frames *can* be encrypted, and that is the whole defense:

> "Unlike data traffic, which can be encrypted to provide a level of confidentiality, [management]
> frames must be heard and understood by all clients and therefore must be transmitted as open or
> unencrypted." — Cisco Meraki, *802.11w MFP* [S9]

## .the answer axes

- **eliminate** — encrypt the content (tls everywhere) *and/or* the link (vpn, or Enhanced Open where
  available) — either turns a plaintext capture into a capture of noise ([S8], [S11], [S9]). for tls
  traffic the compromise is effectively **eliminated**; a vpn **eliminates** it for the plaintext
  residue too.
- **detect** — the compromise is silent; there is no live sign of a pure passive read (see
  symptom.expression — the surface is the *absence* of the https lock, checked proactively, not an
  alert after the fact).
- **respond** — no live response exists for a completed passive read; if a plaintext credential may
  have been exposed, rotate it from a trusted device. the defense is preventive, not reactive.

## .likelihood

**band: low residual — the compromise is reachable only through the plaintext minority.** this is the
lowest-ranked data-loss path in the vector under modern conditions, and that rank is the honest
correction to the folklore that "public wifi = your data is stolen." ordinal judgment from the cited
sources, not a measured rate.

## .the many-to-many note

plaintext capture is the *read* half of what `case=evil-twin`'s mitm position can also do — but evil-twin
adds alter/redirect, and its captive-portal branch reaches credentials tls would otherwise protect. so
the same "read the traffic" outcome is shared, while the active case reaches strictly more. the
diagnosis is the path: a listen-only sniff is the least of the vector's dangers today.

## .sources

read verbatim via the **bhrowser** (HEADFUL, session `<your-own-session>`), 2026-08-21. WebSearch/WebFetch
were used only to discover candidate URLs, never as citations (`rule.require.bhrowser-citations`).

- [S1] CISA · Securing Wireless Networks — https://www.cisa.gov/news-events/news/securing-wireless-networks
- [S2] NIST · SP 800-153 Guidelines for Securing WLANs — https://csrc.nist.gov/pubs/sp/800/153/final
- [S4] Cloudflare · What is an on-path attacker? — https://www.cloudflare.com/learning/security/threats/on-path-attack/
- [S5] Wikipedia · Evil twin (wireless networks) — https://en.wikipedia.org/wiki/Evil_twin_(wireless_networks)
- [S8] FTC · Are Public Wi-Fi Networks Safe? — https://consumer.ftc.gov/articles/are-public-wi-fi-networks-safe-what-you-need-know
- [S9] Cisco Meraki · 802.11w Management Frame Protection — https://documentation.meraki.com/Wireless/Design_and_Configure/Architecture_and_Best_Practices/802.11w_Management_Frame_Protection_MFP
- [S11] Wi-Fi Alliance · Security (WPA3 + Enhanced Open) — https://www.wi-fi.org/security

(7 distinct bhrowser-read sources; `rule.require.seven-distinct-citations` satisfied.)

## .see also

- `inventory.of=exposure.mechanism.case=passive-sniff.md` — how the link is read
- `inventory.of=symptom.expression.case=passive-sniff.md` — the (mostly absent) signs
- `inventory.of=symptom.mechanism.case=evil-twin.md` — the active superset that reaches more
- `define.causal-chain.[lesson].md` — the four-node frame
- `readme.md` — the vector overview + case index
