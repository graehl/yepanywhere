# Four local browser failures remain after startup verification

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
