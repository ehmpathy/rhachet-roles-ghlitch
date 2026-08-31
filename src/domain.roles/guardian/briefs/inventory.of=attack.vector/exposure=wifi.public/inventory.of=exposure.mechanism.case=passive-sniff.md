# inventory.of=exposure.mechanism · case=passive-sniff

## .what

the **exposure.mechanism** node for `case=passive-sniff` — *how* an open wifi link lets a nearby radio
read a person's traffic without any active attack. this is the classic "sniffing" risk — and the case
whose real-world danger has *shrunk the most* in the https era, which this brief states honestly.

> ⚠️ **not professional security advice — informational only.** a reason-frame over public sources;
> its output is signal for a person or a qualified security professional, never a substitute for one.

> **recommendation disclaimer.** the guidance below is offered to the best of our knowledge from the
> info found in research — it carries **no guarantee of success or outcome**, and must be reviewed by
> a qualified security professional against your own real network, device, and threat model before
> reliance. it is groundwork for that review, not a substitute for it.

## .the mechanism

the weakness is that **an open 802.11 link has no link-layer encryption** — frames travel in the clear
and any radio in range can capture them. CISA states it plainly:

> "Many public access points are not secured and the traffic they carry is not encrypted. This can put
> your sensitive communications or transactions at risk. Because your connection is being transmitted
> 'in the clear,' malicious actors could use sniffing tools to obtain sensitive information such as
> passwords or credit card numbers." — CISA, *Securing Wireless Networks* [S1]

unlike the active cases, this needs no rogue ap and no interaction — the attacker only listens. Cisco
Meraki notes the same broadcast property from the standards side: wifi is a shared medium any device
can hear.

> "Wi-Fi is a broadcast medium that enables any device to eavesdrop and participate either as a
> legitimate or rogue device." — Cisco Meraki, *802.11w MFP* [S9]

packet capture is trivial on an open channel — the Wi-Fi Alliance notes it as the setup step for other
attacks:

> "MAC addresses and BSSIDs can be obtained easily by sniffing packets on a Wi-Fi channel." — Wi-Fi
> Alliance, *Protected Management Frames* [S10]

Cloudflare frames the read as the on-path attacker's basic capability — to collect what crosses:

> "The attackers can then collect information as well as impersonate either of the two agents. In
> addition to websites, these attacks can target email communications, DNS lookups, and public WiFi
> networks." — Cloudflare, *On-path attacker* [S4]

NIST frames the structural point: an open link is one unsecured wlan component, and confidentiality
rests on its protection:

> "The security of each WLAN is heavily dependent on how well each WLAN component—including client
> devices, access points (AP), and wireless switches—is secured throughout the WLAN lifecycle." —
> NIST SP 800-153 [S2]

## .the honest calibration — the mechanism is real, its reach is now narrow

this is the case where folklore most overstates the danger, so the calibration is the point. the *link*
is readable, but **what a reader gets is mostly ciphertext**, because transport-layer encryption (tls)
now protects the content. the FTC states the shift directly:

> "In the past, if you used a public Wi-Fi network to get online, your information was at risk. That's
> because most websites didn't use encryption ... Today, most websites do use encryption to protect
> your information. Because of the widespread use of encryption, connecting through a public Wi-Fi
> network is usually safe." — FTC, *Are Public Wi-Fi Networks Safe?* [S8]

so a passive sniff of a modern https session yields only encrypted bytes; what remains readable is the
**minority of traffic that never used tls** — Wikipedia names the plaintext residue: "When users log
into unsecured (non-HTTPS) bank or e-mail accounts, the attacker intercepts the transaction, since it
is sent through their equipment." [S5]

the standards answer for the open-link weakness itself is **Wi-Fi Enhanced Open (owe)**, which encrypts
even a passwordless network:

> "Wi-Fi Enhanced Open networks provide unauthenticated data encryption to users, an improvement over
> traditional open networks with no protections at all." — Wi-Fi Alliance, *Security* [S11]

## .the answer axes

- **eliminate** — two layers close this cleanly: (1) **tls/https** already encrypts most content, so a
  sniff reads ciphertext ([S8]); use https, prefer apps that pin/enforce it. (2) a **trusted vpn**
  encrypts the whole link above the open medium, so even non-https traffic is opaque to a sniffer.
  where available, **Enhanced Open (owe)** encrypts the link itself [S11]. **verdict:** for tls traffic
  this node is effectively **eliminated**; for the plaintext residue it is **eliminated by a vpn** and
  **mitigated by owe** — the rare gap is a plaintext app on an open network with no vpn.
- **detect** — a passive sniff is, by nature, **silent** — it leaves no observable sign on the victim's
  device (see symptom.expression, which is largely about the *absence* of the https lock, not an alert).
- **respond** — there is no live response to a pure passive sniff; the defense is entirely preventive
  (https/vpn). if plaintext credentials may have crossed, rotate them from a trusted device.

## .likelihood

**band: the *capture* is common on open networks; a *useful-data* outcome is now rare, confined to the
plaintext minority.** this is the largest folklore-vs-fact gap in the whole vector: the sniff is easy,
but tls means the sniff mostly reads noise. ordinal judgment from the cited sources, not a measured rate.

## .the many-to-many note

passive-sniff shares the "read the traffic" capability with `case=evil-twin` (whose mitm position is an
*active* superset — it can read *and* alter *and* redirect). the distinction is the frame's core:
passive-sniff is a *listen-only* exposure.mechanism; evil-twin is a *gateway* one. same data at risk,
different pathway — the diagnosis is the path.

## .sources

read verbatim via the **bhrowser** (HEADFUL, session `<your-own-session>`), 2026-08-21. WebSearch/WebFetch
were used only to discover candidate URLs, never as citations (`rule.require.bhrowser-citations`).

- [S1] CISA · Securing Wireless Networks — https://www.cisa.gov/news-events/news/securing-wireless-networks
- [S2] NIST · SP 800-153 Guidelines for Securing WLANs — https://csrc.nist.gov/pubs/sp/800/153/final
- [S4] Cloudflare · What is an on-path attacker? — https://www.cloudflare.com/learning/security/threats/on-path-attack/
- [S5] Wikipedia · Evil twin (wireless networks) — https://en.wikipedia.org/wiki/Evil_twin_(wireless_networks)
- [S8] FTC · Are Public Wi-Fi Networks Safe? — https://consumer.ftc.gov/articles/are-public-wi-fi-networks-safe-what-you-need-know
- [S9] Cisco Meraki · 802.11w Management Frame Protection — https://documentation.meraki.com/Wireless/Design_and_Configure/Architecture_and_Best_Practices/802.11w_Management_Frame_Protection_MFP
- [S10] Wi-Fi Alliance · Protected Management Frames — https://www.wi-fi.org/beacon/philipp-ebbecke/protected-management-frames-enhance-wi-fi-network-security
- [S11] Wi-Fi Alliance · Security (WPA3 + Enhanced Open) — https://www.wi-fi.org/security

(8 distinct bhrowser-read sources; `rule.require.seven-distinct-citations` satisfied.)

## .see also

- `inventory.of=symptom.mechanism.case=passive-sniff.md` — the compromise (plaintext capture)
- `inventory.of=symptom.expression.case=passive-sniff.md` — the (mostly absent) signs
- `inventory.of=exposure.mechanism.case=evil-twin.md` — the active superset of this listen-only case
- `define.causal-chain.[lesson].md` — the four-node frame
- `readme.md` — the vector overview + case index
