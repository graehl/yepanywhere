# Client unit suite emits unowned jsdom navigation diagnostics

The required workspace `pnpm test` run on 2026-10-30 passes, but its client
process prints two `Error: Not implemented: navigation (except hash changes)`
jsdom diagnostics. The asynchronous stacks end in
`HTMLHyperlinkElementUtils-impl.js` and a timer, without identifying the test
that activated the hyperlink. The captured run is
`tasks/http-api-v0/test.log` (local, gitignored); 661 client files and all
7,017 client tests passed.

The HTTP v0 change touches no client implementation or browser interaction.
No navigation diagnostic appears in its focused core/auth/storage run.
An unowned asynchronous event cannot safely be fixed by suppressing jsdom or
changing global link behavior in this server task. Locate the triggering test,
then prevent/replace only its irrelevant document navigation or move its real
navigation assertion to a browser boundary, preserving the intended behavior.

Found 2026-10-30 while implementing the isolated local HTTP v0 API.
