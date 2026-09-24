# async-questions e2e spec fails intermittently

`packages/client/e2e/async-questions.spec.ts` ("async questions preserve
context, drafts, scroll and ordinary delivery") failed 2 of 4 local runs on
2026-09-24 at different assertions: the bottom-pinned scroll poll at line 268
(distance from bottom 4587, expected < 3) and a `toBeVisible` wait at line
785 (element not found). The other two runs passed unchanged, and the full
suite's other 310 tests passed alongside the first failure. Diagnose the
timing dependency; it stops `./publish.sh` at its verify stage.

Found 2026-09-24 during a publish of unrelated file viewer changes.
Contributing-model: opus-5.5
