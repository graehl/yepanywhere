# Viewer find landed with three failing e2e tests

The viewer find feature (`cbea1a2ca`, `082b4d83f`: Ctrl+F searches only the
focused viewer) was published at `2aa26f779` with these Playwright tests
failing, locally and in both repositories' CI `e2e-tests` job:

- `e2e/artifact-viewer.spec.ts` — "finds within a running artifact frame
  only, from its own Ctrl+F".
- `e2e/file-viewer-minimize.spec.ts` — "finds within the file viewer after a
  click in its content" (local run; not in the CI failure list).
- `e2e/file-browser.spec.ts` — "previews large HTML without an artifact
  service": the file viewer header now sets `data-actions-below`, so its
  actions wrap to a second row where the test expects one. The idle find
  field is meant to show only when the header has room on its first row
  (`topics/media-rendering-and-routing.md`), so either that room check or the
  test's expectation is wrong.

Nothing else touched these paths between the find commits and the failing
run; the PDF and publish-script changes published alongside do not render in
these tests' views.

Found 2026-09-25 by the post-publication checks of `publish.sh`.
