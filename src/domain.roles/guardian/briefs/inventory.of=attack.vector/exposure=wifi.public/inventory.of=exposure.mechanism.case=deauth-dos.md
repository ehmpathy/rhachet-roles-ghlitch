# inventory.of=exposure.mechanism · case=deauth-dos

## .what

the **exposure.mechanism** node for `case=deauth-dos` — *how* an attacker forces a person's device off
a wifi network with forged management frames. this is the odd case in the vector: the direct harm is
**disruption**, not data theft — but it is also a **lever** that seeds the other cases.

> ⚠️ **not professional security advice — informational only.** a reason-frame over public sources;
> its output is signal for a person or a qualified security professional, never a substitute for one.

> **recommendation disclaimer.** the guidance below is offered to the best of our knowledge from the
> info found in research — it carries **no guarantee of success or outcome**, and must be reviewed by
> a qualified security professional against your own real network, device, and threat model before
> reliance. it is groundwork for that review, not a substitute for it.

## .the mechanism

the weakness is that **802.11 management frames are unauthenticated and unencrypted** — deauthentication
and disassociation frames must be readable by all clients, so anyone can forge one. Cisco Meraki states
the structural fact:

> "Management frames such as authentication, de-authentication, association, dissociation, beacons, and
> probes are used by wireless clients to initiate and tear down sessions for network services. Unlike
> data traffic, which can be encrypted to provide a level of confidentiality, these frames must be
> heard and understood by all clients and therefore must be transmitted as open or unencrypted. While
> these frames cannot be encrypted, they must be protected from forgery to protect the wireless medium
> from attacks. For example, an attacker could spoof management frames from an AP to attack a client
> associated with the AP." — Cisco Meraki, *802.11w MFP* [S9]

the Wi-Fi Alliance names the concrete attack and how cheaply it is mounted — the attacker needs only
public address information any sniff yields:

> "One of the most prominent attacks on Wi-Fi networks are injected De-authentication/Disassociation
> frames to disconnect a client or even multiple clients from the network. As long as an attacker is
> able to retrieve the MAC address of an Access Point (AP) and the Basic Service Set Identifier (BSSID)
> of a network, the attacker can spoof the AP and send out broadcast management frames to tell all
> clients that the AP will terminate their connection." — Wi-Fi Alliance, *Protected Management Frames*
> [S10]

the address info the attacker needs is trivially obtained — the same passive-sniff weakness feeds it:

> "Since MAC addresses and BSSIDs can be obtained easily by sniffing packets on a Wi-Fi channel, this
> attack is (with Protected Management Frames disabled or not available) easy to execute. Some tools
> even offer automated ways to terminate active connections in range of the attack tool." — Wi-Fi
> Alliance, *Protected Management Frames* [S10]

MITRE catalogs the same "block access" lever as one way an evil-twin coerces a re-join — deauth is how
an attacker *pushes* a victim off the real ap and onto a rogue one:

> "Adversaries may provide a stronger signal strength or block access to Wi-Fi access points to coerce
> or entice victim devices into connecting to malicious networks." — MITRE ATT&CK T1557.004 [S3]

## .the elimination — Protected Management Frames (802.11w / wpa3)

this is the one case with a clean, standards-level *elimination* at the network layer: **Protected
Management Frames (pmf)**, defined by IEEE 802.11w and mandatory under wpa3. Cisco states its scope:

> "The 802.11w standard aims to protect control and management frames and a set of robust management
> frames against forgery and replay attacks. The frame types protected include Disassociation,
> Deauthentication, and Robust Action frames." — Cisco, *Configure 802.11w MFP on WLC* [S13]

the Wi-Fi Alliance states the mechanism of the fix — encrypted disconnect frames the attacker cannot
forge:

> "Protected Management Frames enforces the encryption of frames for disconnection, which enables APs
> and clients to detect forged disconnect frames and ignore them." — Wi-Fi Alliance, *Protected
> Management Frames* [S10]

and wpa3 makes pmf non-optional:

> "WPA3 networks: Use the latest security protocols; Disallow outdated legacy protocols; Require use of
> Protected Management Frames (PMF)." — Wi-Fi Alliance, *Security* [S11]

## .the honest calibration — elimination exists, but adoption is the gap

the important honesty here: pmf *eliminates* forged deauth at the protocol level, but the elimination is
the **network operator's** to deploy, not the individual's. on a legacy wpa2 network without pmf, or an
open network, an individual **cannot** stop a deauth — they can only mitigate the *consequences* (route
over cellular, expect drops). CISA's baseline wpa2/wpa3 guidance and NIST's monitoring frame the
operator's side:

> "Ensure that all the access points you connect to use at least WPA2 encryption." — CISA, *Securing
> Wireless Networks* [S1]

> "The security of each WLAN is heavily dependent on how well each WLAN component ... is secured
> throughout the WLAN lifecycle, from initial WLAN design and deployment through ongoing maintenance
> and monitoring." — NIST SP 800-153 [S2]

## .the answer axes

- **eliminate** — at the **network** layer, pmf (802.11w / wpa3) eliminates forged deauth ([S10], [S11],
  [S13]) — an operator's control. at the **individual** layer on a network without pmf, the deauth
  itself cannot be eliminated; the person **mitigates** with cellular for work that cannot tolerate a
  drop, and with wariness that a forced re-join is a moment of heightened evil-twin risk.
- **detect** — the observable sign is the disruption itself (repeated disconnects); see symptom.expression.
- **respond** — if you are repeatedly dropped on public wifi, do not chase the reconnect; move to
  cellular, and be wary that the drop may be a push toward a rogue ap (link to `case=evil-twin`).

## .likelihood

**band: the disconnect is easy-to-mount and common as a nuisance; its escalation to a data compromise
is conditional (it depends on a follow-on evil-twin or dictionary attack).** the direct dos is disruptive
but not a data breach; the danger rises when it is a *stage*, not an end. ordinal judgment from the cited
sources, not a measured rate.

## .the many-to-many note

deauth-dos is the vector's clearest **kill-chain link**: it feeds `case=evil-twin` (force a re-join onto
a rogue ap — [S3]) and can accelerate a wpa2 passphrase crack ([S10], see symptom.mechanism). one
exposure.mechanism, several downstream cases — the diagnosis is the path, and deauth is often its first
step.

## .sources

read verbatim via the **bhrowser** (HEADFUL, session `<your-own-session>`), 2026-08-21. WebSearch/WebFetch
were used only to discover candidate URLs, never as citations (`rule.require.bhrowser-citations`).

- [S1] CISA · Securing Wireless Networks — https://www.cisa.gov/news-events/news/securing-wireless-networks
- [S2] NIST · SP 800-153 Guidelines for Securing WLANs — https://csrc.nist.gov/pubs/sp/800/153/final
- [S3] MITRE ATT&CK · T1557.004 Adversary-in-the-Middle: Evil Twin — https://attack.mitre.org/techniques/T1557/004/
- [S9] Cisco Meraki · 802.11w Management Frame Protection — https://documentation.meraki.com/Wireless/Design_and_Configure/Architecture_and_Best_Practices/802.11w_Management_Frame_Protection_MFP
- [S10] Wi-Fi Alliance · Protected Management Frames — https://www.wi-fi.org/beacon/philipp-ebbecke/protected-management-frames-enhance-wi-fi-network-security
- [S11] Wi-Fi Alliance · Security (WPA3 + Enhanced Open) — https://www.wi-fi.org/security
- [S13] Cisco · Configure 802.11w Management Frame Protection on WLC — https://www.cisco.com/c/en/us/support/docs/wireless-mobility/wireless-lan-wlan/212576-configure-802-11w-management-frame-protection.html

(7 distinct bhrowser-read sources; `rule.require.seven-distinct-citations` satisfied.)

## .see also

- `inventory.of=symptom.mechanism.case=deauth-dos.md` — the disruption + the escalation chain
- `inventory.of=symptom.expression.case=deauth-dos.md` — the observable signs
- `inventory.of=exposure.mechanism.case=evil-twin.md` — the case deauth pushes a victim toward
- `define.causal-chain.[lesson].md` — the four-node frame (and the kill-chain caveat)
- `readme.md` — the vector overview + case index
