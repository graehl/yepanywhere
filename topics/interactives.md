# Interactives

> Proposal: a zero-setup container for agent-built web apps — dev servers or
> static page bundles scaffolded from an opinionated template and registered
> in project-local config — that YA surfaces as persistent icon links on the
> project's sessions and reaches through its authenticated transports, so a
> user on a phone or tablet over relay can open them with no hosting
> knowledge.

Topic: interactives

Status: **proposal, nothing implemented (2026-07-24).** YA's only proxy today
is the Vite dev-client proxy (`createFrontendProxy`,
`packages/server/src/frontend/proxy.ts`); no arbitrary-port proxying and no
project app registry exists. The rich annotator/interview flow originally
drafted here is split out to [[rich-interviews]] — different intent, different
lifecycle, no committed implementation overlap.

## Motivation

The only reason to couple YA with an environment-for-a-web-app panel is
**reach**: the user may be on a tablet or phone over relay, with no knowledge
of how to set such things up. Next to the dev machine, `http://localhost:5199`
already works; from a phone over relay, nothing does — ports, tunnels, TLS,
and auth are exactly the setup a novice cannot do. YA is already the
authenticated, relay-reachable, per-project surface on that machine, so
surfacing the app there is the entire value. YA stays a *container* —
lifecycle, visibility, reach — and never becomes an app framework; the app
itself is independent of the YA codebase, typically customized or built
one-off by the agent in-session for ad-hoc purposes.

Two hard requirements sharpen the scope (maintainer, 2026-07-24): hosting is
**YA-server only** — the app runs from the user's machine through YA's
transports; cloud hosting is right out — and an interactive is **committed
project files**: the scaffolded subdir, registry entry, and per-app guide are
ordinary versioned artifacts in the repo, so an app survives sessions,
travels with a clone, and is reviewable like any other code.

Guiding vision (maintainer, 2026-07-24): "easy enough to use that my kids can
play with it when it is good enough." The bar is a novice — a kid on a
tablet — tapping an icon and playing an agent-built animation or game, not an
operator wiring a deployment. Novice-friendly cuts both ways: *creating* "a
project web app" from a session must be natural for a non-web-dev too, which
is why the convention includes an opinionated app template (below) rather
than leaving each app's organization to per-session improvisation.

Two classes, one registry:

- **Proxied app** — a regular web server (UI or REST) on a loopback dev port
  on the YA machine. YA proxies it; YA does not serve or build it.
- **Served page** — a static rich html+js bundle (no server of its own) that
  YA serves directly from a project path. For the novice vision this is the
  *primary* class: a plain html+js animation or game has no process to keep
  alive, so its icon is always live.

## Vocabulary

- **interactive** (noun) — one registered entry: a proxied app or served page
  affiliated with a project.
- **app icon link** — the persistent per-interactive icon YA renders on the
  project's session surfaces.
- **`INTERACTIVES.md`** — optional project doc whose content overrides the
  default prompt prefix injected by the Create Interactive button. Distinct
  from the machine-readable registry below.
- **app template** — the opinionated scaffold (framework/language choices,
  layout, registry entry, per-app agent guide, meta-UI hook) agents create
  new interactives from.
- **per-app agent guide** — the `.md` the scaffold places in an app's subdir
  telling the agent how to develop, update, and run that app; update turns
  reference it.
- **meta-UI protocol** — the template-provided in-app affordance and page↔YA
  channel for commenting to the agent inline from the app view.

## App template and per-app agent guide

"Create a project web app" from a session must be natural for a non-web-dev,
so the convention defines a template for how such an app is organized:
framework and languages (likely TS plus a to-be-chosen minimal framework),
directory layout under a conventional project subdir, the registry entry, the
meta-UI hook wired in, and a **per-app agent guide** — a `.md` scaffolded into
the created app's subdir that tells the agent how to develop, update, run,
and register that named app. A turn about the app references that guide (the
create/update affordances prefix the composer with the reference), so "make
the ball bounce higher" arrives carrying the app's dev context and the app
stays maintainable across sessions. The template and guide are where the
agent-facing instructions/skills land — they belong to the convention, not to
YA's server code, which never needs to understand the framework choice.

v1 ships exactly one opinionated, friendly built-in template. Per-project
template override is an intended later extension — recorded here so the v1
shape does not foreclose it, deliberately not built first.

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
  writes it — the agent authors it when it creates the app. Registry, app
  subdir, and per-app guide are *committed* project files (see Motivation);
  YA applies no exclude machinery — unlike [[attachment-storage]], committing
  is the point here, not a leak risk.
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
full API power for agent-generated (LLM-authored, lightly reviewed) code. The
kid-playable vision hardens this from concern to requirement: a child tapping
a game icon must not be one script call away from operator API power, so
isolation is the default posture, not an option.

Direction, to verify at design time: render interactives in a sandboxed iframe
without `allow-same-origin`, giving the page an opaque origin — SameSite=Lax
should then withhold the session cookie from its requests <!-- assumed -->.
Path-only separation (`/apps/...` with CSP) does **not** isolate origin and is
insufficient alone. If sandboxing proves incompatible with useful apps (e.g.
they need their own workers/storage), the fallback posture is informed
consent: opening an interactive is running agent-authored code with operator
power, stated plainly — acceptable for the operator, not for the kid case.

The meta-UI protocol (below) reinforces this posture: a templated app's only
channel to YA is a brokered message channel, so it needs no ambient authority
at all.

Hosted-client wrinkle: on `ya.graehl.org` the client reaches the server
through the relay tunnel, not direct HTTP, so an iframe `src` has no plain URL
to point at; serving the interactive's assets to the hosted client needs a
tunnel-backed URL space (service-worker-mediated fetch or blob/`srcdoc`
injection). Open design area — direct (Tailscale/LAN) mode has no such
problem.

## Meta-UI protocol (comment-to-agent from the app view)

The template bakes a meta-UI affordance into every scaffolded app: from the
running app's view, the user can comment inline to the agent — a small
overlay/widget, not something each app reinvents. Mechanically it is a
page↔YA channel: under the sandboxed-iframe posture, `postMessage` brokered
by the embedding YA client is the natural transport, and it doubles as the
*only* capability an app is granted — comments need no cookie or `/api/*`
authority. A comment (plus optional app-supplied context such as the tapped
element or app state) lands in the session composer for the user to send
(v1; auto-send is a later opt-in), consistent with [[vanilla-defaults]].
This is the freeform, app-side sibling of [[rich-interviews]]: the same
input-back-to-agent direction, but unstructured in-app comments rather than
structured multi-round forms.

## Create Interactive button

A composer-adjacent action that prefills the composer with a prompt prefix
instructing the agent to scaffold an interactive from the app template
(registry entry, class choice, port discipline, per-app agent guide). An
update affordance on an existing app similarly prefixes a reference to that
app's per-app agent guide. The default create prefix is built-in; a
project overrides it by carrying `INTERACTIVES.md`, whose content precedes the
user's turn in the composer. Because the prefix lands *in the composer* —
visible, editable, sent verbatim only when the user sends — it is an
explicitly invoked transform in [[vanilla-defaults]] terms, like emulated
slash-command expansion. This button is the piece that serves the novice
vision most directly (tap → describe the game you want), and also the first
piece to cut if the container concept shrinks — it is sugar, not structure.
The agent-facing instructions/skills that make the build reliable are TBD and
belong beside the standard once it stabilizes.

## Relation to rich interviews

[[rich-interviews]] (the annotator/interview flow) was originally drafted as a
section here and is deliberately separate: its intent is routine structured
input consumed by workflows/skills, its lifecycle is issued-into-a-session
rather than project-persistent, and its likely v1 (YA-rendered declarative
forms) shares no implementation with this container. The one seam: if an
interview ever needs arbitrary DOM expressiveness, it may embed an
interactive — a directional reference, not shared ownership. As of
2026-07-24 rich interviews are banked entirely (lower incremental value);
the working bet is that this container's machinery — template, meta-UI
protocol, embedding — accumulates until the interview use cases become
easily buildable on top.

## Prior art

Learn-from targets — source code, demos, marketing — from a 2026-07 survey
pass. Study their interaction patterns and bridge protocols; their cloud
hosting models are explicitly rejected by the YA-server-only requirement:

- **GitHub Spark** — natural-language micro-apps ("sparks") on an opinionated
  managed runtime (storage, theming, LLM access) with a PWA dashboard for
  launching them from anywhere, hosted behind GitHub auth. Validates the
  shape — template + registry + icon dashboard + zero-setup reach — while its
  Azure hosting is exactly what the requirement rejects: the shape transfers,
  the hosting model does not.
  (https://github.com/features/spark,
  https://githubnext.com/projects/github-spark/)
- **Lovable "Visual Edits" / preview toolbar** (similarly v0, Bolt.new) —
  select elements in the running preview, describe the change in plain
  language, send to the agent to iterate; selected elements attach to the
  chat input as references. The meta-UI protocol is this pattern generalized
  to template-scaffolded apps, and the composer-landing v1 matches the
  attach-to-chat-input behavior.
  (https://docs.lovable.dev/features/preview-toolbar)
- **MCP Apps standard / ChatGPT Apps SDK** — embedded app UIs run in a
  sandboxed iframe (ChatGPT: a dedicated `*.web-sandbox.oaiusercontent.com`
  origin with per-widget CSP) and talk to the host via `ui/*` JSON-RPC over
  `postMessage` (`window.openai` wraps it). Directly validates the
  sandbox-plus-brokered-channel posture; evaluate MCP Apps as the meta-UI
  message schema before defining a YA-private one.
  (https://developers.openai.com/apps-sdk/build/chatgpt-ui,
  https://developers.openai.com/apps-sdk/mcp-apps-in-chatgpt)
- **Claude Artifacts** — agent-built single-page apps rendered in a sandboxed
  iframe beside the chat; precedent for the served-page class and for tight
  default sandboxing of agent-authored code. <!-- assumed; not re-verified in
  this survey pass -->

None of them cover YA's actual coupling reason: the app living on the user's
own dev machine inside a project checkout as committed files, reached over
the operator's authenticated relay rather than vendor hosting.

## Open decisions

- Registry location/name (`.yep/interactives.json` vs alternatives) and
  minimal v1 schema.
- Template framework/language choices, scaffold layout, and where app subdirs
  live (served-page vs proxied-app cases).
- Per-app agent guide filename and required sections.
- Whether served-page bundles commit built output (so YA serves them with no
  toolchain present) or commit source only and rebuild on update.
- Meta-UI channel mechanics (message schema, context payload, composer
  delivery vs queued turn; a fallback channel for new-tab opens where no
  embedding parent exists).
- Embed vs new-tab open; sandbox mechanism verification (opaque-origin cookie
  behavior across target browsers).
- Hosted-client (relay) asset serving for embedded interactives.
- Managed-lifecycle idle-stop bound and its status surface.
- Whether REST-kind entries get a YA-rendered landing (request console) or
  just a link.

## See also

- [[security]], [[relay-origin-and-share-gating]] — trust boundary and the
  must-not-tunnel list this extends.
- [[rich-interviews]] — the split-out interview flow and its embed seam.
- [[vanilla-defaults]], [[session-ui-customization]], [[server-capabilities]] —
  gating and visibility discipline.
- [[architecture-mandates]] — resource bounds for any managed lifecycle.
