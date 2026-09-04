# Multi-host E2E setup times out under full-suite load

`packages/client/e2e/multi-host-secure-coexistence.spec.ts` gives each mode's
shared relay harness 15 seconds to start. The full browser suite timed out both
the legacy and mux `beforeAll` hooks before any cases ran. An immediate isolated
rerun passed all 14 cases, with the two setup paths taking 13.4 and 13.6 seconds.
An earlier verification run also observed this only in the full suite.

This was not fixed alongside unrelated review findings because simply raising
the timeout would hide the setup's narrow margin. A fix should identify the
contended startup step or establish an evidence-backed setup deadline that is
stable under the supported full-suite workload.

Found 2026-09-04 while running full-suite verification.
