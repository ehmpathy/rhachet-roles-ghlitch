# inventory.of=symptom.mechanism · case=deauth-dos

## .what

the **symptom.mechanism** node for `case=deauth-dos` — the compromise a forged deauth produces. it has
two faces: a **direct** face (denial of service — the connection drops) and an **indirect** face (the
drop is a *stage* that enables an evil-twin re-join or a wpa2 passphrase crack). this brief states both.

> ⚠️ **not professional security advice — informational only.** a reason-frame over public sources;
> its output is signal for a person or a qualified security professional, never a substitute for one.

> **recommendation disclaimer.** the guidance below is offered to the best of our knowledge from the
> info found in research — it carries **no guarantee of success or outcome**, and must be reviewed by
> a qualified security professional against your own real network, device, and threat model before
> reliance. it is groundwork for that review, not a substitute for it.

## .the direct compromise — denial of service

the immediate compromise is a dropped connection, at will, repeatedly. the Wi-Fi Alliance states the
state and its user-visible shape:

> "Some tools even offer automated ways to terminate active connections in range of the attack tool,
> and so make it easy to perform a Denial of Service (DoS) attack. From an end-user perspective, this
> results in an unstable connection or no connection at all, and might also cause the client to
> blacklist the spoofed AP (or the whole network) for an extended period." — Wi-Fi Alliance, *Protected
> Management Frames* [S10]

unlike every other case in this vector, the direct compromise here is **not** a confidentiality loss —
no data is read. Cisco Meraki frames it as an attack *on the medium* itself, a forgery the client
obeys:

> "an attacker could spoof management frames from an AP to attack a client associated with the AP." —
> Cisco Meraki, *802.11w MFP* [S9]

## .the indirect compromise — deauth as a stage

the deauth's real danger is as a **lever**. two escalation paths are documented:

**(1) forced re-join onto a rogue ap.** a drop of the victim from the real network increases the odds
the device re-associates to a stronger-signal evil twin. MITRE lists exactly this "block access"
coercion:

> "Adversaries may provide a stronger signal strength or block access to Wi-Fi access points to coerce
> or entice victim devices into connecting to malicious networks." — MITRE ATT&CK T1557.004 [S3]

so the deauth's dos becomes the entry to `case=evil-twin` — the drop is not the harm, the re-join is.

**(2) accelerated passphrase crack (wpa2).** on a wpa2 network, a forced reconnect makes the client
re-transmit the authentication handshake, which the attacker captures to attack offline. the Wi-Fi
Alliance documents the chain:

> "disconnect attacks can be used to speed up offline dictionary attacks. The attack is performed for
> just a short period of time, interrupting the connection and forcing the clients to reconnect to the
> network. The attacker can then capture the authentication frames exchanged during the forced
> reconnections to execute a dictionary attack on the passphrase." — Wi-Fi Alliance, *Protected
> Management Frames* [S10]

## .why the elimination prevents it

Protected Management Frames removes the forgery the whole chain depends on — a client that can detect
and ignore a forged deauth is never dropped, never coerced, never forced to re-handshake. the Wi-Fi
Alliance states the fix:

> "Protected Management Frames enforces the encryption of frames for disconnection, which enables APs
> and clients to detect forged disconnect frames and ignore them." — Wi-Fi Alliance, *Protected
> Management Frames* [S10]

Cisco confirms deauth/disassoc are exactly the frames 802.11w protects:

> "The frame types protected include Disassociation, Deauthentication, and Robust Action frames." —
> Cisco, *Configure 802.11w MFP on WLC* [S13]

and wpa3 makes that protection mandatory, so the elimination is default on a modern network:

> "WPA3 networks: ... Require use of Protected Management Frames (PMF)." — Wi-Fi Alliance, *Security*
> [S11]

NIST frames the residual reality: where the network does not deploy pmf, the compromise is a lifecycle
gap the operator owns:

> "The security of each WLAN is heavily dependent on how well each WLAN component ... is secured
> throughout the WLAN lifecycle." — NIST SP 800-153 [S2]

## .the answer axes

- **eliminate** — pmf (802.11w / wpa3) removes the forged frame the compromise needs, to break both the
  dos and the escalation chain at the network layer ([S10], [S13], [S11]). the individual cannot deploy
  pmf on someone else's network, so on a non-pmf network they **mitigate**: cellular fallback for the
  dos; and — for the passphrase-crack path — a strong, unique network passphrase blunts the offline
  attack even if the handshake is captured.
- **detect** — the sign is the disruption (repeated drops) and, for the escalation, the evil-twin signs
  after a re-join; see symptom.expression.
- **respond** — treat repeated forced drops as suspicious: move to cellular, and be alert to an
  evil-twin re-join (a cert alert, a wrong-domain portal) after a reconnect.

## .likelihood

**band: the direct dos is common and low-severity (a nuisance, not a breach); the escalation to a real
compromise is uncommon and conditional on a paired attack.** the honest read: a deauth alone loses you
your connection, not your data — the danger is when it is step one of a longer chain. ordinal judgment
from the cited sources, not a measured rate.

## .the many-to-many note

this symptom.mechanism is a **hinge**: its direct face (dos) is unique to this case, but its indirect
face reaches into `case=evil-twin` (the re-join) and a wpa2 passphrase crack (a compromise beyond this
vector's four cases). one exposure.mechanism, one direct compromise, several downstream ones — the
diagnosis is the path the deauth opens.

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

- `inventory.of=exposure.mechanism.case=deauth-dos.md` — how the frame is forged
- `inventory.of=symptom.expression.case=deauth-dos.md` — the observable signs
- `inventory.of=symptom.mechanism.case=evil-twin.md` — the case a forced re-join opens
- `define.causal-chain.[lesson].md` — the four-node frame (kill-chain caveat)
- `readme.md` — the vector overview + case index
