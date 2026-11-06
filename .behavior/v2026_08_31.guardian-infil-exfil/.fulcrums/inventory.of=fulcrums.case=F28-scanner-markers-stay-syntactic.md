# F28 — the live-claim scanner's markers stay syntactic

## the fork

the scanner is the deterministic floor under the fullsun-safe gate. a reviewer asks it to also
catch a bare `owner/repo` identity and a bare hostname (one with no TLD).

- (a) add a bare `owner/repo` pattern and a bare-hostname pattern
- (b) keep the scanner on markers with a syntactic shape (an ip, a key run, an arn, a path under
  a known root, a host under a known TLD, a file name with a known extension); a bare identity or
  hostname stays the agent's strip, which the promote stone already requires

## taken, and why

(b). a bare `owner/repo` is two words around a slash; a bare hostname is one hyphenated word.
generalized lessons carry both shapes ("input/output", "and/or", "build-cache", "log-shipper"),
so either pattern would refuse clean lessons and train the agent to reword around the gate. the
promote stone states the scan is a floor, never the whole gate, and requires the agent to strip
semantic specifics a regex cannot see. a hostname under a known TLD, and `github.com/<owner>/<repo>`,
already hit the TLD pattern. system-root paths (`/etc/`, `/var/`, `/opt/`, ...) do carry a
syntactic shape, so they joined the scanner.

## rework

clean. one pattern per marker in `scan_for_live_claim_markers`, one `[case20]` body each.

## confidence

75%. the 25% is whether the habitat's own `owner/repo`, read from its git remote, earns an exact
marker: a match on that one string carries no false-positive cost.

## where

- `src/domain.roles/guardian/skills/security.habitat.redteam/output.sh` (`scan_for_live_claim_markers`)

## verdict once ruled

_(awaits council)_
