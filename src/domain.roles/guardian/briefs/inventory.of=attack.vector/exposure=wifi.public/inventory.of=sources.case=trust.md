# inventory.of=sources · case=trust

## .what

the **trust-tier source allowlist** for the `attack.vector=wifi.public` inventory — the curated set of
sources the case briefs cite, ranked by trust tier, each read verbatim through the **bhrowser**. this is
a navigation/rollup artifact: it makes **no independent factual claim** and inherits its citations from
the case briefs that use them (`rule.require.seven-distinct-citations` exempts pure rollups).

> ⚠️ **not professional security advice — informational only.** this index frames where the vector's
> facts come from; it is signal for a person or a qualified security professional, never a substitute
> for one.

## .why a trust tier

not all sources carry equal weight. a claim about a protocol standard is strongest from the body that
*defines* the standard (Wi-Fi Alliance, IEEE via NIST); a claim about attack technique is strongest from
a threat-intelligence catalog (MITRE ATT&CK); consumer calibration is strongest from a government
consumer authority (FTC, CISA). the tiers below let a reader weigh each citation by its provenance, and
let a future refresh prioritize the highest-tier sources first.

## .the tiers

### tier 1 — standards bodies & government authorities (primary)

the definitional sources. a claim these make about the protocol or the official guidance is ground truth.

| id | source | authority | primary use |
|----|--------|-----------|-------------|
| S11 | Wi-Fi Alliance · Security (WPA3 + Enhanced Open) | defines Wi-Fi CERTIFIED | wpa3/pmf mandate, owe for open networks |
| S10 | Wi-Fi Alliance · Protected Management Frames | defines Wi-Fi CERTIFIED | deauth mechanism + pmf elimination + detection |
| S2 | NIST · SP 800-153 (Securing WLANs) | US standards body | wlan component/lifecycle model, monitor guidance |
| S1 | CISA · Securing Wireless Networks | US cyber authority | evil-twin, wireless capture, wpa2/wpa3 baseline |
| S8 | FTC · Are Public Wi-Fi Networks Safe? | US consumer authority | the modern https-era calibration |

### tier 2 — threat-intelligence & standards references (authoritative secondary)

catalogs and references maintained by security-domain institutions; strong for technique and mechanism.

| id | source | authority | primary use |
|----|--------|-----------|-------------|
| S3 | MITRE ATT&CK · T1557.004 (Evil Twin) | government-funded threat KB | ssid impersonation, pnl probe, portal capture, wips |
| S6 | MDN (Mozilla) · Strict-Transport-Security | web-standards reference | hsts calibration, cert-error sign, airport scenario |
| S13 | Cisco · Configure 802.11w MFP on WLC | vendor standards doc | 802.11w scope (deauth/disassoc protection) |
| S9 | Cisco Meraki · 802.11w Management Frame Protection | vendor standards doc | unauthenticated mgmt frames, spoof-a-client |

### tier 3 — industry & encyclopedic (support, cross-checked)

vendor resource-centers and community references; used for illustration and cross-check, never as sole
support for a decisive claim.

| id | source | authority | primary use |
|----|--------|-----------|-------------|
| S4 | Cloudflare · What is an on-path attacker? | industry reference | mitm/on-path definition, vpn elimination |
| S7 | Kaspersky · What is an Evil Twin Attack? | industry resource-center | ssid clone, forged portal step, vpn, delayed detection |
| S5 | Wikipedia · Evil twin (wireless networks) | encyclopedic (itself cited) | mitm class, non-https interception, phish |
| S12 | Wikipedia · Captive portal | encyclopedic (itself cited) | the legitimate portal pattern the attacker forges |

## .the coverage matrix

which sources support which case (a source may serve several — the frame is many-to-many):

| source | evil-twin | captive-portal-phish | passive-sniff | deauth-dos |
|--------|:---:|:---:|:---:|:---:|
| S1 CISA | ✔ | ✔ | ✔ | ✔ |
| S2 NIST | ✔ | | ✔ | ✔ |
| S3 MITRE | ✔ | ✔ | | ✔ |
| S4 Cloudflare | ✔ | | ✔ | |
| S5 Wikipedia evil-twin | ✔ | ✔ | ✔ | |
| S6 MDN hsts | ✔ | ✔ | | ✔ |
| S7 Kaspersky | ✔ | ✔ | | |
| S8 FTC | ✔ | ✔ | ✔ | |
| S9 Cisco Meraki | | | ✔ | ✔ |
| S10 Wi-Fi Alliance pmf | | | | ✔ |
| S11 Wi-Fi Alliance Security | | | ✔ | ✔ |
| S12 Wikipedia captive portal | | ✔ | | |
| S13 Cisco 802.11w | | | | ✔ |

each case brief cites **≥7 distinct** of these, per `rule.require.seven-distinct-citations`.

## .the gather discipline

every source above was:

1. **discovered** by a WebSearch (URL discovery only — a search result is never a citation)
2. **read** through the **bhrowser** (HEADFUL, session `<your-own-session>`) on 2026-08-21
3. **quoted verbatim** in the case brief that uses it, with the URL under `## .sources`

this is the `rule.require.bhrowser-citations` discipline. the shipped, self-contained audit trail is
each case brief's own `## .sources` section — the verbatim quote plus the URL that supports every
claim travels with the brief that makes it, so the package stands alone with no dependency on any
behavior-workspace scratch.

## .the freshness note

cyber facts age. the trust tier doubles as a **refresh priority**: on a re-verification pass, confirm
the tier-1 standards sources first (a wpa3/pmf or hsts-default change moves the whole calibration), then
tier-2, then tier-3. re-read via the bhrowser and update the read-date; a source that has moved or
changed its claim invalidates the briefs that lean on it.

## .see also

- `readme.md` — the vector overview + case index
- `rule.require.bhrowser-citations.[rule].md` — the citation instrument
- `rule.require.seven-distinct-citations.[rule].md` — the ≥7-source bar (from which this rollup is exempt)
- `howto.cite-via-bhrowser.[lesson].md` — the gather loop
- the case briefs — each carries its own `## .sources` subset of this allowlist
