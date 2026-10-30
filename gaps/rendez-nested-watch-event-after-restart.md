# Nested rendez upload watcher intermittently misses a file after restart

An exploratory whole-server test run on macOS / Node 26.7.0 failed
`RendezWatchService.test.ts`'s nested-file scenario at the assertion that one
upload was delivered. The test stops and restarts the observer, replaces the
latest-session pointer with an unrouted directory, waits for pointer repair,
then creates two nested directories and renames a completed upload into them.
No delivery was observed within the existing eight-second wait.

The same case passes in an isolated Node 22.23.3 five-file run and in the full
Node 22 workspace suite. This does not establish whether the cause is runtime
watch behavior, restart readiness, load or an existing test race. No watcher
source or timeout was changed. Investigate event/subdirectory registration
and the repair-to-ready boundary if it recurs; preserve the actual nested
upload contract rather than masking it with a larger timeout.

Found 2026-10-26 while verifying the unrelated managed-checkout lane removal
in [plan 160](../docs/tactical/160-remove-managed-checkout-lanes.md).


2026-10-27: a full Node 22.23.3 workspace run during synthetic-heartbeat
removal missed the second delivery at line 364, after restarting the nested
observer and changing an already-observed file. The watcher source and test
were unchanged. An immediate isolated rerun passed all four runnable cases
in 5.97 s. This extends the evidence beyond Node 26; runtime alone does not
explain the restart/event-registration race. No timeout or assertion changed.

2026-10-30: the HTTP API bootstrap phase 3 whole-workspace run on macOS /
Node 26.7.0 again missed the second delivery at line 364 (1 observed, 2 expected).
The immediate isolated file rerun failed at the same assertion: 3 passed,
1 failed, 1 skipped, 12.83 s. This is not a passing isolated recheck. No watcher
source, assertion, retries or timeout changed. Evidence is retained in ignored
`tasks/http-api-v0/phase3-final-tests.log` and `phase3-rendez-recheck.log`.
