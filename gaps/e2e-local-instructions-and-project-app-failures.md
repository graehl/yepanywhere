# Local instruction and App browser checks fail during broad verification

The 2026-10-09 full local browser run at 9e28d165f (one worker, no retries)
passed 389 cases, skipped ten and failed eleven. Seven startup/provider and
compatibility fixture failures were repaired and pass focused reruns. These
four remaining failures were outside the New Session acquisition changes:

- `packages/client/e2e/limited-instructions.spec.ts`: the first shared
  instruction textbox was absent on the component fixture page.
- `packages/client/e2e/project-app.spec.ts`: Live preview did not receive its
  `/app/start` response within five seconds.
- The app-inventory case could not find the `canvas` app button.
- The phone App case failed its setup because sandbox status was
  `probe-failed`, rather than `available` with `bubblewrap`.

The app failures may share the unavailable sandbox, but that attribution is
unproved. This run also logged a Vite dependency-scan error for a component
fixture; inspect the retained stderr before attributing the instruction case.
No assertion or timeout was relaxed. The run's teardown and process sweep
completed cleanly. The separate relay check and final quick checks passed.

These are distinct from the previously reported
[App pane handoff failure](project-app-session-handoff-misses-pane-in-ci.md),
which reached a new session but lost its iframe. Reproduce these four cases
with their isolated fixtures before changing application behavior.

Found 2026-10-09 during New Session startup regression verification.
Contributing-model: 6-astra.

## Recheck 2026-10-10

At `debb025bb`, the full browser run passed 392, skipped ten and failed ten.
The initial shared instruction textbox and `canvas` app-inventory button were
again absent. The earlier Live preview and phone sandbox cases passed this
time; their previous failures remain intermittent and unexplained.

An additional failure in `packages/client/e2e/session-right-pane.spec.ts`,
“Apps saves on defocus without losing typing during a pending save”, reached
its desktop row geometry assertion: the measured row height was exactly 72 px,
while the assertion requires less than 72 px. No lost-keystroke assertion
failed. Inspect the rendered row and its intended density before changing the
layout or assertion; the boundary has not been relaxed.

Two legacy-server fixture failures from this same run were repaired separately:
the fixtures now emulate ordinary settings JSON instead of the new startup
bundle, preserving their mocked old version. Both focused reruns pass.
The other five failures are recorded in
[artifact viewer readiness](artifact-viewer-edit-mode-readiness.md).
The broad suite was not rerun after the test-only compatibility correction.

Local evidence: `packages/client/test-results/9ebe4732-5fad-49db-945a-f9ab17b547b5/`;
retained stdout/stderr: `/local/graehl/ya-boot/final-deep-browser.{out,err}`.
Attribution to production code versus fixture/dependency state is unresolved.
No timeouts or geometry expectations were weakened. Process sweeps were clean.
Contributing-model: 6-astra.
