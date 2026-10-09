# Some starred sessions are missing when opening a new tab

The maintainer reports many missing starred items after loading a tab, perhaps
older than 24 hours, while New Session startup work is in progress. Preserve
the report; the cause is not established and no session metadata was changed
during diagnosis.

On 2026-10-09, live retained and complete `/api/sessions?starred=true&limit=200`
reads returned the same 24 session IDs, with `hasMore=false`; 20 were older
than 24 hours. A fresh Chromium tab at `/new-session` rendered all 24. Including
archived sessions returned 31, of which seven were archived. These checks do
not prove that the user's expected sessions are present: both list paths could
omit an expected record, or the affected browser could differ from the fresh
profile. One missing session example was requested to distinguish those cases.

The 24-hour cutoff in `useSidebarSessionOrder` groups ordinary sessions under
Recent or Older; Starred is independently ordered without that cutoff.
`useSidebarSessionFeeds` acquires a separate starred collection. The interaction
hold intentionally defers incoming rows while pointer or keyboard interaction
is active; investigate whether that explains the affected browser before
changing its stability contract in `topics/sidebar-session-ordering.md`.
Retained collection completeness is governed by
`topics/session-catalog-observation.md`.

Found 2026-10-09 while investigating New Session tab boot latency.
Contributing-model: 6-astra.
