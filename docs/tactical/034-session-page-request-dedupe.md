# Session Page Request Dedupe

Status: First chunk implemented 2026-06-29.
Topic: client-query-controller

## Problem

Reloading a session page can show repeated same-endpoint requests in DevTools.
React StrictMode is disabled in the local client entrypoint, so these are not
expected StrictMode double effects.

Some apparent duplicates are distinct requests hidden by the Network name
column:

- `/api/sessions` may represent different query strings, such as global and
  starred session feeds.
- `/api/projects/:projectId` and
  `/api/projects/:projectId/sessions/:sessionId` share a visible prefix.
- `/api/sessions/:sessionId` is session detail, not a collection feed.

The real duplicate class is highly mounted live collection/config hooks that
share the same data requirement but do not share all request lifecycle paths.
`useRetainedClientQuery` already centralizes readiness, wake/reconnect, and
activity-bus revalidation, but forced revalidation currently bypasses compatible
in-flight requests. Multiple mounted hooks with the same retained key can
therefore fan out on refresh/reconnect even though a single request would cover
them.

## Constraints

- Do not reintroduce polling for live collection freshness.
- Phone wake, tab foreground, reconnect, and manual refresh must still
  revalidate retained views.
- Remote/secure clients must still wait for the secure connection before
  issuing REST requests.
- Query source and full query key remain part of the identity. A local host and
  a remote host must not share cache entries.
- Force should bypass a fresh cache entry, but it should not bypass a
  compatible in-flight request for the same source/key.

## First Chunk

Close the retained forced-revalidation fan-out first:

- make `ensureClientQuery(..., { force: true })` reuse compatible in-flight
  requests;
- keep force semantics for fresh cache entries when no compatible request is
  already running;
- let `ensureClientQuery` own the stale transition for a forced refetch, so
  several retained hook instances do not repeatedly bump stale versions while
  sharing the same request;
- prove the behavior with controller and retained-hook tests.

Acceptance:

- two retained hooks with the same source/key that receive the same refresh
  event issue one background request, not two;
- a forced request still refetches when only a fresh cache entry exists;
- a larger in-flight coverage request still satisfies a smaller forced request.

## Follow-Up

After this slice, migrate the obvious session-page duplicate config feed:
`useServerSettings`. That hook is mounted by several shell/session/settings
surfaces and still owns hook-local state plus background revalidation. Moving it
onto a source-keyed retained query should remove the repeated `/api/settings`
requests without adding polling.

Then add a browser-level network smoke test or manual checklist for a session
page reload on `https://localhost:3400`, with request counts grouped by method,
path, query string, and initiator.
