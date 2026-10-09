# Broker tests lose the SQLite export during parallel verification

During quick verification on 2026-10-09, all 21 database-dependent push-broker
cases failed with `TypeError: openSqliteOrThrow is not a function`. The unchanged
broker suite passed immediately afterward when run alone (45 tests).

`packages/push-broker/src/db.ts` imports
`@yep-anywhere/shared/sqlite`, whose default export condition resolves to
`packages/shared/dist/sqlite.js`. The broker's Vitest configuration does not
select source files. Root `pnpm typecheck` rebuilds that same shared output,
while `verify.toml` permits typecheck and tests to run concurrently. The
emitted SQLite file's modification time fell inside the failing test run;
afterward both source and emitted file exported the expected function.

Concurrent build/read is the leading hypothesis, not a reproduced cause yet.
Verify it with a controlled concurrent run before choosing source resolution,
isolated build outputs or check serialization. Do not replace SQLite or soften
database assertions to hide the missing export. Running tests after typecheck
avoids this overlap for the current verification.

Found 2026-10-09 while checking New Session provider display persistence.
Contributing-model: 6-astra.
