# T3 Code

- **GitHub:** [pingdotgg/t3code](https://github.com/pingdotgg/t3code)
- **Website:** [t3.codes](https://t3.codes)
- **Type:** Local agent server + web client + Electron desktop + native iOS/Android
- **License:** MIT
- **Install:** `npx t3@latest`, desktop releases/package managers, or mobile app stores
- **Snapshot analyzed:** commit
  [`d7cf8aa`](https://github.com/pingdotgg/t3code/tree/d7cf8aaa8d4fbcbdd523b4f4bc86fda5c47b4a70),
  2026-09-04; latest release `v0.0.38` (2026-09-01)
- **Repository scale as of 2026-09-04:** 21,689 stars, 5,285 forks, 520 open
  issues; 1,008 test/spec files in the non-vendored tree

## Bottom line

T3 Code is one of YepAnywhere's closest and most serious competitors. It has
already shipped the broad product that many agent supervisors describe as a
roadmap: six provider drivers, a shared web/desktop/mobile runtime, native iOS
and Android apps, offline mobile sends, multiple remote-environment paths, an
integrated terminal, Git worktrees and per-turn rollback, and extensive
GitHub/GitLab/Bitbucket/Azure DevOps workflows.

The products nevertheless make a different architectural bet:

- **T3 Code is an integrated agent workbench.** It owns canonical thread state
  in an event-sourced SQLite model and adds developer-environment functions
  around the agent: Git, terminal, files, browser, usage, pull requests, and
  environment management.
- **YepAnywhere is a provider-native supervisor and private relay.** It treats
  provider transcripts as source material, discovers sessions made outside YA,
  preserves active provider runtimes across safe server reloads, supports
  conversation fork/clone, and offers an application-layer encrypted relay
  whose operator cannot read session traffic.

T3 Code is ahead on distribution, mobile polish, offline behavior,
multi-environment operation, and end-to-end development workflow. YepAnywhere
has the clearer advantages for zero-knowledge remote access, provider-native
history interoperability, session branching, reload resilience, and avoiding
silent project/Git mutation.

**Competitive threat: very high.** T3 overlaps nearly all of YA's surface and
has much greater adoption. Its breadth does not erase YA's differentiators, but
it raises the expected baseline for a polished agent supervisor.

## Product and architecture

T3's server is the authority for provider processes, Git, terminals, files,
authentication, and persisted orchestration state. Web, Electron, and React
Native clients use Effect RPC over one authenticated WebSocket. A shared
`client-runtime` package owns connection supervision, cached environment data,
and domain state for all client surfaces.

```text
web / Electron / native mobile
             |
       Effect RPC over /ws
             |
       local T3 server
       /      |       \
 providers   SQLite   Git / terminal / files / browser
     |
 Codex, Claude, Cursor, Grok, OpenCode, Antigravity
```

The orchestration core is more rigorous than a typical CLI wrapper:

1. A typed, idempotent command enters a serialized command queue.
2. A pure decider emits domain events.
3. Events, command receipts, and SQL projections commit together.
4. Queue-backed reactors perform provider I/O, checkpoint work, and thread
   settlement.
5. Clients consume projections and live subscriptions rather than rebuilding
   truth from provider logs.

This gives T3 durable command receipts, explicit recovery boundaries, and
offline-friendly read models. Its connection supervisor retries indefinitely
with capped exponential backoff, preserves cached shell/thread snapshots, and
ends live subscriptions when their last consumer leaves. The server also
windows thread history and coalesces live stream updates.

Sources: [architecture overview](https://github.com/pingdotgg/t3code/blob/d7cf8aaa8d4fbcbdd523b4f4bc86fda5c47b4a70/docs/internals/overview.md),
[connection runtime](https://github.com/pingdotgg/t3code/blob/d7cf8aaa8d4fbcbdd523b4f4bc86fda5c47b4a70/docs/internals/connection-runtime.md),
[orchestration contracts](https://github.com/pingdotgg/t3code/blob/d7cf8aaa8d4fbcbdd523b4f4bc86fda5c47b4a70/packages/contracts/src/orchestration.ts).

### Provider model

The six first-class provider drivers are:

| Provider | Integration |
|----------|-------------|
| Codex | App-server protocol |
| Claude Code | Anthropic Agent SDK |
| Cursor | ACP |
| Grok | ACP |
| OpenCode | OpenCode SDK |
| Google Antigravity | ACP |

Provider instances allow multiple accounts or configurations. Codex can use a
shared native home plus shadow authentication homes, so work and personal
accounts can coexist. Claude configurations are isolated; a thread cannot be
continued across configurations. T3 injects project/runtime context through
provider-appropriate developer, system, or ACP context rather than rewriting
the user's visible message.

Sources: [provider internals](https://github.com/pingdotgg/t3code/blob/d7cf8aaa8d4fbcbdd523b4f4bc86fda5c47b4a70/docs/internals/providers.md),
[Codex accounts](https://github.com/pingdotgg/t3code/blob/d7cf8aaa8d4fbcbdd523b4f4bc86fda5c47b4a70/docs/user/providers-codex.md),
[Claude accounts](https://github.com/pingdotgg/t3code/blob/d7cf8aaa8d4fbcbdd523b4f4bc86fda5c47b4a70/docs/user/providers-claude.md).

### Thread ownership and history

T3 gives each product thread its own ID, persists normalized messages and
activities in SQLite, and stores an opaque provider resume binding. Its product
command contract exposes create/delete/archive/settle/snooze/pin/reorder,
turns, approvals, input, checkpoint revert, and stop.

I found **no product command or UI for importing provider-native history,
discovering sessions created outside T3, or forking a conversation at an
arbitrary turn**. Codex's generated upstream schema contains `thread/fork`, but
T3 does not expose that operation in its client orchestration union. This is a
source-based inference rather than an upstream product claim: T3 resumes the
provider thread bound to a T3 thread, while YepAnywhere scans provider-native
session stores and presents external sessions in the same catalog.

Sources: [client command union](https://github.com/pingdotgg/t3code/blob/d7cf8aaa8d4fbcbdd523b4f4bc86fda5c47b4a70/packages/contracts/src/orchestration.ts#L1043-L1096),
[analytics boundary, which also explicitly excludes provider-history scans](https://github.com/pingdotgg/t3code/blob/d7cf8aaa8d4fbcbdd523b4f4bc86fda5c47b4a70/docs/internals/product-analytics.md).

## Feature strengths

### Native mobile and offline work

T3 ships native Expo/React Native applications in both app stores. The mobile
surface is not a thin WebView: it has a persistent offline outbox, queued thread
creation and turns, attachments, a native terminal, source review, push
notifications, iOS share extensions, on-device speech transcription, Live
Activities, and widgets. Web/desktop can create inline citations to assistant
output; mobile renders and navigates them.

This is T3's clearest lead over YA. YepAnywhere has a native Android shell and
mobile web/PWA, but no shipped native iOS client and no equivalent cross-surface
offline creation/outbox contract.

Sources: [root README and store links](https://github.com/pingdotgg/t3code/blob/d7cf8aaa8d4fbcbdd523b4f4bc86fda5c47b4a70/README.md),
[mobile internals](https://github.com/pingdotgg/t3code/blob/d7cf8aaa8d4fbcbdd523b4f4bc86fda5c47b4a70/docs/internals/mobile-development.md),
[composer](https://github.com/pingdotgg/t3code/blob/d7cf8aaa8d4fbcbdd523b4f4bc86fda5c47b4a70/docs/user/composer.md),
[voice input](https://github.com/pingdotgg/t3code/blob/d7cf8aaa8d4fbcbdd523b4f4bc86fda5c47b4a70/docs/internals/voice-input.md).

### Source control and workspace recovery

T3 integrates a larger portion of the development loop than YA:

- clone and publish repositories;
- local checkout or isolated worktree creation;
- working-tree and per-turn diffs;
- pull/merge request creation and suggested titles/descriptions;
- reviews, comments, labels, approval, merge/automerge, revert, and teammate
  branch checkout across GitHub, GitLab, Bitbucket, and Azure DevOps;
- terminal, file viewer, and an integrated browser.

Every turn can create a checkpoint using an isolated temporary Git index,
`commit-tree`, and hidden `refs/t3/checkpoints/...` refs. T3 can then show the
exact turn diff and restore the workspace; where the provider permits, it also
rolls provider conversation state back.

YA's source workbench is deliberately narrower: status/history/diff/blame,
review drafts, pull/push, and review-to-agent handoff, without staging,
committing, worktree creation, hosted-provider review operations, or exact
workspace rollback. T3 is materially ahead here.

Sources: [source control](https://github.com/pingdotgg/t3code/blob/d7cf8aaa8d4fbcbdd523b4f4bc86fda5c47b4a70/docs/user/source-control.md),
[checkpoint store](https://github.com/pingdotgg/t3code/blob/d7cf8aaa8d4fbcbdd523b4f4bc86fda5c47b4a70/apps/server/src/checkpointing/CheckpointStore.ts),
[Git driver](https://github.com/pingdotgg/t3code/blob/d7cf8aaa8d4fbcbdd523b4f4bc86fda5c47b4a70/apps/server/src/vcs/GitVcsDriver.ts).

### Thread triage

T3's sidebar is stronger than a simple chronological session list. It has
user-ordered pinned threads, active cards, snoozed and settled shelves,
archive, unread state, and status pills for working, monitoring, approval,
input, failure, wake, and completion. It supports multi-select settle, snooze,
retitle, mark-unread, delete, and unpin actions. A server-owned policy can
auto-settle idle threads or threads whose linked pull request closes/merges.

YA still has the more explicit **attention-priority** model: Needs Attention,
Active, Recent Activity, then bounded unread tiers, applied across YA-owned and
externally discovered provider sessions. T3 has the richer lifecycle model;
YA has the sharper inbox-ranking model. Neither should be reduced to "has bulk
operations" or "has status badges."

Source: [thread sidebar](https://github.com/pingdotgg/t3code/blob/d7cf8aaa8d4fbcbdd523b4f4bc86fda5c47b4a70/docs/user/thread-sidebar.md).

### Usage visibility

T3 combines Codex, Claude, and Grok history into token/cost/model/cache-savings
views and surfaces subscription limit windows. It can also query external
CLIProxyAPI usage hubs. YA exposes per-session context and provider
subscription usage, but does not yet match this cross-provider historical
dashboard.

Source: [usage](https://github.com/pingdotgg/t3code/blob/d7cf8aaa8d4fbcbdd523b4f4bc86fda5c47b4a70/docs/user/usage.md).

## Remote access and security

T3 provides four remote paths:

| Path | Shape |
|------|-------|
| Direct | Pair with the local server over LAN HTTP/WebSocket |
| Tailscale Serve | Server-managed private tailnet endpoint |
| T3 Connect | Clerk-authenticated discovery plus a managed Cloudflare Tunnel |
| Desktop-managed SSH | Desktop launches/manages a remote server and tunnel |

The authorization design is strong. Pairing grants carry method-level scopes
such as orchestration read/operate, terminal operation, review write, access
administration, and relay read/write. Browser auth uses an HttpOnly session
cookie; relay clients use bearer credentials with DPoP proof-of-possession;
WebSocket upgrades use short-lived, single-purpose tickets. Each RPC method is
authorized separately, and grants can be revoked.

There are two important trust-boundary differences from YA:

1. **T3 Connect is not application-layer end-to-end encrypted.** After cloud
   discovery, the client connects to a public Cloudflare Tunnel hostname whose
   origin mapping is plain HTTP to the local server. I found authentication and
   signing code, but no content-encryption layer analogous to YA's NaCl relay.
   Therefore security rests on TLS and the managed tunnel path, and that path
   can technically terminate application traffic. The T3 relay/control plane
   is not itself the chat hot path.
2. **Notification activity metadata reaches T3 infrastructure.** The relay
   accepts sanitized activity containing environment/thread IDs, project and
   thread titles, phase/headline/detail, model title, timestamp, and deep link
   so it can send push notifications. It excludes prompts, responses, tool
   details, and raw provider events, but it is not a zero-knowledge metadata
   design.

By contrast, YA's hosted relay forwards NaCl-encrypted frames after SRP-6a
authentication and cannot read the session payload. That remains a substantive
privacy differentiator, not merely a different pairing UI.

T3 also deliberately treats a paired environment as a broad machine-control
boundary. The ordinary orchestration-read scope can read any absolute file the
server account can read, not only project files, and terminal permission is an
explicit grant. That is coherent for a remote development workstation, but
users should not mistake pairing for project-scoped access.

Sources: [remote internals](https://github.com/pingdotgg/t3code/blob/d7cf8aaa8d4fbcbdd523b4f4bc86fda5c47b4a70/docs/internals/remote.md),
[environment auth](https://github.com/pingdotgg/t3code/blob/d7cf8aaa8d4fbcbdd523b4f4bc86fda5c47b4a70/docs/internals/environment-auth.md),
[T3 Connect](https://github.com/pingdotgg/t3code/blob/d7cf8aaa8d4fbcbdd523b4f4bc86fda5c47b4a70/docs/internals/t3-connect.md),
[managed endpoint mapping](https://github.com/pingdotgg/t3code/blob/d7cf8aaa8d4fbcbdd523b4f4bc86fda5c47b4a70/infra/relay/src/environments/ManagedEndpointProvider.ts),
[activity payload](https://github.com/pingdotgg/t3code/blob/d7cf8aaa8d4fbcbdd523b4f4bc86fda5c47b4a70/packages/shared/src/agentAwareness.ts),
[activity relay](https://github.com/pingdotgg/t3code/blob/d7cf8aaa8d4fbcbdd523b4f4bc86fda5c47b4a70/apps/server/src/relay/AgentAwarenessRelay.ts).

### Telemetry

T3's opt-out PostHog telemetry records provider/model/mode, outcomes,
durations, and aggregate token totals. Its documented exclusions include
prompts, responses, file contents, raw provider events, and durable IDs. It can
be disabled with `T3CODE_TELEMETRY_ENABLED=false`.

Source: [telemetry policy](https://github.com/pingdotgg/t3code/blob/d7cf8aaa8d4fbcbdd523b4f4bc86fda5c47b4a70/docs/user/telemetry.md).

## Direct comparison

| Area | T3 Code | YepAnywhere | Assessment |
|------|---------|-------------|------------|
| Product center | Integrated multi-agent workbench | Provider-native supervisor and private relay | Different core bet |
| Clients | Web, Electron, native iOS and Android | Web/PWA, signed Tauri desktop, Android shell; no native iOS | **T3 lead** |
| Providers | Codex, Claude, Cursor, Grok, OpenCode, Antigravity | Claude plus gateway/Ollama variants, Codex plus OSS/local, Gemini/ACP, OpenCode, Grok | Split: T3 has Cursor/Antigravity; YA has more local/gateway variants |
| Multiple provider accounts | First-class provider-instance registry | Provider configuration exists, without T3's equivalent account-switching UX | **T3 lead** |
| Existing native sessions | T3-owned threads and stored resume bindings | Scans provider-native stores and displays external sessions | **YA lead** |
| Conversation branching | Checkpoint/conversation rollback; no exposed fork/clone | Fork or clone from a completed user turn | **YA lead** |
| Workspace isolation | Local checkout by default; optional generated worktree | No automatic per-session worktree today | **T3 lead** |
| Workspace rollback | Per-turn hidden Git refs and exact restore | Review/diffs, no equivalent exact restore | **T3 lead** |
| Project mutation | Creates hidden Git checkpoint refs during turns | App-data-only by default; viewing/indexing does not create project/Git state | Deliberate tradeoff |
| Thread attention | Pin/order, snooze, settle, auto-settle, status, bulk actions | Priority-tiered inbox, global activity, archive/star/bulk across external sessions | Split |
| Source control | Full four-host PR/MR workflow plus clone/publish/worktrees | Inspection/review plus bounded pull/push and review-to-agent handoff | **T3 lead** |
| Terminal/files/browser | Integrated terminal, file viewer, browser | Source workbench; no equivalent integrated terminal/browser suite | **T3 lead** |
| Remote environments | Direct, Tailscale, Connect, desktop-managed SSH, environment catalog | Direct/Tailscale, relay, provider-host groundwork | **T3 lead** on breadth |
| Remote confidentiality | Scoped auth and managed TLS/tunnel; no app E2E found | SRP + NaCl application-layer E2E; relay sees ciphertext | **YA lead** |
| Mobile offline | Persistent outbox and cached environment/thread state | Draft persistence, but no equivalent native offline outbox | **T3 lead** |
| Runtime continuity | Server owns runtimes and can resume supported threads after replacement | Server owns processes; provider host preserves active runtimes across Hono reload | **YA lead** for live update continuity |
| Canonical history | T3 event store and SQL projections | Provider-native transcripts plus YA metadata/indexes | Different core bet |
| Usage dashboard | Cross-provider history, cost, limits, proxy hubs | Context and subscription usage, narrower history | **T3 lead** |
| General scheduling | No general task scheduler found | No general scheduler shipped | Parity/gap for both |

## T3 Code's strongest advantages over YepAnywhere

1. **A complete multi-surface product.** Native iOS and Android, Electron,
   hosted/local web, offline sends, app-store distribution, and platform-native
   affordances are already real rather than planned.
2. **The whole development loop.** Terminal, browser, files, Git worktrees,
   checkpoint rollback, repository setup, and four forge integrations keep
   users inside one interface.
3. **Shipped multi-environment operation.** The environment catalog and
   desktop-managed SSH path make multiple machines a normal product concept.
4. **Durable orchestration mechanics.** Event sourcing, idempotent receipts,
   drainable reactors, projections, and shared cached client state provide a
   strong foundation for unreliable networks and several client types.
5. **Provider account and configuration UX.** Provider instances solve a real
   work/personal-account problem without duplicating the whole environment.
6. **Lifecycle and usage tooling.** Pin/snooze/settle/auto-settle and the
   cross-provider usage dashboard are polished operational surfaces.

## YepAnywhere's strongest advantages over T3 Code

1. **Zero-knowledge relay traffic.** YA preserves application-layer E2E
   confidentiality across hosted infrastructure; T3 Connect does not appear to.
2. **Provider-native history interoperability.** YA discovers sessions created
   by the first-party tools instead of making its own event store the only
   useful catalog.
3. **Fork and clone.** YA can branch a conversation at a selected turn, not
   only rewind a workspace and its bound provider thread.
4. **Live runtime survival across server reloads.** YA's provider-host boundary
   can preserve active sessions while the web server reloads.
5. **No-surprise project storage.** YA's app-data-only default avoids adding
   hidden refs or directories just because a user views or runs a session.
6. **Local and alternate-provider variants.** Codex OSS/local, Gemini, and
   Claude gateway/Ollama configurations cover use cases absent from T3's six
   named drivers.
7. **A global priority inbox.** YA combines explicit attention tiers with
   provider-global discovery and external sessions rather than only organizing
   threads created inside the product.

## T3 Code gaps and risks

These are product or architectural tradeoffs, not claims that the project is
low quality.

- **No exposed conversation fork/clone.** Checkpoint revert is excellent for
  rollback, but it is not non-destructive branching from an arbitrary turn.
- **No external provider-session catalog found.** T3's normalized store is
  robust for its own threads but makes interoperability with first-party CLI
  history less visible than YA.
- **No application-layer E2E on the managed path found.** T3 Connect depends on
  Clerk and Cloudflare infrastructure and exposes sanitized activity metadata
  for push. Direct and Tailscale modes remain available without Connect.
- **Powerful defaults carry risk.** The default runtime mode is `full-access`,
  while the global workspace default falls back to the current local checkout.
  T3's own permissions guide recommends full access for disposable worktrees,
  but worktree mode is not the default.
- **Checkpointing mutates repository metadata.** Hidden refs are a capable
  implementation, but they conflict with YA's invariant that ordinary
  app-managed browsing/execution should not write into a selected repository or
  its Git metadata without explicit opt-in.
- **The paired-client boundary is machine-wide.** Read-scoped clients can
  request absolute files readable by the server account; the model is not a
  filesystem sandbox.
- **Breadth creates an operating tax.** One product spans Node, Effect,
  Electron, Expo/React Native, Swift, Kotlin, Rust helpers, Cloudflare, Clerk,
  PlanetScale, Axiom, and APNs. The dependency tree includes beta/RC packages
  and numerous pnpm patches. T3 offsets this with substantial tests and CI, but
  the maintenance surface is inherently large.
- **Very rapid, pre-1.0 evolution.** The README still calls the product very
  early, and the repository had 520 open issues at the snapshot. Issue count
  reflects scale and velocity as much as quality, but compatibility findings
  should be treated as date-specific.
- **Some documentation already drifts.** The mobile-package README says the app
  is not distributed, while the root README links to live iOS and Android store
  listings. The root README and stores are the stronger current evidence.
- **No general-purpose scheduler found.** T3 automates lifecycle settlement and
  preview/background work, but does not expose a recurring agent-job surface
  comparable to Codex automations or cron-oriented competitors.

Sources for defaults and caveats:
[runtime default](https://github.com/pingdotgg/t3code/blob/d7cf8aaa8d4fbcbdd523b4f4bc86fda5c47b4a70/packages/contracts/src/orchestration.ts#L120-L127),
[permission guidance](https://github.com/pingdotgg/t3code/blob/d7cf8aaa8d4fbcbdd523b4f4bc86fda5c47b4a70/docs/user/permission-modes.md),
[workspace settings](https://github.com/pingdotgg/t3code/blob/d7cf8aaa8d4fbcbdd523b4f4bc86fda5c47b4a70/packages/contracts/src/settings.ts),
[mobile README](https://github.com/pingdotgg/t3code/blob/d7cf8aaa8d4fbcbdd523b4f4bc86fda5c47b4a70/apps/mobile/README.md).

## What YepAnywhere should learn from T3

### High-value ideas to borrow

- Treat the multi-environment catalog and shared reconnect/cache runtime as the
  standard for making remote hosts feel ordinary on every client.
- Add offline send/outbox semantics before claiming mobile-network resilience;
  draft persistence alone is not the same guarantee.
- Consider pin, snooze, and linked-PR auto-settlement as complements to YA's
  priority inbox, without replacing its attention tiers.
- Make provider accounts/configurations explicit instances with clear resume
  compatibility rules.
- Close the practical development-loop gaps: integrated terminal, worktree
  provisioning, and hosted Git review operations.
- Reuse the security ideas that do not weaken YA's relay promise: method-level
  capabilities, short-lived WebSocket tickets, proof-of-possession, and
  revocable pairing grants.

### Ideas to adopt only with YA-specific constraints

- Per-turn checkpoints are valuable, but any implementation must respect YA's
  project-directory storage contract. It should require an explicit opt-in or
  store recoverable state outside the repository rather than silently creating
  YA-owned Git refs.
- Event sourcing the entire product would be expensive and would undermine the
  provider-native history advantage. Smaller pieces—idempotent mutation
  receipts, drainable queues, and cached reconnect state—are more transferable.
- A managed tunnel can improve setup, but it should not replace YA's
  application-layer E2E encryption or make cloud identity mandatory for core
  self-hosted use.

## Research method and confidence

The repository was shallow-cloned to the gitignored local reference path
`references/t3code` and pinned to the snapshot above. Findings came from its
public documentation, manifests, contracts, implementation, tests, release
workflows, and current GitHub metadata. The analysis distinguishes documented
behavior from inferences based on absence in the product command/API surfaces.

Confidence is **high** for architecture, providers, remote/auth flows,
checkpointing, defaults, mobile capabilities, and source-control breadth;
**moderate** for negative findings such as the lack of external-session import,
conversation fork, or general scheduling, because rapidly evolving products
can have incomplete or unindexed surfaces.
