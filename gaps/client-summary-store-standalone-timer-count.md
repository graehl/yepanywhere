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

Same class, observed 2026-07-11 at 385767f0 when running
`packages/client/src/components` + `packages/client/src/lib/__tests__`
together (all pass in the full `pnpm --filter client test` run and fail
identically with no local changes): UserTurnNavigator "keeps search
previews near the active match", Task rendering "renders provider
reasoning result blocks as toggleable thinking", and five ReloadBanner
reload-confirmation cases. Ad-hoc vitest file groupings are not a
reliable regression signal for these; use the full package run.
