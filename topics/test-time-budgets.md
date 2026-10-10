# Test time budgets

> How long a test is allowed to take, for tests whose subject is not speed:
> derived from measured runs on the slowest machine that runs them, never from
> this host. Covers vitest per-test timeouts and product timeouts a test
> constructs.

Topic: `test-time-budgets`

Read this before adding a timeout to a test, raising one after a CI failure, or
explaining a CI-only failure as a flake.

Before paying more time for a test, apply
[test value and CI cost](../docs/development/testing.md#test-value-and-ci-cost):
remove low-value cases or accelerate retained ones while preserving meaningful
regression and race detection. Initial implementation proof alone does not
justify permanent retention. A larger timeout is a reliability budget, not a
reduction in CI latency or runner load.

## A budget is measured, not guessed

CI runners are contended and several times slower than a development host, and
the gap is not a constant: the same test measured 34ms here, 1295ms and 2353ms
on CI runs that passed, and then exceeded 5000ms on a loaded runner. A budget
taken from local timing encodes the fastest machine anyone runs the suite on.

Set the allowed time to **2-4x the observed maximum**, where the observed
maximum includes the limit a run timed out at — a run killed at 5000ms is
evidence of "at least 5000ms", not of 4051ms, so the budget derives from 5000.
Where a longer horizon is worth the sampling, gather 20 or more runs with their
failure count and use judgment against that distribution instead.

Record the measurements in a comment beside the timeout. The next reader
raising it needs to know what was observed and where, not merely that someone
once thought the number too small.

## Prefer removing the dependence to widening it

A budget is only worth setting where elapsed time is part of what the test
asserts. Where it is not, the assertion usually names the wrong thing.

A check that kills a timed-out child and then accepts new work was written as
"the next run returns success", with the service constructed at a 100ms
timeout. That put a 100ms budget around a process spawn — 14-18ms here, past
100ms under CI load. The subject was that the killed child freed its slot, so
the assertion became "the next run is not refused for capacity", which no
machine's speed can change. The success path already had its own test at the
default budget.

So: widen a budget for work that is genuinely slow — disk, extraction,
subprocess startup, a sweep over hundreds of rows — and rewrite the assertion
when the clock was never the point.

## A CI-only failure is a finding until explained

"Flaky" describes an observation, not a cause, and a test that fails 10% of the
time on CI is a defect with a mechanism behind it. Read the failing run's log
and its uploaded artifacts — Playwright traces carry the requests, responses and
DOM snapshots a screenshot cannot — and name the mechanism before deciding what
to change. Two runs of the same tree disagreeing is a flake signal; two remotes
building the same tree agreeing is not, since they run identical code.
