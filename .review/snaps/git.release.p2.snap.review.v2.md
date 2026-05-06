# git.release snapshot review (v2)

reviewed: p1 (787 lines) + p2 (999 lines)

## issues found

### p2: [case-feat-passed-with-automerge] [t0] — hint contradicts state

**file:** git.release.p2.integration.test.ts.snap (lines 498-508)

**test:** "plan mode then: exit 0: show automerge status"

**output:**
```
🌊 release: feat(oceans): add reef protection
   ├─ 👌 all checks passed
   ├─ 🌴 automerge enabled [found]
   └─ hint: use --mode apply to enable automerge and watch
```

**problem:** automerge is already enabled (`[found]`), but the hint says "enable automerge". should say "use --mode apply to watch" or similar.

---

### p1: case5 [t1] — wrong command, no retry action

**file:** git.release.p1.integration.test.ts.snap (lines 477-492)

**test:** "--retry with failed tag workflows then: reruns failed tag workflows"

**output:**
```
🐚 git.release --to prod --mode apply
...
   └─ 🥥 let's watch
      ├─ 💤 publish.yml, Xs in action, Xs watched
      ├─ ⚓  1 check(s) failed
```

**problems:**
1. command shows `--mode apply`, not `--retry`
2. no "rerun triggered" message (compare to [t0] which has it)
3. output shows a failure watch, not a retry action

**expected:** output should show `--retry` command and "rerun triggered" for the failed workflow.

---

## summary

| snapshot | issue | count |
|----------|-------|-------|
| p2 | hint contradicts state | 1 |
| p1 | wrong command + no retry | 1 |
| **total** | | **2** |

## verified correct

- p1: 30 test cases verified
- p2: 52 test cases verified
- retry test [case-retry-failed-pr] [t0] now shows "rerun triggered" (fixed from prior review)
