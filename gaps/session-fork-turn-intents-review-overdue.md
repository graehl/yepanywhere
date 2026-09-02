# Session fork-turn capability review is overdue

`packages/shared/src/server-capabilities.ts` marks
`session-fork-turn-intents` for review after 2026-09-01, so
`pnpm capabilities:audit` now emits a warning on every run. The review must
recheck the optional hosted-client support corpus and obtain Maintainer
approval before removing either the client gate or server advertisement; that
compatibility decision is unrelated to the Codex plan-tool provider setting
and was not made in place.

Found 2026-09-02 while adding the Codex plan-tool provider setting.
