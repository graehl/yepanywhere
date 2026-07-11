# clientSummaryStore draft-decoration test fails when run standalone

`packages/client/src/lib/__tests__/clientSummaryStore.test.tsx` › "scans
draft decorations through mounted source runtimes" asserts
`vi.getTimerCount()` === 2 but sees 6 when the file runs standalone
(`pnpm vitest --environment jsdom <file> --run`) or in small ad-hoc
groupings. The same test passes in the full client suite (`pnpm test`),
so the assertion depends on global timer state other suite files happen
to establish.

Observed 2026-07-11 on main at fcaa9fcb (fails identically with no
local changes). Fix direction: count only the timers the test itself
creates (snapshot-and-diff around the scan) or isolate the module-level
intervals it inherits, rather than asserting an absolute global count.
