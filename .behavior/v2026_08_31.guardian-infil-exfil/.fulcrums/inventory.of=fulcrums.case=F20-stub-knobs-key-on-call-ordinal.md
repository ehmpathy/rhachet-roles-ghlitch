# F20 — the stub's break knobs key on the call ordinal

## the fork

a peer notes that `STUB_BIND_GET_FAIL_ON=4` (and its `EMPTY_ON` / `FOREIGN_ON` peers) break the Nth
`rhx route.bind.get` call, so a probe added or removed upstream would re-aim the break.

- (a) key each knob on call identity (a phase marker per call, or the argv), or assert the call log
- (b) keep the ordinal; let the snapshot each case pins catch a re-aimed break

## taken, and why

(b). `route.bind.get` takes no argv that tells its calls apart, so an identity key needs a phase
marker threaded through the product code for the test's sake alone. every case that sets a knob
asserts the exact halt text it expects and snaps the whole render; a break that lands on another
call produces another render, so the case reddens by name. the knob comment in the stub names the
call order the cases rely on.

## rework

clean. a `STUB_BIND_GET_LOG` the stub appends to, and one `expect(calls)` per knob case.

## confidence

80%. the 20% is whether the council wants the call log asserted for clarity even though the
snapshots already redden on a drift.

## where

- `src/domain.roles/guardian/skills/.test/stub.bin/rhx` (the get-call knobs)
- `src/domain.roles/guardian/skills/security.habitat.redteam.integration.test.ts` (`[case30]`, `[case31]`)

## verdict once ruled

_(awaits council)_
