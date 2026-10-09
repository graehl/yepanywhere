# Reverse-search ArrowUp then Enter intermittently jumps to the wrong match

The client unit suite intermittently fails
`MessageList.search.test.tsx` → `Enter after arrowing to a match jumps like
clicking that match`. After the result counter changes from `2/2` to `1/2`,
Enter calls `scrollTo` with top `1232` rather than `332`: the geometry for the
second match rather than the first. Whether this is a production ordering
defect or a test timing defect is not established.

Observed during the 2026-10-09 full workspace verification of the New Session
provider primer. The three cases matching `Enter after arrowing` passed in
isolation; an unchanged full-suite rerun also passed. No transcript-search
implementation or test was changed in that slice. Those passes do not resolve
the intermittent mismatch.

Next diagnosis: repeat the specific test with its queued animation frames and
trace highlighted-result state versus the Enter handler's selected target.
Preserve the expected match; do not weaken the geometry assertion to either
result or add an arbitrary delay. This is outside the current New Session
startup change.

Found 2026-10-09 while verifying New Session provider acquisition.
Contributing-model: 6-astra.
