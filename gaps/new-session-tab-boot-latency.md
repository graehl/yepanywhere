# A new-session tab takes seconds to show what every open tab already knows

Priority: **top** (maintainer, 2026-09-30). Opening `/new-session` in a new
tab is a routine action. It must show the composer, the current provider,
model and effort selection, and the project selector at once, then fill in
detail lazily. Today each of those waits on a serial chain of requests to a
server that already holds, and other open tabs already display, the same
current state.

## Observed

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

The healthy traces still show projects and recents waiting on version
acquisition: version completed at 418–701 ms, then those collection reads
started at 433–745 ms. This remains a concrete serial bootstrap dependency.
The supported v0.8.0–v0.9.2 collection routes ignore the `summaryMode` query
parameter and return their normal complete responses, so a read-preference
approach is a candidate for removing this wait. No client contract change has
landed yet; withdrawal semantics and response compatibility need to remain
explicit when replacing the current capability gate.

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
