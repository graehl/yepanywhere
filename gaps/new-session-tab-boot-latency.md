# A new-session tab takes seconds to show what every open tab already knows

Priority: **top** (maintainer, 2026-09-30). Opening `/new-session` in a new
tab is a routine action. It must show the composer, the current provider,
model and effort selection, and the project selector at once, then fill in
detail lazily. Today each of those waits on a serial chain of requests to a
server that already holds, and other open tabs already display, the same
current state.

## Observed

Current acceptance (maintainer, 2026-10-09): **at most 3,000 ms** from new-tab
navigation to the real project/provider/model/effort UI. The maintainer raised
the threshold because this loaded system runs at approximately half normal
performance. The earlier 500 ms and 1,500 ms targets are superseded; historical
measurements below retain their original qualifications. The pre-boot textarea
alone never satisfies acceptance. Slow Settings new-tab opens are also in scope;
measure the populated settings controls separately from the shared app shell.
Frontend reloads remain user-initiated. Contributing-model: 6-astra.

On the maintainer's live dev server, about 1.5 s after opening
`/new-session?projectId=…` in a new tab the pre-boot composer (see
[early typing handoff](../topics/early-typing-handoff.md#pre-boot-composer))
is still standing in for the form. The real form arrives about 5 s later.
The sidebar session list, provider details and projects finish later still.

## Measured (isolated instance, 2026-09-30)

A throwaway `YEP_PROFILE` dev instance on this host, scanning the same
`~/.claude` and `~/.codex` transcripts, loaded with headless Chromium (warm
server, 1400×800). Times are from navigation start:

| Milestone | Form waits for project | Form does not wait |
| --- | --- | --- |
| Pre-boot composer focused | 12–15 ms | 12–15 ms |
| App shell rendered | 320–355 ms | 326–345 ms |
| First `/api` request (`/api/settings`) | 717–784 ms | same |
| `/api/providers` done | 809–908 ms | same |
| `/api/projects/:id` + `/api/recents` issued | 1123–1261 ms | same |
| Real composer focused (pre-boot adopted) | 1420–1566 ms | 1107–1284 ms |
| Provider name shown | 1440–1593 ms | 1229–1261 ms |
| Sidebar sessions loaded | 1533–1694 ms | 1280–2008 ms |

The second column is after the fix that lets the form take typing at once and
hold only Start until the selected project's record arrives. The remaining
chain on an unloaded server is:

1. About 700 ms of unbundled development-module loading before any request.
2. Bootstrap requests (`settings`, `auth/status`, `onboarding`, `version`,
   `settings` again), then `providers`, before the route renders.
3. About 300 ms more before the route issues its own requests: the lazy
   route chunk and first render.
4. The sidebar's four session-list requests and `/api/projects` start only
   after the route's `/api/projects/:id` and `/api/recents` complete (route
   bootstrap tier before navigation tier). The sidebar time varies with that.

A cold server (first load after restart) took 6.1 s for `/api/projects`,
6.6 s for `/api/recents` and once 11.6 s for `/api/providers`.

The live server is much slower than this instance. In the 27 minutes after
its 15:30 restart, the server log shows 169 Codex reader scans (mean 608 ms,
max 2.4 s, 103 s total) and 74 Codex scanner walks (mean 471 ms, max 4.6 s).
Event-loop delay reached 1.5 s (p99 about 71 ms). Each serial link above
waits behind that.

## Measured on the live server (2026-10-09)

Host at load average 16 on 16 cores. Headless Chromium, warm server:

- `/api/recents` took 6.6–11.5 s on every call. Resolved entries cost
  3–16 ms each; five entries that named no transcript cost 1–1.7 s each,
  since a miss searches every provider, Codex by a full rollout scan. They
  were provisional ids: a new session is opened, and its visit recorded,
  under the id the server assigns before the provider reports the real one.
  Fixed: recents follow `session-id-remapped`, and a listing prunes entries
  that resolve to nothing once they are ten minutes old (0.15 s after).
  Without a stored recent project the form shows No project until recents
  returns, since the default project comes from it.
- The form and sidebar commit together, when the lazy `NavigationLayout` and
  `NewSessionPage` modules load; until then both show the route `Suspense`
  fallback ("Loading…"). Holding `/api/sessions` 12 s delayed that by about
  1.6 s, and `/api/agent-auth-router/selection` by about 2.2 s; no request
  held it longer. My current model: on the unbundled dev origin, long-held
  requests (recents, the drafts long poll) occupy the browser's six HTTP/1.1
  connections that the hundreds of module requests need. This does not
  apply to the hosted client over the relay, which was not measured.
- Request census of one load from the dev origin: 724 module requests and
  about 30 API requests before the form, all HTTP/1.1, with up to 165
  requested at once against the browser's six connections per origin.
  Modules finished at 2.4–4.4 s and the form followed at 3.1–5.5 s, so the
  module waterfall, not API data, dominates. Browsers speak HTTP/2 only over
  TLS, and the server's self-signed HTTPS option is `node:https`, which is
  HTTP/1.1. Candidate remedies: HTTP/2 with TLS on the dev origin, or serving
  the built client from the live server.
- A warmed browser profile showed the form at 1.6–2.5 s, with about 49 KB of
  local storage, no IndexedDB, and no long tasks over 213 ms.

## Client delivery fixed (2026-10-09)

`pnpm dev --built-client` removes the unbundled module waterfall while keeping
the source backend and provider-host reload lifecycle. The maintainer's local
`reyep` defaults to this mode on its next full wrapper restart. The live server
was not restarted by the agent. Build lifecycle and diagnostic measurements are
recorded in [reload-safe provider runtimes](../topics/reload-safe-provider-runtimes.md#built-client-for-everyday-source-checkout-use).

An isolated paired browser check reduced scripts from 703 to 68 and first-load
form readiness from 5.01 s to 0.98 s. This fixes the measured delivery bottleneck;
the state/bootstrap requests below remain open. Contributing-model: 6-astra.

## Remaining

Current audit (2026-10-09): measured New Session and Settings cases meet the
revised three-second target. Incremental server project discovery is still
incomplete: background refresh enumerates provider stores, and the detail
lookup for directories absent from a complete collection retains its discovery
path. The gap's server-work requirement below is therefore not closed merely
because the display timings pass. Contributing-model: 6-astra.

Native-data concurrent acceptance at 6c4ad0710 (2026-10-09): three fresh
isolated servers each received three simultaneous new tabs, with authenticated
Claude discovery and the real Claude/Codex stores. Full UI times were
2,536/2,549/2,601 ms, 1,206/1,278/1,287 ms and 1,319/1,354/1,379 ms.
All nine met the revised target. Initial load was 25.87 on sixteen cores,
with 91 GB available RAM; this is diagnostic shared-host evidence, not a
universal latency guarantee. No project discovery warm-up preceded navigation.
The provider host and local SQLite checks passed and all spawned processes
were removed. Contributing-model: 6-astra.

The initial scanner audit distinguished tab reads from file events:
`readRetainedProjects` reuses a clean accepted snapshot without an age-driven
refresh, but `handleFileChange` invalidates the entire project snapshot for
every session or agent-session file change. The retained owner can then
schedule a complete refresh after 300 ms.

Claude directory discovery now reconciles the affected native directory and
retains the other unmerged directory contributions. Existing identity and
workstream merge rules still own the final project rows. A real-file/EventBus
regression read both directories before the change and only the changed one
afterward; creation, deletion, changed cwd, new directories and failure retry
preserve counts and membership in both supported directory layouts. Existing
retained-refresh and shutdown cases also pass. Codex acquisition and
cross-provider refresh work remain open. Ignoring file events is not an
acceptable fix because they can change project membership, counts and activity.
Contributing-model: 6-astra.

Gemini file-event discovery now retains unaffected session metadata. The
real-file/EventBus regression reduced metadata reads from two files to one and
checks project reassignment, deletion, creation and retry after a read error.
Concurrent readers share acquisition, and file/full invalidation during a held
read survives into the next scan. The focused scanner and shutdown checks pass
(38 tests). Age-driven Gemini enumeration and cross-provider refresh remain;
this is work-count evidence, not a new browser timing result.
Contributing-model: 6-astra.

New Session now reuses a current project collection row rather than requesting
the same selected-project detail. It waits for collection completion before
checking a missing directory; collection failure permits the independent detail
lookup. This removes the foreground complete-scan request from ordinary tab
startup without synthesizing project records or dropping inventory rows.
The browser regression fails before the change with the extra request and
passes afterward. All eleven startup browser cases and fifteen page tests pass.
Three fresh native-data servers show full UI at 2,865/1,199/790 ms; six returning
tabs take 351–627 ms, at initial load 20.24 on sixteen cores with 92 GB available
RAM. These are contended-host observations, not a paired speedup claim.
Desktop and phone captures were inspected; process cleanup passed.
Contributing-model: 6-astra.

Latest slice (2026-10-09): settings and version now start from a lightweight
local entry, followed by the selected provider as soon as settings resolve.
A real browser regression holds the React runtime download and requires all
three responses before releasing it. Existing hook tests preserve
source isolation, mutation ordering, fresh-version coverage and speech retries.
Alternating saved/current builds gave full UI 690/781/702 ms versus 726/508/647
ms. These six contended samples do not establish a reliable speedup and preceded
the selected-provider owner extraction. The final owner extraction passes all
eight startup browser cases and 55 query-hook tests; full timing remains due.

Maintainer-directed cache policy now keeps the server's accepted provider rows
until explicit refresh, relevant configuration change or server restart. The
old five-minute positive expiry, 15-second negative expiry and 4 MiB eviction
could all restart discovery after another client had already completed it.
Route tests advance time by a year and reuse a catalog over 4 MiB across client
requests without another probe; refresh and generation-ordering tests pass.
Browser provider display snapshots also have no age expiry. Gateway no longer
forces a probe just because a New Session form mounts; launch-time validation
remains separate. Contributing-model: 6-astra.

Control positions now reserve hidden, inert provider/model/effort geometry,
with catalog status in a separate reserved row. Refresh remains available for
static lists and when no provider is installed. Desktop and phone browser
cases release settings, projects, recents, provider identities and the selected
provider independently: control positions remain within 2 px and individual
keystrokes appear within 100 ms throughout. All ten startup browser cases and
106 form tests pass; final captures were inspected at 1000×600 and 375×812.
Lint, formatting, console checks and typechecking pass. Contributing-model:
6-astra.

At db9aa5995, all 60 measured tabs met the 1,500 ms full-UI check:

| Isolated built-client scenario | Samples | Full UI |
| --- | ---: | ---: |
| Fresh local browser and server | 3 | 293–440 ms |
| Returning local tabs, normal caches | 18 | 216–573 ms |
| Three local tabs opened together | 9 | 407–777 ms |
| Hosted client through authenticated local relay | 9 | 439–692 ms |
| 1,000 project rows and 200 selected-provider models | 21 | 335–804 ms |

These checks require the actual saved project, separate Claude selector,
Sonnet model and High effort, not just the composer. Three repetitions per
scenario ran with host load 23–26 on 16 cores and 86–88 GB free RAM. The large
catalog case injects expanded API responses; it measures client processing,
not discovery of 1,000 native projects. Fixture setup warms project discovery,
and provider authentication is absent. Hosted timings begin after relay login,
with browser HTTP cache cleared for the first measured tab. These are bounded
acceptance observations, not a universal bound on cold native-provider discovery
or Internet latency. All fixture teardown and final process sweeps were clean.
Contributing-model: 6-astra.

The manual-mode Vite correction is integrated as bbe05e218 after explicit
maintainer approval of one Vite restart. The live virtual module serves the
manual-refresh rejection instead of `location.reload()`. A changed source
generation cannot make a lazy import navigate the current document. This did
not restart the YA backend or activate the built-client launch default.

Broader verification completed: eight deep checks passed; the full browser
suite passed 389 cases, skipped ten and failed eleven. Seven failures were
test contracts or isolation repaired in this slice: Gateway fixtures now
distinguish persisted display from current aggregate authority; project-list
interception accepts retained-read parameters; older servers retain plain
folder creation; early-render tests own their project choice and server draft.
All eighteen relevant browser cases pass in focused runs after those repairs,
and the final five-check quick tier passes. The four other failures remain in
[local browser failures](e2e-local-instructions-and-project-app-failures.md).
The full browser suite is not claimed green. Contributing-model: 6-astra.

The maintainer reports that the missing starred items healed without an edit.
Both live server list paths and a fresh browser had 24 unarchived stars,
including 20 older than 24 hours. This is consistent with retained rows being
shown before reconciliation, but the incident's cause was not captured; there
is no confirmed data loss or age cutoff. No star metadata was changed.

Cold native-corpus acceptance now fails (2026-10-09). Three isolated fresh
server profiles read the maintainer's real Claude/Codex transcript stores and
use authenticated Claude model discovery. No project-list warm-up precedes
navigation. For the canonical selected project, first tabs take
3,041–5,518 ms; six subsequent tabs take 286–479 ms. All servers report a
healthy provider host and local SQLite, and Claude reports seven live models.
An earlier run with the home-directory alias also fails, so using the canonical
project path does not remove the cold delay.

A second three-server run records the individual controls: the project field
arrives last at 2,745–3,610 ms, provider controls at 1,140–2,756 ms, and effort
with the form at 302–451 ms. The selected-project request invokes
`ProjectScanner.getOrCreateProject`, whose first `getProject` waits for the
complete native-store snapshot. The form needs the selected project identity
before it needs complete session counts, but currently waits for both.
Several unrelated requests also finish together after long delays; whether
native discovery causes that contention remains unproved. The model timing
check additionally waited for the catalog's capitalized display name, although
the saved model ID can already be displayed; that check needs to accept the
same selection before its display name arrives.

These are diagnostic measurements on the shared 16-core host, not a calibrated
regression bound. The second run began at load 22.16 with 90.8 GB available RAM.
All isolated processes were removed and the final marker sweep was clean.
Remaining work: decouple selected-project display/validation from full corpus
inventory, remove the provider-control wait, and repeat cold acceptance with
the corrected model-selection check. Preserve project authorization and full
inventory results; do not fabricate empty counts or omit older sessions.
The live backend still needs the user-performed restart to activate its changes
and built-client default. Contributing-model: 6-astra.

The requested project path now displays directly from its URL identity while
the server resolves the project. It does not open folder creation, fabricate
session counts or authorize Start/Queue. The regression fails before this
change and passes after it; all 106 form tests and ten startup browser cases
pass. A held-project browser check confirms sequential typing within 100 ms
and disabled Start; desktop and phone captures were inspected.

With the saved model ID recognized independently of its later catalog display
name, two native-corpus runs gave cold full UI 417/817/815 ms and
2746/922/876 ms. Returning tabs in the final run took 349–453 ms. All nine
final-run tabs passed the revised 3,000 ms threshold. The earlier model-name
check overstated model readiness time, but its project-last cold failures
remain valid. These contended-host samples establish the measured cases, not
a universal upper bound.

Settings baseline: three new browser contexts on warm native-data servers
showed populated Settings at 931–1,433 ms. Three fresh native-data servers
gave 3,206/1,619/1,467 ms, reproducing a miss of the revised target.
Resource traces showed settings/version requests starting at 375–462 ms, with
Appearance code requested only after settings resolved. The lightweight local
entry now starts these same retained queries for Settings URLs before React,
without starting a provider probe. Principal and capability checks still use
the returned server facts.

A browser regression fails before this change and passes afterward while the
React runtime is held. All eleven startup browser cases and the cold native
probe pass. Settings/version requests start at 29–107 ms; populated cold
Settings takes 2,549/479/570 ms on three fresh servers. These shared-host
measurements remove the demonstrated serial dependency and meet the revised
target in the measured cases; they do not establish a universal latency bound.
Desktop and phone captures were inspected. All probe processes were removed.
Contributing-model: 6-astra.

Earlier acquisition investigation (2026-10-09), before the pure owners above:
the five
startup query modules' static chunk graph includes about 1.54 MB of unminified
code: React DOM, relay protocol validation and encryption are among the
dependencies of local HTTP reads. Moving those same modules to an earlier
entry did not remove that cost: version/settings still began at 138–169 ms;
paired full UI was 447/669/680 ms before and 657/567/515 ms with the split.
The experimental entry was removed. Separate query state/acquisition from its
React and transport adapters before trying another entry change.

An isolated server probe found Claude auth subprocesses taking 222–338 ms and
version handlers taking 206–345 ms; settings and retained project/recents
handlers took 1–4 ms. Libc report generation took 20–25 ms with network
inspection already disabled. Starting only the selected provider earlier
shifted the final wait to version and descriptors. A diagnostic that started
version/settings at document startup, then selected the provider from those
settings, gave full UI 334/317/599 ms versus paired 445/443/594 ms. The slow
candidate mounted its form at 489 ms despite provider data arriving at 334 ms.
These contended runs (roughly 22–31 load on 16 cores) identify dependencies;
they do not establish 500 ms acceptance. No speculative-provider request or
fetch interception was shipped. Contributing-model: 6-astra.

Accepted named provider rows now persist before the complete aggregate returns
(2026-10-09). A sibling browser regression holds settings, aggregate and named
responses and still displays the real project/Claude/Sonnet/High controls with
sequential typing preserved. Previously it had to wait for the aggregate
snapshot. Retained rows remain display-only, and current installation status
gates explicit launch. Source isolation, expiry and response ordering are
covered. Contributing-model: 6-astra.

Three seven-tab diagnostic runs with aggregate browser snapshots suppressed
compared named-row display reads enabled/disabled on alternating returning tabs.
Enabled full UI ranged 323–665 ms; disabled 323–526 ms, with cold samples
799/639/626 ms. Load rose from about 30 to 33 on 16 cores. This demonstrates
no consistent overall speedup or 500 ms acceptance; the held-response
regression establishes the removed dependency. Cold and concurrent readiness
remain open.

The sidebar question control no longer imports the inline question renderer
(2026-10-09). Splitting the modules removes KaTeX, FileViewer and LocalMediaModal
from the initial New Session graph. Its unminified module total is about 3.62 MB
versus 4.86 MB in the retained earlier graph; those graphs also span the small
intervening bootstrap changes, so this is a size comparison, not exact timing
attribution. A browser regression previously fetched KaTeX and now mounts
without it. Alternating previous/current builds gave full UI
680/808/512 versus 404/672/624 ms, with form times 269/394/245 versus
186/348/362 ms. Host load was 16–18 on 16 cores: results remain diagnostic,
with no consistent 500 ms acceptance. Question-menu navigation, inline replies,
drafts and ordinary delivery pass their browser regressions. Contributing-model:
6-astra.

Local selected-provider acquisition can now complete while the page module is
held (2026-10-09). Current settings select the named read, with an explicit URL
provider taking precedence; mounted consumers share it. The browser regression
failed before this change and passed three times afterward, along with the
typing and retained-state cases. Cold full UI remained 520/631/489 ms at load
19–20 on 16 cores. Settings arrived at 128/248/191 ms, but the named request
started at 219/348/253 ms, close to mounting: removing the React dependency has
not established an overall timing improvement. Main-thread startup and provider
probe latency remain open. An alternating six-load experiment delaying aggregate
discovery until the selected request finished also showed no consistent benefit
(normal 651/726/692 ms, delayed 716/614/822 ms, load 29–32); that scheduling
change was not applied. Contributing-model: 6-astra.

Local version discovery now starts while route modules load (2026-10-09),
sharing the existing retained query with mounted consumers. A browser regression
holds the New Session module: the previous entry never returned version data,
and the changed entry does. Three cold samples returned version at 150–159 ms,
before the form at 177–208 ms; full project/Claude/Sonnet/High UI still took
560/516/398 ms, ending with the selected Claude request. Before this change,
three corrected cold samples took 767/513/569 ms; 18 returning samples took
226–475 ms. Concurrent cold tabs took 570–1168 ms. These runs had changing
CPU contention (16 cores, latest load 19–20), so they identify dependencies
rather than establish a paired speedup or the 500 ms acceptance. The concurrent
run's final suite exit was lost at interruption; its individual measurements
and process cleanup were recovered. Contributing-model: 6-astra.

Provider identity enumeration now has a capability-gated, probe-free route
(2026-10-09). New Session renders the real selector from those identities and
resolves the selected provider independently; unknown runtime status cannot
authorize an explicit launch. A browser regression holds the aggregate and
still opens the provider menu and types into the real form. In the isolated
hosted probe, corrected full-UI readiness was 441 ms cold, then 318/410 ms;
an earlier sample under changing host contention took 711 ms. Load24.6/16cores
makes these diagnostic, not acceptance evidence. Pi exceeded5s in the cold
named-route census; OpenCode took1.63s. Their model discovery no longer blocks
selector enumeration. Repeated cold, larger-catalog and concurrent-tab coverage
remain open. Contributing-model: 6-astra.

Readiness measurement correction (2026-10-09): the earlier diagnostic
`controlsMs` checked the provider badge inside the model field, not the separate
provider selector. Those numbers do not establish the complete requested UI.
The corrected hosted check requires the real project field, Claude provider
selector, Sonnet model and High effort. With a fresh browser catalog it observed
5013 ms; subsequent tabs observed 226 and 340 ms. The server exposed eight
providers, and the browser had no aggregate provider snapshot while the
selector was missing. The aggregate `/api/providers` response waits for every
provider's auth and model probes. Cold aggregate acquisition remains open;
it must not be hidden by prewarming the catalog in acceptance setup.

Hosted New Session now resolves its app/layout/page and connection-gate
component wrappers before mounting, as the local entry already does. A held
page-module regression failed on the old implementation and now verifies no
module loading fallback, preservation of sequential typing across handoff and
input acknowledgement within 100 ms. Three diagnostic runs reduced the older,
incomplete controls metric from 735–1007 ms to 224–631 ms. This establishes a
module-loading improvement, not completion of the 500 ms full-UI target.
Contributing-model: 6-astra.

Shared-package import metadata now allows unused schema modules to stay out of
startup (2026-10-09). The import-time frame-search installer remains an explicit
exception; deferred validators still run when loaded. Three alternating cold
pairs of previous/current built clients gave form times 297/293/279 versus
244/212/230 ms, and controls 326/293/304 versus 271/227/267 ms. Both arms used
the same browser interception and healthy isolated backend configuration;
load was 15–17 on 16 cores. This is diagnostic evidence, not a calibrated
ratchet. Current catalog labels arrived at 573/497/503 ms, so the full goal
and broader acceptance remain open. Contributing-model: 6-astra.

Browser CPU profiling (2026-10-09) identifies two startup costs worth separating:
removing the focused preboot field forces pending layout (14–65 ms in the
observed profiles), while eager Zod construction takes 10–27 ms of sampled
self time. Deferring overlay removal until after the real field takes focus
only moves the layout cost into that focus callback. Six alternating cold
loads showed no reliable improvement: current controls 291/343/326 ms versus
deferred removal 311/268/360 ms. Keep the existing typing handoff. Next inspect
which schema initializers enter the initial bundle through shared exports;
do not assume all validation can be delayed. These profiles ran with load
17–20 on 16 cores and are diagnostic, not acceptance evidence. Full catalog
labels still arrived at 526–583 ms in this pair. Contributing-model: 6-astra.

Initial project selection no longer waits for a router update (2026-10-09).
Two slow returning-tab traces already had route facts by 164/211 ms, but the
form remained unselected until URL normalization committed. New Session now
derives the same preferred project during render, preserving explicit and
detached choices and incomplete-collection rules. A browser observer verifies
the correct project path in the input's first render after held code releases.

Across eighteen returning tabs, the form-to-controls gap was a median 21 ms
(maximum 48), versus 80 ms (maximum 271) in the preceding run. These are
separate diagnostic runs under differing contention, not a controlled speedup
claim. One returning sample still took 536 ms overall because the form itself
mounted at 498 ms; one cold sample mounted at 496 ms and showed controls at
576 ms. Initial module/render work now needs profiling. The full 500 ms target
and broader acceptance remain open. Contributing-model: 6-astra.

Local New Session now starts settings, project and recent reads through their
existing query owners while route code loads (2026-10-09). A held-route browser
regression verifies all three responses arrive before the page module executes.
Priming settings alone did not establish an overall gain; all three reads are
needed to remove the post-mount dependency. In six paired healthy cold loads,
holding these requests until form mount gave controls at 470/685/563 ms; early
reads gave 389/299/297 ms. Early requests completed in 4–6 ms before provider
probing competed with them. The model's catalog labels arrived at 609/567/480
ms; the selected provider/model/effort controls were already visible.

A subsequent run without interception gave fresh controls at 488/341/300 ms.
Eighteen returning tabs ranged from 236 to 552 ms, with two above 500 ms
(552/513). These are diagnostic observations at load 15–22 on 16 cores,
using healthy isolated runtimes and warmed project discovery. The full target
is still open, including returning-tab variance, larger catalogs and hosted
paths. Contributing-model: 6-astra.

Built local New Session now preloads its route's static chunk graph during
HTML parsing (2026-10-09), before the main module can discover it. Other routes
and deferred dynamic imports keep their existing loading behavior. In six
alternating healthy cold loads of one build, removing the preload script gave
full controls at 716/481/659 ms; keeping it gave 459/636/336 ms. Median form
appearance moved from 463 to 283 ms. Route chunk acquisition began at
104–159 ms without preloads and 27–64 ms with them. The paired probe intercepted
HTML in both arms, and host load was 17–20 on 16 cores: diagnostic evidence,
not a 500 ms guarantee. Catalog-enriched labels still took 599/686/478 ms in
the preloaded arm. See the [built-client contract](../topics/reload-safe-provider-runtimes.md#built-client-for-everyday-source-checkout-use).
Contributing-model: 6-astra.

Measurement qualification (2026-10-09): the long temporary path used by earlier
scratch browser runs left the provider host degraded. Their timings remain
diagnostic and cannot establish acceptance in a healthy runtime. A shorter
path on verified local XFS storage restores the host and database; the probe
now rejects either degraded condition. Three healthy cold loads showed the
complete saved project/provider/model/effort controls at 537/488/854 ms and
catalog-enriched labels at 537/538/854 ms. Desktop and phone captures with
provider responses held confirm that the real controls already display the
saved model ID before its catalog label arrives. The timing probe retains both
milestones; neither substitutes the early textarea for the full form.
Contributing-model: 6-astra.

Projects and recents no longer wait for version acquisition (2026-10-09).
Unknown versions receive a retained-read preference; the reviewed
v0.8.0–v0.9.2 handlers ignore it and return complete responses. Known absent
or withdrawn support still selects complete reads. Response metadata owns
completeness; the source-bound query owners preserve late-response isolation.
See [retained collection gate](../topics/server-capabilities.md#retained-collection-gate).

Three healthy isolated cold loads now started both collections alongside
version at 213/351/232 ms, rather than after its response. Full saved controls
appeared at 361/533/458 ms; catalog-enriched labels at 492/663/485 ms. These
remain diagnostic samples under host load 13–15 on 16 cores, with project
discovery warmed by fixture setup. The 500 ms requirement is not established.
Settings response consumption and selected-provider acquisition still form a
serial chain; initial client startup also varies materially. Contributing-model:
6-astra.

Claude native-executable selection no longer asks Node to inspect network
interfaces or perform reverse DNS while determining libc (2026-10-09). The
report option is scoped to the synchronous read and restored on success or
failure. In three isolated server processes, ordinary reports took 29/25/58 ms
and subsequent network-excluded reports took 18/14/17 ms. Fixed ordering and
host contention make these diagnostic measurements. The complete cold UI
still took 552/630/831 ms after the change; this does not satisfy 500 ms.
Contributing-model: 6-astra.

Cold startup also probes unselected providers, with synchronous subprocess
launches delaying admission of otherwise fast requests. Deferring the full
catalog until the selected Claude response removed that admission delay but
did not establish an overall gain: alternating full-UI samples were
457/583/845 ms normally and 612/702/545 ms with deferral. Both arms used early
bootstrap reads on a contended host. Simple deferral remains unshipped;
provider acquisition and the serial bootstrap dependencies remain open.

Returning tabs now restore a bounded account-scoped project display snapshot
(2026-10-09). Open sidebars maintain complete project rows; New Session retains
recent-project ordering. Current identity and grants gate reads, and cached
rows cannot enable Start or Queue. A real sibling-tab test holds version,
projects and recents while the selected project remains visible and sequential
typing stays under 100 ms per key. See
[project display snapshots](../topics/session-catalog-observation.md#new-session-project-display-snapshot).
An isolated seven-load check measured returning full UI at 332/269/345 ms with
the project snapshot and 528/325/453 ms with its reads disabled; the cold load
was 483 ms. Host load was 13.5–14.3 on 16 cores, with other compute jobs active.
This is diagnostic evidence, not 500 ms acceptance. Cold bootstrap, remaining
server enrichment/discovery, authenticated-provider coverage and broader
verification remain open. Contributing-model: 6-astra.

A repeat after wiring the sidebar writer measured warm full UI at 385/317/264
ms with snapshots and 391/736/315 ms without; its cold load was 1166 ms. Auth,
onboarding and settings each spanned about 540 ms, followed by a 242 ms named
Claude request; selected-project detail took 33 ms. Load average was 11.2 on
16 cores with concurrent compute work. These timings do not distinguish browser
connection queueing from server processing. They reinforce that returning-tab
display is improved while cold startup remains unresolved.

Version acquisition no longer serializes independent build, bridge, sandbox
and update work (2026-10-09). Held-promise route tests require independent
probes to start together and the response to await their results. Ten isolated
fresh-server/fresh-browser loads measured full UI median/p90 at 761/934 ms
before and 693/826 ms after. CPU load varied from 18 to 23 on 16 cores, so
this is diagnostic evidence, not a clean attribution or 500 ms acceptance.
These fixtures are signed out: Claude returns a fallback catalog, not a live
SDK probe. Separate phase measurements found 47–61 ms of build metadata
followed by 74–173 ms of sandbox preflight. Current capability acquisition
still gates project/recents requests; cold and cross-tab snapshots remain
open. Contributing-model: 6-astra.

Claude catalog requests no longer launch duplicate authentication commands
(2026-10-09). A route-level regression reproduced two `claude auth status`
subprocesses for one cold request and now requires one. Completed and failed
checks are released, so later requests observe current sign-in state. This
reduces duplicate discovery work; it does not remove the remaining SDK model
probe or establish the 500 ms target. Contributing-model: 6-astra.

Returning tabs now restore provider/model/thinking/effort display defaults
without waiting for settings (2026-10-09). A real sibling-tab check holds its
settings response indefinitely and verifies Sonnet/High plus sequential typing.
Current settings remain required for launch and automatic preference writes.
The cache excludes permissions, paid tiers and private configuration; see
[session defaults](../topics/session-defaults.md#provider-catalog-readiness).
This removes a dependency, but does not establish an overall speedup: a
contended same-run comparison measured full warm UI at 434/391/541 ms with the
display cache and 441/452/458 ms without it. The cold sample was 2025 ms, with
the named Claude request taking 1589 ms. Server provider discovery, project
snapshots and cold bootstrap remain open. Contributing-model: 6-astra.

Project collection requests now use retained discovery on capable servers
(2026-10-09), including current names, visibility and ownership. Incomplete
collections preserve known choices and cannot select an arbitrary project while
the preferred project is undiscovered. Older servers retain complete requests.
Thirty scanner reads complete while discovery is blocked; restart,
invalidation, failure/backoff and disposal checks cover its lifecycle. Captions,
selected-project detail, targeted incremental updates and browser snapshots
remain open; see
[retained project discovery owner](../topics/session-catalog-observation.md#retained-project-discovery-owner).
Contributing-model: 6-astra.

An isolated built-client check with saved Claude/Sonnet/High selections, no
project query parameter, and the first tab left open for sibling loads measured
full readiness at 815/488/272/380 ms (2026-10-09). The first load waits for
settings (213–418 ms), then Claude details (451–808 ms); version acquisition
(212–638 ms) also precedes retained recents (665–691 ms). This is a different
fixture from the default-selection measurements below, not a paired speedup.
Host load was 22.6 on 16 cores, so these are diagnostic samples, not acceptance
of the 500 ms target. Browser snapshots and cold bootstrap still need work.
Contributing-model: 6-astra.

Retained recents now reuse the durable session catalog and expose ordered visit
identities separately from title enrichment (2026-10-09). New Session can choose
the recently visited project while enrichment is still pending. Supported
clients make no request-time provider/project scan for recents; older clients
retain the complete response. Catalog publications and persisted visit changes
notify open tabs. The contract is in
[retained recent visits](../topics/session-catalog-observation.md#retained-recent-visits).
Project enumeration, browser snapshots and the complete full-UI latency
acceptance remain open. Contributing-model: 6-astra.

New Session now admits its project collection in the route tier (2026-10-09),
alongside its selected-project request. It no longer waits for unrelated route
work to settle before starting the selector's collection request. Sidebar
consumers share the same fetch. A focused hook regression holds another route
request pending and verifies admission plus deduplication; the four existing
preboot browser cases pass. This removes scheduling delay, not the server scan
or missing cross-tab snapshot. Contributing-model: 6-astra.

Local route acquisition also avoids committing a React loading fallback before
mounting ready modules (2026-10-09). In an isolated built-client check, the last
script finished roughly 300 ms before the old form appeared. Mounting the
preloaded route removed that pause. With the same seeded project and default
Claude/model/Thinking controls, warm new-tab full-UI samples changed from
732/641/524 ms to 408/433/395 ms. The cold sample was still 988 ms (baseline
1026 ms), waiting for server data. These are diagnostic samples under CPU
contention (16 cores, load 17–23), not a stable 500 ms guarantee. The remaining
items still need implementation and broader verification. Contributing-model:
6-astra.

The local pre-boot draft restoration is also fixed (2026-10-09): the inline
field reads the account-scoped draft, and adoption transfers edits exactly
once, including deletion. Account changes cannot adopt another account's
snapshot. The focused browser check types sequentially before and after app
startup and verifies no duplicate prompt. This is correctness work, not proof
of the full-UI 500 ms latency target. Contributing-model: 6-astra.

- **Instant first paint from last-known state.** A new tab renders the
  composer, current provider/model/effort, and project selector from a
  snapshot every open tab keeps current (browser storage or a
  `BroadcastChannel`), marked stale until the server confirms it. The
  session list and sidebar may follow.
- **One current truth on the server.** Providers, projects and recent
  sessions are maintained incrementally and served from memory. They are
  pushed to subscribed tabs, not recomputed per request, so no request in the
  new-session path waits on a transcript scan.
- **No serial bootstrap chain.** Route data requests start together with the
  bootstrap requests, not after them.

Found 2026-09-30 while diagnosing duplicated new-session prompts and
multi-second new-tab loads. Contributing-model: opus-5.5.
