# Agent Own-Session Inspection

> `ya-agent self` reports the owning YA session's launch settings, current
> selections, and observed provider evidence through a read-only local service.
> `ya-agent view` reports what each browser tab shows beside that session.

Topic: ya-agent-self

Verified: 2026-09-08. Opt-in implementation; broader command tooling remains
in [the runtime proposal](agent-command-runtime.sketches.md).

## Enable and discover

Start YA with `YEP_AGENT_SELF=1` (or `true`) and launch or resume a provider
process. Default is off. The environment must reach the actual YA server;
for the desktop app, set it in the environment used to launch the application.
Changing it does not update an already-running provider process.

Supported launches are local Claude, Claude Gateway, Claude Ollama, and Codex
with `bypassPermissions`. Remote executors, YA session sandboxes, and other
Codex permission modes receive no grant. Inspection does not widen filesystem
or network permissions. A provider's independently configured sandbox may
still prevent it from reaching loopback.

YA creates a private temporary command directory and adds it to the child
PATH. The command is bundled with the owning server version: source checkouts
use their source entry and local TS loader; npm uses installed compiled files;
desktop uses compiled files and its absolute private Bun executable. No global
`ya-agent` installation is needed. The Windows launcher is `ya-agent.cmd`
for native command-shell use; macOS/Linux use an executable shell wrapper.
Windows Git Bash discovery of `.cmd` is not part of this initial contract.

Run `ya-agent self` for human output or `ya-agent self --json` for a versioned
report. There is no automatic prompt advertisement or New Session UI yet.
Operators can put this instruction in **both** `~/.codex/AGENTS.md` and
`~/.claude/CLAUDE.md`, or their managed source files:

> When asked which model, effort, or YA session you use, check whether
> `ya-agent` is on PATH and run `ya-agent self --json`. Distinguish launch
> settings, selected settings, provider evidence, and pending changes. Report
> unknowns explicitly. The result identifies the owning YA session; an
> inherited child-agent environment does not prove the child's own model.
> If unavailable, say so rather than guessing from your prompt or aliases.
> When the user refers to "the app", "this page" or the file they have open,
> run `ya-agent view` and say which tab the answer describes.

YA does not edit those instruction files. graehl/agents and `agentctl` remain
independent consumers of session facts; no installation or change there is
required for this command.

## Evidence contract

Schema version 1 includes canonical `sessionId`, per-launch `launchId`,
`launcher`, `harness`, `provider`, `observedAt`, and these distinct fields:

| Field | Meaning |
| --- | --- |
| `launch.model`, `launch.effort` | Original explicit request, or `status: "default"` with null value. |
| `selected.model`, `selected.effort` | YA's selection, including an effort change waiting for a provider boundary. |
| `providerEvidence.model` | Latest observed init, configuration acknowledgement, assistant response model, or accepted adapter control. |
| `providerEvidence.effort` | Observed configuration acknowledgement or accepted adapter control; otherwise unknown. |
| `pending.effort` | Whether the supervisor still has an effort change awaiting successful application. |
| `activeInference` | Always `"unknown"`; session settings do not attest to every in-flight inference request. |

Each model/effort value has `value`, `status` (`known`, `default`, `unknown`),
`source`, `scope` (`launch`, `session`, `response`), and its own observation
timestamp. `adapter-control` means the adapter returned successfully, not
provider confirmation of a specific inference. An assistant model observation
describes that response. Alias strings are preserved; downstream gateway model
revisions and backend identities are not inferred. Native child agents can
inherit the owning session's capability while using different settings.

The projection lives beside the provider adapter. The supervisor publishes
pending effort through an optional provider-host capability/RPC. On retained
worker paths, the service and observations outlive Hono controller detach and
reattach. The process REST API remains separate and retains its existing
semantics. No provider settings or durable session data are written by reads.

## View inspection

`ya-agent view` reports what the user's browser tabs show beside the owning
session: an app, an artifact, a file viewer, a tool-detail panel, or the
project app. It answers "which app is open" from the browser's state instead
of the agent's own last printout. `--json` returns the versioned report;
`--all` lists every reporting tab in human output, which otherwise shows
only the selected one. Exit codes and failure JSON match `ya-agent self`.

The server does not otherwise know this state: pane contents and the
Appearance setting are browser-local, and tabs may differ. So each tab
reports its own view, and the report never merges tabs:

| Field | Meaning |
| --- | --- |
| `clients[]` | One entry per reporting tab, most recently focused first. |
| `clients[].clientId`, `device` | Per-tab id (stable across reload, distinct per tab) and a coarse device label. |
| `clients[].focused`, `focusedAt` | Whether the tab was visible and focused at its last report; when it last was. |
| `clients[].publishedAt` | The tab's last report. A closed tab that could not report leaving keeps its entry; judge staleness by this age. |
| `clients[].viewers[]` | Empty for a transcript-only tab. Each has `kind` (`app`, `artifact`, `file`, `panel`, `project-app`), `label`, `target`, optional `url`, `openedBy` (`session` or `user`), `state` (`open`, `minimized`), and `placement` (`right-pane`, `covering`, `full-view`). |
| `selectedClientId`, `selection` | The tab a question most likely means: `most-recently-focused`, else `most-recently-published`, or `none` with no tabs. |

`target` is in the agent's terms: the loopback URL the agent printed for a
proxied app, the artifact link, the file path with its line suffix, `app` or
`artifact:<id>` for the project app, and null for a panel. `url` is the
browser-facing address. Both drop query and fragment, where YA places app
bearers. `openedBy: session` means a fresh tool announcement or a turn-end
project-app update opened it; every other open is a user gesture, including
re-selecting an app the session had opened.

Collection follows the same opt-in: only a server with `YEP_AGENT_SELF`
enabled mounts `PUT /api/sessions/:sessionId/view` and
`DELETE /api/sessions/:sessionId/view/:clientId` and advertises
`agent-session-view`, and only then do clients report. A tab reports for the
visible session route, at most once per 250 ms burst and only when its
viewers or focus changed; leaving the route reports the departure. Reports
are ordered per tab and invisible in the UI. A limited user's report is
refused; that tab stops reporting until reload. The server keeps reports in
memory only, at most eight tabs per session (least recently reported
dropped) and 512 sessions, with no expiry timer. Each change is forwarded to
the session's live provider owner, and a newly registered or remapped
process receives the current list. A process launched without a self grant
receives nothing.

This is the pull half of
[the sketch](../gaps/sketches/agent-visible-session-view.md); MCP and native
tool adapters and a push notice remain there.

## Connection, lifetime, and failures

The owner injects `AGENT_YA_API_URL` and `AGENT_YA_API_TOKEN`. The only routes
are `GET /v1/self` and `GET /v1/view`, authenticated by the bearer token. The token selects its own
session; callers cannot choose a target. `AGENTCTL_SESSION_ID`, when available,
is sent as `X-Agent-Session-Id` and checked against the bound canonical id.
Token-only lookup supports shells without the late Bash session-id bridge.
Before binding, the service returns `session-not-ready`.

One ephemeral listener/bin is shared within each provider-owner process.
Grants expire after 24 hours and are revoked when the provider iterator ends
or is aborted. Resume a provider process to obtain a new grant. Last-lease
teardown closes the listener and removes the directory. There is no idle poller
or liveness extension. Ambient self credentials are stripped before a new
provider launch receives its own grant. Tokens are not placed in arguments,
reports, or logs; like other environment capabilities, they are readable by
code executing inside the provider's trust boundary.

The CLI accepts only the injected IPv4 loopback HTTP origin, makes one request
with a five-second total deadline and 64 KiB response limit, and never searches
for a different server. JSON failures are
`{"schemaVersion":1,"error":{"code":"..."}}` on stdout. Human failures go to
stderr. Exit codes are:

| Exit | Codes |
| --- | --- |
| 0 | Successful report |
| 2 | `usage` |
| 3 | `unavailable` (missing or invalid launch context) |
| 4 | `unauthorized`, `expired`, `session-mismatch` |
| 5 | `session-not-ready`, `owner-unavailable` |
| 6 | `unsupported-protocol`, `invalid-response` |

Unsupported launches normally have no command on PATH. A leftover inherited
launcher without credentials cannot acquire a new grant or call operator APIs.

## Validation owners

- `packages/server/test/agent-tools/`: actual CLI/service subprocess tests,
  scripted Claude SDK shell execution, supervisor boundary application, and
  retained-owner reattachment/remapping. No cloud LLM is required.
- `packages/server/test/routes/session-view.test.ts`: report validation,
  per-tab separation, focus memory, departure and bounds.
- `packages/client/src/hooks/__tests__/useSessionViewPublication.test.tsx`:
  capability gating, viewer projection without bearer queries, change-only
  reports, other-session isolation, project app, and departure.
- `packages/server/test/sdk/providers/codex.test.ts`: fake app-server launches
  a real Bash tool through the production Codex adapter.
- `scripts/agent-self-smoke.mjs`: source or artifact-only imports plus real
  shell execution with global runtime discovery removed from PATH.
- `scripts/agent-self-package-smoke.mjs`: packs and installs the npm artifact
  into an isolated temporary directory before probing it (Linux CI).
- CI runs source tests on Linux/macOS/Windows and an installed npm artifact
  probe. Desktop CI runs the probe with bundled Bun through the existing
  resource smoke gate, including signed macOS application checks.

These tests prove deterministic transport, delivery, provenance, and lifecycle
behavior. They do not claim an unmocked cloud model followed the instruction
or that a provider reported an exact hidden backend revision.

Related: [tactical](../docs/tactical/122-ya-agent-self-inspection.md),
[environment boundaries](subprocess-environment.md),
[provider host](provider-host-api.md), [desktop](desktop-v0.md).

## HTTP v0 discovery is a separate opt-in

Settings → Local Access → **Agent API discovery** supplies eligible local
unrestricted launches a separate `AGENT_YA_V0_*` credential and minimal HTTP
instruction. Legacy `ya-agent self/view` and `AGENT_YA_API_URL/TOKEN` keep their
original authority. See [HTTP v0](http-api-v0.md#local-agent-bootstrap) for lease,
transport and reload contracts.
