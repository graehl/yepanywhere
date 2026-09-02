# Blockwise Codex history needs full verification

The configurable initial-history window and source-byte-backed Codex tail/page
reader are implemented, but this landing used a user-directed minimal test pass.
The focused new cases passed; the following broader checks remain for the review
session:

- Review the complete diff, especially source-cursor validation and the route
  invariants in `packages/server/src/sessions/normalization.ts`,
  `packages/server/src/sessions/codex-reader.ts`, and
  `packages/server/src/routes/sessions.ts`.
- Run the complete focused files without test-name filters:
  `packages/server/test/sessions/codex-reader-oss.test.ts`,
  `packages/server/test/routes/sessions-metadata.test.ts`,
  `packages/client/src/hooks/__tests__/useSessionMessages.cache.test.tsx`,
  `packages/client/src/hooks/__tests__/useSessionPerformanceSettings.test.ts`,
  `packages/client/src/pages/settings/__tests__/PerformanceSettings.test.tsx`,
  and
  `packages/client/src/lib/sessionDetail/__tests__/sessionDetailStore.test.ts`.
- Run `pnpm lint`, `pnpm format:check`, `pnpm typecheck`,
  `pnpm console:scan`, and the non-Android `pnpm test` with this host's required
  newer GCC runtime prefix. If the full route file again fails only
  `reserves the project until provider startup settles`, determine whether its
  one-second wait is the existing identity-resolution timing failure.
- After the user restarts the shared server, open the original
  538,524,921-byte rollout and exercise initial history plus repeated Load older
  and older-history search pages. Confirm valid cursors stay blockwise and that
  legacy, stale, and compressed-rollout cursors use the complete-reader
  fallback.
- Inspect the existing Performance settings captures at 1000x600 and 375x812
  under `.artifacts/ui-testing/2026-09-02-initial-session-history/`; the current
  pass confirmed the route and controls but did not complete an independent
  layout review.

Found 2026-09-02 while landing configurable blockwise Codex history with a
user-directed minimal verification pass.
