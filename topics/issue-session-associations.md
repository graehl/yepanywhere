# Issues and PRs associated with sessions

Topic: issue-session-associations

Implemented: 2026-09-10. Experimental and default off.

## User contract

Enable **Settings → Issues & PRs** on a server with ready SQLite. The sidebar
then exposes issue search, and session headers link to their associated issues.
One glyph stands for the feature in the settings list, the sidebar and that
header link; the settings list carries it in every selectable icon style.
Ordinary authenticated session viewing automatically captures references from
persisted user/assistant text already delivered by the session route, including
incremental updates and older pages. Manual linking is not an admission step.
Public shares neither trigger capture nor receive these records.

The default scope is **Viewed session windows**. **Sessions active recently**
additionally indexes sessions whose catalog activity is within a configurable
1–90 days, default 7. This selects sessions, not individual message dates: an
eligible session's history can contain older messages. Viewed older sessions can
still contribute their viewed windows. Background readers currently support
Claude and Codex; other providers retain viewed-window capture where persisted
normalized text is available. Compressed Codex sources cannot be read by this
background adapter.

Search uses literal, case-insensitive substrings of stored keys, URLs and titles.
Pasting a full URL finds its canonical record. Search and evidence pages default
to 50 rows and accept at most 100. Project/session filters apply before the limit.
The browser content scrolls vertically within the app while its page header
remains visible. Long result lists, pagination controls, and association evidence
remain reachable at desktop and phone widths. Controls and evidence cards use the
app theme colors, typography and focus states. Results occupy the available width
until an issue is selected. Desktop shows issues beside their associated
sessions; phone shows the selected issue's sessions, with the close control
returning to the issue list. An active issue-title/link editor remains visible
in the list on phones.

A shared ticket glyph identifies Issues & PRs in the sidebar, settings category
(including emoji icon mode), and the session header. The session shortcut is a
compact icon button carrying that glyph and its count at every width; the
feature name lives in its tooltip and accessible name rather than in a
word-wide chip, and a phone keeps a 44-pixel touch target. Discovery settings
use the standard searchable settings rows and toggle, with scope guidance above
the control.
Bare Jira keys require a known project prefix by default. Unknown bare keys are
retained as inactive candidates, without creating an issue/session link or
appearing in search or session counts. **Match unknown ticket keys** is an
explicit opt-in that exposes these candidates as references with **Issue link
unknown**. Their issue menu accepts a matching full URL through **Add issue link**. Markdown labels
supply observed titles; a user can override a resolved item's title. Discovery
itself makes no tracker request and changes no external issue; the only
outbound requests come from the opt-in confirmation step below.

Coverage distinguishes viewed windows, queued/indexing, indexed, partial,
unsupported, failed and outside-scope jobs. Counts describe acquired sources,
not the whole transcript corpus. Empty search results explicitly refer to indexed
content. The page refreshes while its worker is active; there is no idle global
client poll. Refresh reloads results, rather than forcing a full scan.

The session header button carries the count of that session's undismissed
associations, read from one page of the same search route, so more than a full
page reads as `100+`. That count also says in advance how many rows the button
opens: pressing it opens a menu built from the page already read, so the menu
costs no further request and the session stays on screen. At most twelve
references are listed, newest page order, with a note naming how many more the
full list holds and a final row that opens that list filtered to this session.
Each row links at its tracker URL when one is known and at the same filtered
list otherwise, so a left click follows the reference and a middle or
modifier click opens it in a new tab. Hovering or focusing a row describes it
before the click: full title, key, provider, kind, how many sessions mention
it, whether its tracker context is still unresolved, and where the click
leads. Because indexing this session's own text starts when the
session is opened, the first answer usually predates it: the header asks again
a bounded number of times, sooner while the server reports active indexing, and
restarts that sequence when the transcript grows. It then stops rather than
polling. A count the server does not currently confirm shows no badge at all,
so the number on screen is one the client actually read, and a later
association can go unnoticed until the session is reopened or extended.

## Learned Jira projects and matching rules

A supported absolute Jira browse URL in persisted user/assistant message text
teaches its ticket prefix and canonical site/context path automatically, without
an external request. For example, `https://tomfit.atlassian.net/browse/TF-3996`
teaches `TF → https://tomfit.atlassian.net`. Query strings, fragments and URL
credentials never enter a mapping. Tool-call commands/arguments, tool output,
reasoning, and setup remain excluded. Command-only tool evidence is deferred.

Mappings persist in `jira_project_sites`, independently of the originating
session or issue. Settings lists the learned prefix/site pairs. One known site
for a prefix applies across this server's code projects and sessions. Multiple
sites stay distinct: exactly one learned site in the current code project can
resolve a bare key; otherwise it remains ambiguous. Explicit URLs always retain
their own site. No personal Jira site is hardcoded.

The existing editable prefix blocklist excludes bare-key matches, including old
ones and learned prefixes, but never explicit URLs. Confirmed manual association
decisions remain authoritative. Aggressive matching defaults off for both new
and existing installations lacking an explicit setting; the feature itself
remains experimental/default-off. Turning aggressive matching off hides unknown
candidates immediately. Changing exclusions or learning a mapping reconciles
stored candidates in bounded batches, preserving titles, occurrences and explicit
dismissals. Restoring an association explicitly clears occurrence suppression.

Migration 7 adds the mapping table and a durable `issue_registry_work` cursor.
It schedules work only: the existing worker first learns from stored URL/manual
evidence, then resolves candidates, in transactions of at most 25 evidence rows
with a yield between turns. Restart resumes the cursor. No provider reads or
large backfill occur in migration initialization. Rule changes coalesce into
that worker; unchanged sources and idle clients introduce no recurring work.

## Associated-session browser

The issue list defaults to **Recent session activity**: the latest retained
catalog activity among sessions with visible evidence for that issue.
**Recently mentioned** instead uses the latest source-message timestamp, so
indexing an old conversation today does not make it a recent mention.
**Issue number ↑** groups by tracker and project/repository key, then orders
numbers numerically (9, 10, 100). Reference key and canonical identity break
ties; missing or invalid activity/mention timestamps sort last. Search,
project/session scope and dismissed filtering apply before aggregation and
pagination. Refresh reads the current catalog; sorting adds no idle polling,
transcript reads, durable activity copies or migrations.

Each row keeps its key in the identity line, next to a colored Jira, GitHub
issue, or GitHub PR badge; unknown GitHub types say GitHub reference. Type icons
and labels carry the distinction without relying on color. Colors never claim
open, closed or merged state. A title, when available and distinct from the
key, occupies its own line. Session count and the chosen recency basis sit
below it; number order shows session activity. Unknown times are explicit.

`GET /api/issues` advertises `supportedSorts` and echoes `sort`, with additive
`lastSessionActivityAt` and `lastMentionAt` on items. Clients learn support from
the first ordinary search response before sending a sort parameter. Earlier
experimental servers without this advertisement retain **Reference key A–Z**
and get no sorting parameter; omitted sort preserves the legacy wire order.
Each issue's overflow
menu owns display-title editing, adding a missing issue URL, and deleting the
saved item. A cleared display override falls back to its observed title, then key.
Coverage counts and the dismissed-association filter live in a collapsed discovery
disclosure. Ordinary browsing does not require confirming or dismissing items.

The right pane renders one row per distinct canonical YA session, reusing the
sidebar's compact `SessionListItem` and shared themed hover detail. Navigation
and Native tooltip preferences retain the shared row behavior. Association
corrections live in a per-session overflow menu; a correction affects the whole
issue/session relationship, not one displayed mention. Per-occurrence correction
and tool evidence remain deferred.

**Last activity ↓** is the default, using the retained session catalog's activity
timestamp (including agent activity), not indexing or mention insertion time.
**Last activity ↑** reverses the known timestamps. Unknown activity sorts last in
both directions; canonical session ID breaks ties. Rows display the activity age,
or explicitly say the activity time is unavailable. This differs deliberately
from the sidebar's browser-local visits/submissions chronology. Refresh reloads
the ordering; background agent output does not continuously reorder this pane.

`GET /api/issues/sessions` groups and sorts before pagination (50 sessions by
default, maximum 100). It loads source summaries only for the returned page and
returns one initial mention per session. Mentions sort by source-message time,
then occurrence ID; unknown source times follow dated mentions in occurrence
order. Expand loads further mentions through session-filtered
`GET /api/issues/evidence`, in bounded pages. Collapsing preserves loaded mentions.
Dismissed evidence stays hidden unless the filter includes it. Unavailable source
sessions keep historical excerpts but have no navigation or preview request.
Selections, expansions and asynchronous responses belong to the selected source;
switching servers or issues cannot append an earlier source's evidence.

## Tracker confirmation

Shape alone cannot separate a bare Jira key from ordinary prose: `UTF-8`,
`ISO-8601`, `COVID-19`, `RFC-2119` and `SHA-256` all match the pattern. Two
defences need no network. A Jira project key is at least two characters, which
excludes `H-1` structurally. `jiraKeyBlocklist` names project parts to ignore,
prefilled with the common offenders and editable to any list, including none.
Blocking applies only to keys seen without a URL, so a tracker whose real
project key is on the list keeps working through browse links.

**Settings → Issues & PRs** then offers opt-in confirmation, off by default:
turning it on is what authorizes an outbound request carrying a credential.
With it on, a reference seen for the first time gets exactly one lookup, GitHub
by repository and number and Jira by key against the configured site and
account email. A confirmed reference gains the tracker's own summary, the first
title that does not depend on someone having written a Markdown link. A missing
item is recorded as rejected, and a failed or unauthorized lookup as
unreachable.

One question per reference is the whole retry policy, and it lives in the
schema rather than in a scheduler. `issue_confirmations` takes a pending row
when a reference is first captured, and only while confirmation is on, so
enabling the feature never sets a backlog loose. The insert ignores conflicts,
so a reference holding any verdict, unreachable included, is never asked about
again by itself. Nothing polls. `POST /api/issues/confirm` is the only second
question and belongs to an explicit user action. Verdicts are per project, and
the most decisive one wins across projects: one project confirming a key
settles it even if another recorded only an outage.

Credentials resolve from a key stored in Settings, then environment variables
(`YEP_GITHUB_TOKEN`, `GITHUB_TOKEN`, `GH_TOKEN`; `YEP_JIRA_API_TOKEN`,
`JIRA_API_TOKEN`, `ATLASSIAN_API_TOKEN`), then, for GitHub, the signed-in `gh`
CLI. The settings pane names every source and says whether it is present; no
route returns a key to a client. Stored keys are written to
`{dataDir}/issue-credentials.json` with owner-only permissions rather than into
server settings, which the settings route hands to any authenticated client.
Both credential routes stay reachable while discovery is off, so an
installation can be configured before it is turned on.

## Identity and evidence

`services/issues/extract.ts` recognizes Jira browse URLs and uppercase Jira keys,
GitHub issue/PR URLs, and repository-qualified `owner/repo#123` references.
A bare `#123` needs explicit issue/PR wording and exactly one GitHub repository
URL in the same bounded text window. Arbitrary bare numbers are ignored. Generic
Jira deployments may have context paths. GitHub Enterprise issue paths are
recognized on `github.*` hosts; `/pull/N` URLs also identify PRs on other hosts.

Canonical identities include the host and Jira context path or GitHub repository.
GitHub issue and PR URLs for the same repository/number share identity; discovering
a PR cannot subsequently downgrade its kind. Credentials are rejected. URL
tracking/query/fragment payloads are removed from saved URLs and excerpts.

Unknown candidates are grouped by current observed project plus key, not globally.
Jira prefix/site learning follows the rules above. Repository-qualified GitHub
references retain the existing exact-reference resolution within a code project.
A second matching GitHub identity restores ambiguity for inferred, unconfirmed
observations. Confirmed decisions remain authoritative. Contextual bare-number
observations record their repository-based provenance separately from a seen
issue URL. This is evidence of mention, never proof that work was completed.

Three domain tables in `{dataDir}/discovery.sqlite` own durable state:

- `external_issues`: canonical identity, URL, provider/kind, observed and manual
  titles. An observed title comes from a descriptive Markdown link label;
  `manual_title` is an independently retained override.
- `session_issue_links`: unique issue/canonical-YA-session association with
  discovered, confirmed or dismissed state and decision time.
- `session_issue_evidence`: source/project, stable occurrence, reference, source
  locator, bounded excerpt, observed/source times and extractor version. Its
  link may be null until identity resolves. Evidence kinds distinguish URL,
  ticket key, contextual number and manual correction.

Distinct repeated mentions survive. Redelivering the same persisted occurrence
does not duplicate it. Codex source locators use rollout ordinal/byte provenance
through normalization rather than response-array indices. Dismissed associations
remain dismissed on new observations; unresolved suppression also survives
resolution. Restore is explicit. Remaps union evidence and preserve the latest
explicit decision, with dismissal winning equal-time ties. Current working-project
metadata updates evidence navigation independently of transcript storage location.
Missing source sessions keep their historical evidence and display unavailable.
Navigation opens the source session; exact-message deep links are not exposed.

Deletion removes the selected saved item and its links/evidence. It aborts buffered
work, and source-version receipts prevent the same background snapshot from
immediately recreating it. A later changed source or a new viewed-window observation
may rediscover it, as the deletion UI explains. Disabling or aging out of a recent
window preserves all existing metadata. No automatic retention expiry or local
browser fallback exists. No project files, Git metadata or YA refs are written.

## Acquisition and lifecycle

`IssueIndexer` owns one fair recent worker and a durable SQLite queue. It admits
catalog rows from the existing retained catalog, yielding after each 100 rows;
metadata enumeration is replayable/idempotent after restart, and every admitted
candidate is durable. It does not retain a separate unbounded candidate array or
reparse unchanged cold transcripts on a timer. At most 16 jobs are fetched into a
worker batch. Settings, catalog and completed-session signals drive admission.
An unchanged failed source is not retried by an endless loop; a changed source
version permits another attempt.

A republished catalog that has not changed costs nothing. Admission is keyed
to the publication's epoch and generation, so the sweep that already covered
that pair returns immediately rather than re-walking an identical corpus, which
matters because an active server republishes every few seconds. A caller with
its own reason to sweep — a settings change, a session-id remap — is not keyed
and always runs, and only a sweep that ran to completion retires its mark, so
an aborted one is repeated rather than assumed.

A catalog sweep costs write transactions only for sessions whose working
project actually moved. Ownership can change only for a session that already
has a job or evidence row, so one read names that set before the sweep begins
and every other candidate is skipped without opening a transaction. The
observable requirement is that admitting an unchanged catalog of any size
performs no writes: SQLite takes a file lock per transaction, and an idle
server was previously taking roughly one lock per known session per catalog
publication, which is fatal on the network filesystems
[optional SQLite](optional-sqlite.md) now refuses.

Provider-owned acquisition uses 64 KiB reads, an 8 MiB/2,000-record batch budget,
a 30-second acquisition deadline and a 1 MiB individual JSONL record limit.
Oversized/malformed records leave partial coverage. Codex lineage traversal is
limited to 32 segments. Cursor state tracks source position, lineage layout,
file identity, modification and a boundary hash. Appends resume; detected rewrites
reset acquisition without erasing historical evidence. Batch limits yield and
requeue automatically. Provider readers never fall back to full-transcript reads.

Viewed windows add no file read. Their retained text budget is 8 MiB across up to
16 pending windows, inspecting at most 16,000 normalized records per admission;
overflow reports partial coverage. Extraction yields between 32 KiB text windows
with 4 KiB overlap. Transactions handle at most 25 observations or resolution rows
per batch; large project-key resolution runs through a durable continuation queue.
Settings changes, deletion, remaps and shutdown abort stale generations. Closing
the final view releases the existing session-view demand; this feature adds no
independent tail watcher or recurring per-session task.

Operational tables `issue_index_jobs`, `issue_resolution_jobs`,
`issue_deleted_snapshots` and `issue_confirmations` retain checkpoints,
resolution continuations, deletion fences and tracker verdicts. `issue_registry_work`
owns the bounded mapping/candidate reconciliation pass. SQL statements finalize; startup migrations do no provider acquisition.
Storage errors do not acknowledge unsaved writes or become successful empty lists.
The server owns disposal and awaits indexing before closing its database.

## Compatibility and migrations

The approved optional-feature review covered v0.8.0 (2026-08-31) and v0.8.1
(2026-09-05), the latest two stable releases and all stable releases in the
preceding 14 days on 2026-09-10. Sparse optional capability
`issue-session-associations-v1` (permanent ID 68) covers:

- `GET /api/issues`, `GET /api/issues/evidence`, `GET /api/issues/sessions`;
- `GET /api/issues/settings`, `PUT /api/issues/settings`;
- `GET /api/issues/credentials`, `PUT /api/issues/credentials`;
- `POST /api/issues/decision`, `POST /api/issues/resolve`;
- `POST /api/issues/confirm`;
- `PATCH /api/issues/item`, `DELETE /api/issues/item`.

The shared settings service persists `issueAssociations: { enabled, scope,
recentDays }`. The bit requires ready SQLite and the installed indexing owner,
independently of opt-in; data routes also require enablement and ordinary app
authorization. Without it clients hide all controls and make no issue requests.
The Issues & PRs sidebar and direct page links open `/issues` locally and in
direct remote mode, or `/-/relay/:relayUsername/issues` in relay mode (beneath
the hosted client base when configured). Refresh preserves the issue browser
and its session/project scope; these routes must not fall back to Projects.
Selections and requests belong to the current source runtime; switching servers
remounts the browser before another server can receive the previous selection.
No existing capability meaning or protocol floor changes. This unpublished v1
contract can evolve before release; released peers require normal compatibility
review for subsequent changes.

[SQLite storage](optional-sqlite.md) owns migration policy. Frozen historical
v2/v3 SQL moved out of the mutable vocabulary schema. Migration 4 adds the domain
and indexing tables; migration 5 adds resolution/deletion continuations;
migration 6 adds the one-verdict-per-reference confirmation table; migration 7
adds durable Jira project mappings and resumable reconciliation. Prefix
fixtures test fresh installation, each historical upgrade, repeat initialization,
rollback and old-reader refusal. No down migrations, resets, WAL switch or longer
lock timeout were added. An older binary refusing the newer discovery schema
also loses its discovery-gated speech capabilities; separate speech files remain
untouched. Use a newer binary or explicitly restore a consistent older backup.

## Boundaries and references

Deferred: branch/worktree inference (including YA Workstreams), Git/commit
attribution, tracker synchronization, remote snapshots, semantic matching,
tool-output mining and multi-server aggregation. Credentials are now used, but
only to ask whether a reference exists: YA writes nothing to a tracker, mirrors
no tracker state, and makes no request for a reference it has already asked
about. This feature does not
close the [cold-storage startup gap](../gaps/sqlite-backed-cold-storage-startup.md),
[commit attribution gap](../gaps/committed-change-session-attribution.md) or
[worktree identity gap](../gaps/session-worktree-file-links.md).

T3 reference: `~/github/t3code` at `d29c56a5c`, inspected 2026-09-10.
`ThreadPullRequestReactor` correlates saved branch/worktree context with remote PRs;
`linkCreatedPullRequest` and the PR MCP handler supply explicit producers.
`ProjectionThreadPullRequests` retains association source and cached snapshot/stack
JSON. T3's numbered migrations and durable dismissal inspired this implementation;
YA's initial producer is visible session text and needs no YA Workstream or remote
credentials. The retired tactical 125 plan and independent Opus review are retained
in Git history under this topic's commit series.

Validation owners:
`test/storage/{issues,issue-indexing,issue-routes,issue-credentials,issue-confirmation}.test.ts`,
`client/src/pages/settings/__tests__/IssueSettings.test.tsx`,
`client/src/components/__tests__/SessionIssuesLink.test.tsx` and
`client/e2e/{issue-associations,issues-scroll,remote-issues}.spec.ts`, plus
packaged SQLite runtime checks. Remote navigation coverage uses the production
client bundle. The GitHub confirmation path was also exercised against the live
API with a real credential; the Jira path is covered against a stub.
