# rule.forbid.test-coverage-regression

## severity: blocker

never remove tests because setup is hard. provision the setup correctly instead.

---

## .what

when a test fails due to absent infrastructure (credentials, keyrack, fixtures), fix the setup. never delete the test as a shortcut.

## .why

test deletion creates false confidence. the behavior is still untested - you just hid the failure.

## .how

when a test needs infrastructure:
1. understand what the test requires
2. provision it (genTempDir clone/symlink, keyrack.yml, env vars)
3. verify the test passes with correct setup

## .enforcement

test removal without replacement = blocker
