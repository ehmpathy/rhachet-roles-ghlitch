# inventory.of=symptom.expression · case=deauth-dos

## .what

the **symptom.expression** node for `case=deauth-dos` — the observable signs of a deauth attack. this is
the one case whose *direct* sign is loud and unmistakable (your connection drops), so the detection
challenge is not to notice it but to read it correctly: is this ordinary flaky wifi, or an attack — and,
critically, is it the first step of an evil-twin re-join?

> ⚠️ **not professional security advice — informational only.** a reason-frame over public sources;
> its output is signal for a person or a qualified security professional, never a substitute for one.

> **recommendation disclaimer.** the guidance below is offered to the best of our knowledge from the
> info found in research — it carries **no guarantee of success or outcome**, and must be reviewed by
> a qualified security professional against your own real network, device, and threat model before
> reliance. it is groundwork for that review, not a substitute for it.

> 🚨 **escalation — act now if this is live.** if you believe you are under active attack or your
> accounts are compromised, disconnect, change passwords from a trusted device, and contact your
> security team or provider now. repeated forced disconnects can be an active attack in their own
> right, or the first step of an evil-twin re-join — so this "how would i know?" surface carries the
> carve-out directly (`motto.not-security-advice`): treat a live pattern as a reason to act, not only
> to read.

## .the direct sign — repeated, unexplained disconnects

the observable expression of a deauth is the disruption itself. the Wi-Fi Alliance describes exactly
what the end-user sees:

> "From an end-user perspective, this results in an unstable connection or no connection at all, and
> might also cause the client to blacklist the spoofed AP (or the whole network) for an extended
> period." — Wi-Fi Alliance, *Protected Management Frames* [S10]

**read this sign as: pattern matters.** a single drop is noise; *repeated* drops that clear the moment
you move away, or that hit multiple devices at once, or that persist on a network usually stable, are
the shape of a forced deauth. the sign is legible precisely because the attack is disruptive by design.

## .the escalation sign — evil-twin markers after a re-join

the more important sign is what follows the drop. because a deauth is often a *push* toward a rogue ap
(MITRE's "block access" coercion), a drop followed by a **new** set of evil-twin signs is the real
alarm:

> "Adversaries may provide a stronger signal strength or block access to Wi-Fi access points to coerce
> or entice victim devices into connecting to malicious networks." — MITRE ATT&CK T1557.004 [S3]

so after a forced reconnect, watch for the evil-twin symptom.expression set: an unexpected cert alert, a
captive portal on a wrong domain. MDN's cert-error sign is the strongest of these:

> "The browser displays an invalid certificate error, and does not allow the user to bypass it." —
> MDN, *Strict-Transport-Security* [S6]

## .the operator's sign — wips / forged-frame detection

at the network-operator scale, the forged frames are directly detectable. the Wi-Fi Alliance notes that
pmf-capable infrastructure can surface the attacker:

> "if an AP reports the detection of attempted forged frames to a network monitoring tool, the network
> operator can be notified to quickly expose the attacker." — Wi-Fi Alliance, *Protected Management
> Frames* [S10]

MITRE's wips guidance covers the paired rogue-ap surface an operator watches:

> "Wireless intrusion prevention systems (WIPS) can identify traffic patterns indicative of
> adversary-in-the-middle activity and scan for evils twins and rogue access points." — MITRE ATT&CK
> T1557.004 (M1031) [S3]

and NIST frames monitoring as the lifecycle activity that makes these signs actionable:

> "The security of each WLAN is heavily dependent on how well each WLAN component ... is secured
> throughout the WLAN lifecycle, from initial WLAN design and deployment through ongoing maintenance
> and monitoring." — NIST SP 800-153 [S2]

## .the negative sign — what a deauth does *not* look like

honesty demands the inverse: a deauth is a **connectivity** event, not a data-theft event, so it does
**not** present as an account alert or a data leak on its own. Cisco Meraki frames the direct attack as
a forgery against the client's session, not against its data:

> "an attacker could spoof management frames from an AP to attack a client associated with the AP." —
> Cisco Meraki, *802.11w MFP* [S9]

so an account alert after a deauth-heavy session points not to the deauth itself but to a *paired* case
(evil-twin re-join, or a cracked wpa2 passphrase) — the deauth was the door, not the theft.

## .the answer axes

- **detect** — (1) the pattern of repeated, unexplained drops = the direct sign; (2) evil-twin markers
  (cert alert, wrong-domain portal) *after* a forced reconnect = the escalation sign; (3) wips /
  forged-frame alerts = the operator's sign.
- **respond** — do not chase the reconnect on the same network; move to cellular. treat the post-drop
  window as high-risk for an evil-twin re-join — verify the network name, never tap through a cert alert.
- **eliminate** — the disruption itself is eliminated only by pmf at the network layer (see the
  mechanism briefs); the individual mitigates with cellular fallback.

## .likelihood

**band: the direct disconnect sign is reliable and loud but ambiguous (flaky wifi mimics it); the
escalation signs are the ones that convert a nuisance into a danger.** the interpretive rule: a drop is
a nuisance, but a drop *followed by* an evil-twin marker is an attack in progress. ordinal judgment from
the cited sources, not a measured rate.

## .the many-to-many note

the post-reconnect evil-twin markers (cert alert, wrong-domain portal) are **shared** with
`case=evil-twin`'s own symptom.expression — the same signs, reached because deauth handed the victim to
the rogue ap. one set of signs, two paths in: the diagnosis is which door opened them.

## .sources

read verbatim via the **bhrowser** (HEADFUL, session `<your-own-session>`), 2026-08-21. WebSearch/WebFetch
were used only to discover candidate URLs, never as citations (`rule.require.bhrowser-citations`).

- [S1] CISA · Securing Wireless Networks — https://www.cisa.gov/news-events/news/securing-wireless-networks
- [S2] NIST · SP 800-153 Guidelines for Securing WLANs — https://csrc.nist.gov/pubs/sp/800/153/final
- [S3] MITRE ATT&CK · T1557.004 Adversary-in-the-Middle: Evil Twin — https://attack.mitre.org/techniques/T1557/004/
- [S6] MDN (Mozilla) · Strict-Transport-Security (HSTS) — https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Strict-Transport-Security
- [S9] Cisco Meraki · 802.11w Management Frame Protection — https://documentation.meraki.com/Wireless/Design_and_Configure/Architecture_and_Best_Practices/802.11w_Management_Frame_Protection_MFP
- [S10] Wi-Fi Alliance · Protected Management Frames — https://www.wi-fi.org/beacon/philipp-ebbecke/protected-management-frames-enhance-wi-fi-network-security
- [S13] Cisco · Configure 802.11w Management Frame Protection on WLC — https://www.cisco.com/c/en/us/support/docs/wireless-mobility/wireless-lan-wlan/212576-configure-802-11w-management-frame-protection.html

(7 distinct bhrowser-read sources; `rule.require.seven-distinct-citations` satisfied.)

## .see also

- `inventory.of=exposure.mechanism.case=deauth-dos.md` — how the frame is forged
- `inventory.of=symptom.mechanism.case=deauth-dos.md` — the dos + the escalation chain
- `inventory.of=symptom.expression.case=evil-twin.md` — the shared post-reconnect signs
- `define.causal-chain.[lesson].md` — the four-node frame
- `readme.md` — the vector overview + case index
