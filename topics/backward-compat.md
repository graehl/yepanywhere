# Backward compatibility decisions

Durable decisions for observable or persisted surfaces whose compatibility
handling is not obvious from the implementation alone.

Topic: backward-compat

## Decisions

2026-06-23 `session-metadata.json` — add optional transcript display objects in
schema version 2 while retaining all version-1 session metadata; the additive
migration preserves existing configured state, and interrupted generating
objects recover as errors because their in-memory jobs cannot survive restart.

2026-06-24 `PI_PATH` — rename the pi provider executable override to
`PI_EXECUTABLE` because the value is a full binary path, not a search directory;
keep `PI_PATH` as a startup-normalized legacy alias so existing launches still
resolve the same executable.

2026-07-03 `hasUnread` (REST session rows/detail) — compute unread from the
pre-recap-overlay `updatedAt` instead of the overlaid one, so a recap landing
never flips a fully-seen session unread; reverses the overlaid-freshness
choice in "Tighten recap overlay cursor and freshness handling" because a
YA-synthesized recap is derived viewer content, not new provider activity.

2026-07-04 `clientDefaults.sessionToolbarVisibility` /
`clientDefaults.sessionToolbarPriority` — replaced by a single
`clientDefaults.sessionToolbarPresence` map (`hidden` | narrowing tier) per
explicit direction that the toolbar data model carry no separate visibility
boolean; hiding forgets the prior tier. Stored state is folded in at load on
both sides (`ServerSettingsService.mergeLoadedClientDefaults`; client
localStorage migration in `useSessionToolbarPresence`), but the settings
PUT surface no longer accepts the legacy keys: a stale cached client sending
them gets 400 and logs a console warning until it picks up the new bundle.
Accept-and-translate was deliberately skipped as speculative scaffolding for
a transient skew.

2026-07-05 session-detail REST default / approval audit log — uncursored
`GET /api/projects/:projectId/sessions/:sessionId` now returns a
two-compaction tail unless `fullHistory=1` is explicit, and approval decision
logging now defaults off behind `approvalAuditLogEnabled`. The session-detail
flip is the server-side safety backstop for tactical 055/SPC-007: the current
client source API requires a bound or explicit full-history request and handles
pagination, while stale cached or out-of-repo clients that relied on the old
unbounded default now get a bounded window and must opt in to full history.
The audit-log flip favors privacy/explicit operator intent over implicit
security logging; older clients cannot enable it without the capability-gated
settings surface.
