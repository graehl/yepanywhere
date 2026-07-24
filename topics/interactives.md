# Interactives

> Proposal: project-affiliated ad-hoc web apps — agent-built dev servers or
> static page bundles registered in project-local config — that YA surfaces as
> persistent icon links on the project's sessions and reaches through its
> authenticated transports (including relay), plus a confirm-gated annotation
> flow that returns structured page input to the session as an
> attachment-referencing turn.

Topic: interactives

Status: **proposal, nothing implemented (2026-07-24).** YA's only proxy today
is the Vite dev-client proxy (`createFrontendProxy`,
`packages/server/src/frontend/proxy.ts`); no arbitrary-port proxying, no
project app registry, no annotation upload route exists.

## Motivation

An agent in a session often could answer a need best by *building a small web
app*: a one-off dashboard over test results, a REST endpoint the user can poke,
a data explorer, an interview page for a design decision. Today that app dies
with the terminal: it runs on a dev port on the YA machine, unreachable from
the hosted remote client, invisible in the session UI, and forgotten when the
session ends. YA already owns exactly the missing pieces — an authenticated
local+relay transport, per-project session surfaces, and attachment plumbing —
so the proposal is a *convention*, not an app framework: a standard for
project-local registration that YA checks, plus lifecycle/visibility
management. The app itself stays independent of the YA codebase, typically
customized or built one-off by the agent in-session for ad-hoc purposes.

Two classes, one registry:

- **Proxied app** — a regular web server (UI or REST) on a loopback dev port
  on the YA machine. YA proxies it; YA does not serve or build it.
- **Served page** — a static rich html+js bundle (no server of its own) that
  YA serves directly from a project path. The annotation/interview flow below
  is the motivating use.

## Vocabulary

- **interactive** (noun) — one registered entry: a proxied app or served page
  affiliated with a project.
- **app icon link** — the persistent per-interactive icon YA renders on the
  project's session surfaces.
- **annotation flow** — the served-page pattern where user input (comments,
  selections, choices) is confirmed and uploaded as deltas that become a
  project-local attachment plus a turn referencing it.
- **`INTERACTIVES.md`** — optional project doc whose content overrides the
  default prompt prefix injected by the Create Interactive button. Distinct
  from the machine-readable registry below.

## Registration standard (the project-local config YA checks)

Proposed: `.yep/interactives.json` at the project root, an array of entries:

```jsonc
[
  {
    "name": "coverage-explorer",       // slug; unique within project
    "title": "Coverage Explorer",      // icon tooltip / label
    "icon": "🧭",                       // emoji or project-relative image path
    "kind": "app",                      // "app" (proxied) | "page" (served)
    "port": 5199,                       // app: loopback port to proxy
    "path": "/",                        // app: landing path
    "bundle": ".yep/interactives/coverage-explorer/", // page: served dir
    "start": "pnpm --dir tools/cov dev",// optional managed-lifecycle command
    "healthPath": "/"                   // optional liveness probe
  }
]
```

Contract points:

- YA **reads** this file (watch or rescan on project activity); in v1 YA never
  writes it — the agent authors it when it creates the app. Whether the file
  is committed is the project's choice; YA applies no exclude machinery
  (unlike [[attachment-storage]], there is no accidental-secret-bytes risk in
  a small config, and a durable project tool may deserve committing).
- Proxy targets are **loopback-only** (`127.0.0.1:<port>`); the registry must
  not accept arbitrary hosts. Declaring a port in the project's own config is
  the authorization to proxy it.
- A missing/absent registry means the feature contributes zero UI — the
  convention is self-gating, satisfying [[vanilla-defaults]] without a
  separate toggle. (An off switch for icon rendering still belongs in
  [[session-ui-customization]].)
- Hosted-client gating: advertise a `server-capabilities` string so older
  servers don't get dead icon affordances (see [[server-capabilities]]).

Schema details (multiple pages per entry, auth annotations, REST-only entries
without a UI landing page) are open; start minimal.

## Visibility contract (app icon links)

- Each registered interactive renders as a persistent icon link, project-
  affiliated: visible on sessions belonging to the declaring project — just
  left of the title in recent-session rows and in the main session view
  header.
- Icon click opens the interactive through YA's transport (new tab or
  embedded view — open decision; embedding interacts with the sandbox
  question under *Security*).
- Liveness: a proxied app whose port is dead renders dimmed (probe =
  `healthPath` or TCP connect), with an affordance to start it when a managed
  `start` command exists. Served pages are always live.
- Hideable via session-UI customization; default-on rendering is acceptable
  only because the project itself opted in by carrying the registry.

## Lifecycle (YA's management role)

YA manages lifecycle/visibility only; it does not own the app's code.

- **v1: observe-only.** Externally started (usually by the agent in-session);
  YA probes liveness, proxies, and renders icons.
- **Later: managed start/stop.** With a `start` command, YA may launch on
  first click and must idle-stop within a bound — an interactive with no
  connected client must not consume server resources indefinitely
  ([[architecture-mandates]]). Managed processes are YA-supervised children,
  reported in the process/status surfaces like other server-owned work.

## Transport and serving

- Proxy route shape: `/apps/:projectId/:name/*` on the main server, forwarding
  HTTP and WebSocket upgrades to the registered loopback port.
  `createFrontendProxy` is already a parameterized host/port HTTP+WS raw-socket
  proxy — generalize it rather than adding a proxy dependency.
- The route sits behind YA auth like `/api/*`. Over relay, requests ride the
  existing end-to-end-encrypted channel, so the relay sees ciphertext as
  usual.
- **Never** reachable from public-share surfaces: public-share relay plaintext
  stays restricted to `GET /public-api/shares/...`
  ([[relay-origin-and-share-gating]]); interactives join speech/STT on the
  must-not-tunnel list.

## Security

The trust boundary ([[security]]) permits the *reach*: local and authenticated
remote operators already command agents with full host power, so proxying a
loopback port to them adds no new principal. The crux is different — **ambient
authority under YA's origin**. YA auth is an httpOnly `yep-anywhere-session`
cookie (`packages/server/src/auth/routes.ts`), so interactive JS cannot read
the credential, but anything served/proxied under the YA origin can *make*
authenticated same-origin `/api/*` requests as the operator — CSRF-equivalent
full API power for agent-generated (LLM-authored, lightly reviewed) code.

Direction, to verify at design time: render interactives in a sandboxed iframe
without `allow-same-origin`, giving the page an opaque origin — SameSite=Lax
should then withhold the session cookie from its requests <!-- assumed -->.
The annotation upload route would take an explicit per-interactive token
rather than riding session auth. Path-only separation (`/apps/...` with CSP)
does **not** isolate origin and is insufficient alone. If sandboxing proves
incompatible with useful apps (e.g. they need their own workers/storage), the
fallback posture is informed consent: opening an interactive is running
agent-authored code with operator power, stated plainly.

Hosted-client wrinkle: on `ya.graehl.org` the client reaches the server
through the relay tunnel, not direct HTTP, so an iframe `src` has no plain URL
to point at; serving the interactive's assets to the hosted client needs a
tunnel-backed URL space (service-worker-mediated fetch or blob/`srcdoc`
injection). Open design area — direct (Tailscale/LAN) mode has no such
problem.

## Create Interactive button

A composer-adjacent action that prefills the composer with a prompt prefix
instructing the agent to build an interactive to this standard (registry
entry, class choice, port discipline, annotation contract). The default prefix
is built-in; a project overrides it by carrying `INTERACTIVES.md`, whose
content precedes the user's turn in the composer. Because the prefix lands
*in the composer* — visible, editable, sent verbatim only when the user sends —
it is an explicitly invoked transform in [[vanilla-defaults]] terms, like
emulated slash-command expansion. The agent-facing instructions/skills that
make the build reliable are TBD and belong beside the standard once it
stabilizes.

## Annotation flow (served pages; the "interview" class)

The more abstract sibling: a single interactive DOM page — or, later, a
composable pipeline of pages — with controls for comment, select, choose,
adjust, ending in an explicit **confirm**. Use cases: structured interviews
(design tradeoffs, UI-tweak review with live previews), richer versions of
option-picking prompts.

Precedent: the transcript already has select-and-comment machinery
([[selection-comment-ui]]: quote-comment, comment anchors) and confirm-gated
structured questions (AskUserQuestion-style option prompts); this generalizes
both to agent-authored pages with arbitrary DOM.

Contract sketch:

1. Agent builds a served-page bundle (rich html+js) and registers it.
2. User interacts; nothing leaves the page until **confirm**.
3. On confirm the page uploads the resulting annotation deltas (proposed: one
   JSON document with a self-describing `schema` field; format intentionally
   "some format" — versioned, not frozen yet) to a YA route.
4. YA writes it as a project-local attachment-type file under the
   [[attachment-storage]] contract (`.attachments/<session>/`, force-exclude
   rules apply) and produces a turn referencing the file, using the same
   "User uploaded files in `.attachments`" prompt-listing mechanism uploads
   already use.
5. Recommended v1 delivery: the referencing turn lands in the composer /
   attachment chip for the user to send (confirm ≈ attach, send stays
   explicit). Auto-send-on-confirm is a plausible opt-in once trusted.

Pipelines (page N's confirm feeding page N+1) stay a future extension; the
single-page contract must not foreclose chaining, which argues for the
uploaded document carrying the interactive `name` + a step id.

## Open decisions

- Registry location/name (`.yep/interactives.json` vs alternatives) and
  minimal v1 schema.
- Embed vs new-tab open; sandbox mechanism verification (opaque-origin cookie
  behavior across target browsers).
- Hosted-client (relay) asset serving for embedded interactives.
- Annotation upload auth (per-interactive token shape) and delta format
  versioning.
- Managed-lifecycle idle-stop bound and its status surface.
- Whether REST-kind entries get a YA-rendered landing (request console) or
  just a link.

## See also

- [[security]], [[relay-origin-and-share-gating]] — trust boundary and the
  must-not-tunnel list this extends.
- [[attachment-storage]] — the attachment contract the annotation flow reuses.
- [[selection-comment-ui]] — in-transcript precedent for comment/select with
  confirm.
- [[vanilla-defaults]], [[session-ui-customization]], [[server-capabilities]] —
  gating and visibility discipline.
- [[architecture-mandates]] — resource bounds for any managed lifecycle.
