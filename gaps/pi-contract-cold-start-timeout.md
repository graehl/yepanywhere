# Installed Pi contract times out under full-suite load

`packages/server/test/e2e/pi-contract.e2e.test.ts` gives the installed Pi
CLI 10 seconds to answer `--version` on non-Windows hosts. In the full
workspace unit suite it exceeded that deadline and failed after 10.1 seconds;
an immediate isolated rerun passed in 7.4 seconds.

This was not fixed alongside unrelated provider-reader review findings because
raising the timeout without characterizing cold-start variance could conceal a
real Pi startup regression. A fix should measure loaded and isolated startup,
then give this external-runtime contract an evidence-backed deadline or move
the version probe out of the suite's peak contention window.

Found 2026-09-04 while verifying harsh-review findings HR-1, HR-2, HR-4, and
HR-5.
