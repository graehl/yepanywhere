# Pre-existing failing test: TaskRenderer duplicate "Explore codebase" button

`packages/client/src/components/__tests__/TaskRenderer.test.tsx` (~line 408)
fails with testing-library `getMultipleElementsFoundError`:
`screen.getByRole("button", { name: /Explore codebase for refactoring/i })`
matches more than one element, so the click throws.

Pre-existing (fails on a clean checkout of `AgentContentContext.tsx`, i.e.
independent of the 2026-07-09 context-memoization change) — verified by
pathspec-stashing that file and re-running: 9 passed / 1 failed either way.

Likely cause: the fixture's task label now appears in two rendered spots
(e.g. the collapsed Task summary and an expanded sub-view), so the query is
under-specified. Fix by narrowing the query (scope to a container, or use
`getAllByRole` + index / a more specific accessible name), not by changing
component behavior — nothing suggests a real duplicate-button regression.

Out of scope for the transcript-idle-churn work that surfaced it.
