# git.release.p2 snapshot review

## resolved issues

the issues below from prior review have been fixed:

### test description vs assertion mismatch (FIXED)

**was:** 3 test descriptions said "exit 1" but asserted exit 2

**now:** test descriptions updated to "exit 2: ... (constraint)" to match assertions

### [case-retry-failed-pr] [t0] — test pollution (FIXED)

**was:** snapshot captured two runs concatenated — `--mode plan` header followed by `--retry` header

**now:** retry mode check moved to start of plan mode block, returns early before normal plan output. snapshot now shows only the `--retry` run.

---

## summary

| category | status |
|----------|--------|
| test description says wrong exit code | ✅ fixed |
| test pollution (multiple runs) | ✅ fixed |

## notes

the actual exit code behavior is correct per spec:
- plan mode with failures → exit 2 (constraint)
- apply mode with failures → exit 2 (constraint)
- vibe stays `heres the wave...` for plan mode (informational header)
