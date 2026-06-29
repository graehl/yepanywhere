# Session Page Request Dedupe

Status: Public-share status dedupe implemented 2026-06-29.
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

`useServerSettings` has now moved onto a source-keyed retained query with a
small shared settings snapshot store. That should remove the repeated
`/api/settings` requests from shell/session/settings consumers without adding
polling.

The next step is a browser-level network smoke test or manual checklist for a
session page reload on `https://localhost:3400`, with request counts grouped by
method, path, query string, and initiator. That will separate remaining true
duplicates from distinct collection/detail requests that look similar in the
Network name column.

## Request Census

A lightweight Playwright counter now lives at:

```bash
pnpm --filter client request:census -- --url 'https://127.0.0.1:3400/projects/L1VzZXJzL2tncmFlaGwvY29kZS95ZXBhbnl3aGVyZQ/sessions/019f1250-a644-7970-bb90-a7ea07f2b4ca'
```

Use `--json` when a machine-readable result is easier to diff.

Observed on 2026-06-29 after an 8s post-DOMContentLoaded window:

- 19 grouped same-origin API keys.
- `GET /api/public-shares/status` is now a single request after moving
  `usePublicShareStatus` onto a retained query with one source-level poll
  owner.
- 3 duplicate full API keys remain:
  - `GET /api/settings` twice. This is no longer just multiple
    `useServerSettings` consumers; the dev service-worker registration gate
    also calls `api.getServerSettings()` outside the retained hook.
  - `GET /api/dev/status` twice. `useReloadNotifications` performs an initial
    dev-status read and then a near-immediate server sync path.
  - `GET /api/inbox` three times in the 8s window. The first request is initial
    load; later requests are delayed retained refreshes from live activity.
    This one needs classification before changing behavior, because Inbox is
    intentionally a live collection.
- The high-value collection feeds are no longer duplicated in this smoke:
  `/api/project-queue`, `/api/projects`, the project detail, session detail,
  and each distinct `/api/sessions?...` feed each appeared once.

Likely next cleanup order:

1. Share the dev service-worker settings gate with the server-settings retained
   snapshot, or move that gate behind an app-level settings read.
2. Classify the delayed Inbox refresh and decide whether it represents useful
   live catch-up or an avoidable initial-load event.
3. Coalesce `useReloadNotifications` dev-status reads. This is dev-only, so it
   is lower user-impact than the public-share/status path.
