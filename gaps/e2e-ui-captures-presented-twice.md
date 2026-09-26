# E2E UI captures are presented twice and the second write fails the run

`presentUiCaptures()` (`packages/client/e2e/support/ui-capture.ts`) is called
from `e2e/global-teardown.ts` and also from the `afterAll` of
`artifact-viewer.spec.ts`, `shell-poll-rows.spec.ts` and
`provider-host-live.spec.ts`. With `YEP_E2E_UI_CAPTURE_DIR` set, the spec's call
writes `preview-<second>/capture.json`; the teardown call in the same second
picks the same directory name and `writeCapturePreview` refuses to overwrite it
(`EEXIST`). Playwright then reports "1 error was not a part of any test" and
exits 1 although every test passed and the captures were already presented.

Not fixed in place because it was found while landing an unrelated
harsh-review item.

Cheap fix: make global teardown the one presenter, per `topics/ui-testing.md`
("global teardown then presents the whole run"), by removing the per-spec
`afterAll` calls; or make `presentUiCaptures` present a manifest only once.

Found 2026-09-26 while capturing the artifact PDF hand-off page for
harsh-review F8.
