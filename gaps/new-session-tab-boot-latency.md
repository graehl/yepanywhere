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
