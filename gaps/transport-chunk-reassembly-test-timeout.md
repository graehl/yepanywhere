# Transport chunk reassembly assertion can exceed its test budget

`packages/shared/test/binary-framing.test.ts`, case "reassembles a message
larger than one physical chunk", exceeded its 5000 ms timeout during a full
quick verification on 2026-10-09. Vitest reported 5824 ms for the case. An
unchanged focused rerun passed in 2.21 s. The surrounding host was under
substantial CPU contention; this does not establish which part of the test
consumed the time.

The test constructs a payload spanning three frames and compares the
reassembled typed array with deep equality. Its contract is byte preservation,
not completion within five seconds. Profile construction, reassembly and the
assertion separately before choosing a byte-comparison change or a measured
budget under [test time budgets](../topics/test-time-budgets.md). Preserve the
full-size, multi-frame boundary and exact byte equality.

This shared transport test is outside the selected-provider cache change and
was left unchanged. The timeout is an observed verification defect, not proof
of a transport regression or of its absence.

Found 2026-10-09 while validating independent provider display snapshots.
Contributing-model: 6-astra.
