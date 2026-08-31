# motto.not-security-advice

## .the motto

> **this is not professional security advice.**

## .what

every output the guardian produces — research, hazard maps, attack-vector inventories, elimination
and detection guidance — is **informational only**. it is never a substitute for a qualified security
professional who assesses the reader's own network, device, or situation.

## .why

the guardian reasons over public security facts. a human may act on what it says. that asymmetry
demands humility:

- we do not inspect the reader's actual network or device
- we do not know their full threat model, configuration, or context
- we can be wrong, stale, or incomplete — cyber advice ages fast
- an error here can expose credentials, funds, or private data

the motto is the guardrail that keeps our confidence proportional to our actual authority.

## .how it shows up

| surface | requirement |
|---------|-------------|
| readme | prominent disclaimer near the top |
| role readme | disclaimer in the guardian role |
| skill output | disclaimer on any output that carries guidance |
| briefs | facts may stand alone; recommendations must carry the disclaimer |

## .the text

> ⚠️ **this tool is for informational purposes only and does not constitute professional security
> advice.** analyses are not exhaustive and must not be relied upon for security decisions. consult a
> qualified security professional for any assessment of your own network, device, or situation.

## .the escalation carve-out

for a case that reads as an active compromise, the disclaimer alone is not enough. direct the human
to act now:

> if you believe you are under active attack or your accounts are compromised, disconnect, change
> passwords from a trusted device, and contact your security team or provider now.

## .enforcement

- guidance output without the disclaimer = blocker
- an active-compromise-shaped case without the escalation carve-out = blocker

## .see also

- `rule.require.recommendation-disclaimer.[rule].md` — the rule this motto anchors
- `rule.require.bhrowser-citations.[rule].md` — claims must trace to trusted sources
