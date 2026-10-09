# Project service

> A project service declares where a project's app lives and how YA starts,
> checks, stops and serves it, independently of an agent session or an optional
> reserved hostname.

Topic: project-service

Status: **Project App, service lifecycle and project address settings implemented.**
The App entry works in direct and relay clients, with separately admitted
service and reservation APIs. The sandbox runner serializes lifecycle actions,
checks readiness through its private broker and reports interrupted state after
restart without adopting a PID. Desktop/phone browser checks cover the main
viewer, composer handoff, retained canvas/draft and simulated viewport shrink.
Native tablet keyboard acceptance remains in the linked keyboard gap.
User-directed scope, 2026-09-28:
project App access for limited users and the superuser, standardized template
service declarations, optional vhost association, and audit-preserving removal.
The [template integration gap](../gaps/project-template-standup.md) tracks
delivery. This topic owns the implemented root-artifact and manual publication
direction; the interactive fixture is `packages/client/mockups/project-service/`.

## Project App and Settings

The ordinary New Session page shows an **App** button in its header, opening
the selected project's app beside the composer, only when the browser-local
**Appearance → Show project app while composing** setting is enabled, the
server advertises `project-service`, and the selected project declares a
usable app (the same check as the session's App button). The setting defaults
off for all principals, independently of the Session right pane setting.
Project App navigation remains available independently through an explicit App
entry; server capability alone does not reveal the composing button.

Projects offers **Open app**, opening the main content pane with the same
isolated rendering and viewer controls as the session's right App pane. It
does not require opening or retaining an agent session. Keep the card's
existing session navigation and gear action. Project Settings contains **App**
and, only when server vhost serving is enabled, **App address**. Both principal
kinds use this surface; authorization determines the available actions.
App lifecycle and address controls appear inline in the project settings
dialog, alongside sharing and session defaults. Opening settings does not
open an app frame or mint a viewing grant. Wide dialogs use two columns;
phones retain one scrolling column and visible save controls.

Resolve the default target on entry in this order:

1. A declared project service or static app. A stopped or failed service shows
   its state and an authorized Start or Retry action, rather than silently
   substituting another artifact or starting a process on a GET.
2. Otherwise, the most recently associated artifact the principal may access.
   Use server-recorded association order, not file mtime or whichever session
   was last opened. Session-published artifacts name their canonical project
   and source session; authorization is rechecked at association and open.
3. With neither, show “No app or artifact yet” and the existing session action.

When both exist, offer **App / Latest artifact**; default to App. Keep a viewed
artifact stable while newer ones arrive and offer the new association without
replacing the iframe during interaction. Store the artifact identity, entry,
source session and association time in YA app data, never just a bearer URL.
Mint a fresh scoped viewing grant on an authorized open. Expired grants can be
renewed; missing files or a vanished session-private filesystem are explicitly
unavailable. Association does not imply copying an ephemeral artifact forever.

The project **App** entry opens the viewer itself, filling the available
main-pane height. Reuse the in-session right pane's thin top band, shared
viewer header, icon-button sizes, title truncation and window actions. Do not
surround it with a project header, inset card, margins or a second status band.
Back, Reload, Open in new tab and Copy link retain their viewer treatment;
add New session, Share, Settings and the microphone in that same top band.
New tab, Back, new session and mic are direct icon actions with accessible
labels. Keep the icon band thin, truncating its title when space is tight;
service details stay in Settings.
Closing it changes navigation only. Stop is a separate service control in
Settings. Use the existing iframe sandbox, credential
separation, and safe new-tab behavior in [active-content security](active-content-security.md).
App content never shares the authenticated YA origin. On phones the viewer
fills the main pane; Settings is a separate full-width view.

Any grant that shows a limited user the project, including View sessions, lets
them open its App and **Start** a stopped service, since running it is how
they use it (maintainer direction, 2026-09-28). **Stop**, address
reservation and serving still need Start sessions. `ProjectAppInfo.canStart`
reports the first; older servers omit it and `canExecute` governs both.

A session in a project that declares an app offers the same **App** toggle in
its header even when it was not opened from the project App entry; it starts
closed and opens this viewer in the right pane. Holding that button (or
right-clicking it), or the viewer's full-view button, opens **full view**:
the same pane, frame kept live, covers the session and sidebar until Back
or Escape returns it beside the session (maintainer direction, 2026-09-28,
for kid-friendly tablet use).

App toolbars use one compact row and can collapse to a small corner button
without remounting the app or its controls. Collapse chooses the right corner;
a horizontal swipe on the unoccupied bar chooses its direction's corner.
The fullscreen action uses the browser Fullscreen API with navigation UI
hidden when supported, and reports refusals. Full view and New tab remain
available independently. iPad system clock/battery visibility remains under
the browser/OS's control; this does not promise their removal.

At turn boundaries the session compares App information and opens the pane
when a usable app first appears or its update stamp changes. The optional
`ProjectAppInfo.updatedAt` is the resolved static entry's mtime in ISO format,
or the process runtime record's update time, including an active runtime whose
source declaration changed. Unknown stamps are omitted. Older servers without
the field support first-declaration detection only, not rebuild detection.
The optional stamp is recorded under `project-app-address-links`; clients
feature-detect the field without requiring a new capability.

**New session** creates one session in this project using the user's normal
provider/model defaults and enforced locks, with the viewed app already open
in its full-height right pane when the viewport has room. The microphone is
on the app viewer's thin top bar, both in the project App view and when the app
is in-session. It delegates to the usual composer speech transaction; it is
not a separate recording form, modal, transcript buffer or send policy. From
the project App entry it establishes one new project-session context and
starts that composer's voice flow. Once in-session, it controls that same
composer rather than creating another session on each press. It does not
submit an empty turn or send speech before the ordinary voice/send policy
allows it. Request microphone permission through the existing flow; denial
leaves a usable text composer and the app. Guard duplicate taps and carry a
stable target identity, renewing its viewer grant rather than copying a stale
URL. This explicit action authorizes the pane opening for the new session
without changing the user's global right-pane preference.

Preserve the selected STT backend and all current
[composer speech behavior](mic-button-speech-ui.md), including Grok Smart Turn
when enabled, command handling, speech insertion, manual-edit holds, grace
windows and follow-up listening. Do not force manual Send as part of the App
entry. Both mic affordances reflect one capture state and stop the same
transaction. Speech startup does not require summoning the software keyboard.

Small phones normally have no simultaneous pane layout: App is full-screen,
and the conversation/composer is a separate full-screen surface. Switching
between them preserves the app and draft; it does not leave a shrunken app
card or a sliver of conversation. The app top bar retains recording/stop
access while its session is listening. Tablets may use the ordinary
full-height side-by-side viewer when space permits; native keyboard behavior
must not be presented as a guarantee of a keyboard confined to the session
column.

Canvas sizing under temporary keyboard occlusion and preserving the current
composer-adjacent session content are tracked in the
[keyboard-awareness gap](../gaps/sketches/keyboard-aware-app-and-session-viewport.md).

**Copy link** copies an authorized, current viewer link; it does not publish
or reserve anything. Explain when that link grants transferable access and
when it expires. **Share** offers existing public-audience artifact sharing
when this target, server and principal support it, without requiring a vhost.
For a service, it may offer reservation and serving through enabled vhosts,
subject to publication authority and the private-apps ceiling. Show an existing
association first. Opening Share alone has no side effects; confirm the
intended access before creating a grant or publishing. Publicly reachable
artifact bearer links remain link-required access, distinct from the vhost
“Public — no link required” option. With neither delivery option available,
explain that sharing is unavailable rather than sending unsupported requests.

## Standard declaration: where, start, status, stop, serving

Templates keep `.project-template/app.json` as their source-owned declaration.
An optional, explicitly versioned `service` object is validated by the YA
template loader. The template
manifest's existing `formatVersion: 1`, file composition, `setup`, `build`,
`test`, `preview`, `prepare`, and add-on contracts remain unchanged. Source
format documentation, loader validation and capability admission define the
extension together. Existing source libraries may retain their older format:
YA adapts only `{ "kind": "static", "dir": "dist" }` to a static entry
`index.html`. It never infers process commands from legacy preview/start fields.
The source library's server add-on must emit the versioned declaration before
its process can use this lifecycle.

Example for a template with an application server:

```json
{
  "service": {
    "version": 1,
    "where": { "kind": "process", "cwd": ".", "entry": "/" },
    "start": { "argv": ["npm", "run", "start"], "portEnv": "PORT" },
    "status": {
      "probe": "http",
      "path": "/health",
      "readyStatus": 200,
      "startupTimeoutMs": 30000
    },
    "stop": { "signal": "SIGTERM", "graceMs": 5000 },
    "serving": { "target": "sandbox-loopback", "protocol": "http" }
  }
}
```

| Section | Contract |
| --- | --- |
| `where` | Discriminated `static` or `process`. Process `cwd` is project-relative and `entry` is an app-relative URL path. Static declares `root` and a relative file `entry`. Resolve symlinks and reject project escapes, absolute filesystem paths and external entry URLs. |
| `start` | Process only: nonempty argv, no implicit shell, run in canonical `cwd`. YA allocates a private-namespace port and passes its decimal value through `portEnv`: `PORT` or an uppercase name ending in `_PORT`, excluding `YA_`, `YEP_` and `AGENT_` names. This cannot overwrite executable-loader or control-plane variables. The server must honor it, bind loopback and stay foreground. No daemonizing or user-service escape. |
| `status` | Process only: YA probes the declared HTTP path through that launch's broker until the exact expected response or startup timeout. Never execute a template-supplied status command. Probe only the owned endpoint; redirects cannot turn this into an arbitrary fetch. |
| `stop` | Process only: stop the owned process group with SIGTERM, wait `graceMs`, then report stopped or failed-to-stop. No arbitrary kill command, port-owner lookup, unrelated-process signaling or implicit SIGKILL. |
| `serving` | Static uses `target: "static-root"`; process uses `target: "sandbox-loopback"`, `protocol: "http"`. This names the backend, not a public hostname, bearer, PID or host port. Vhost association lives separately in YA app data. |

For process delivery without a wildcard hostname, `serving.basePathEnv` names
an environment variable through which YA supplies the app's scoped URL prefix.
Use `BASE_PATH` or an uppercase name ending in `_BASE_PATH`, excluding `YA_`,
`YEP_` and `AGENT_`. The app must honor that prefix for navigation, assets and
API calls; YA prefixes its readiness probe too. A generic root-relative app
requires a dedicated hostname. YA does not rewrite arbitrary response bodies.

A static template such as the initial App canvas declares:

```json
{
  "service": {
    "version": 1,
    "where": { "kind": "static", "root": "dist", "entry": "index.html" },
    "serving": { "target": "static-root" }
  }
}
```

Static serving has no application process or Start/Stop command. YA reports
ready when the contained entry exists and can be served, otherwise missing
build. Build remains an explicit authorized operation under the project's
execution policy, never a side effect of viewing. Activating the server add-on
replaces the static declaration with a process declaration atomically, only
after its entry and commands are valid. Do not invent a server for a static
bundle merely to supply lifecycle buttons.

Reject unknown versions, conflicting kind-specific fields, malformed argv,
unsafe paths, and out-of-range timeouts before launch. The declared readiness
probe supplies configuration; observed status is YA-owned runtime data.
Settings shows the entry/root or command as read-only details, not a limited
user form accepting host paths or arbitrary targets.

## Live preview

An optional top-level `livePreview` in `.project-template/app.json` contains
a version-1 **process** service declaration, separate from the built `service`.
The canvas/web-app template supplies `npm run dev`, `PORT`, and `BASE_PATH`.
The App toolbar's **Live preview** toggle starts that explicit command through
the same project sandbox, readiness probe, broker, and owned-process teardown.
It requires project execution authority. Merely viewing an app never starts a
watcher. Stop an existing normal service before selecting a different mode;
duplicate starts of the same mode reuse the current generation. Turning off
Live preview stops that process and reopens the declared built app.

The development server owns source watching and update delivery. Vite hot
updates or full page reloads both satisfy live preview; YA does not poll source
files, launch competing builds, or reload the frame on a timer. Failed updates
remain visible through Vite's error overlay; the previous working page is not
replaced by a broken `dist/` build. Startup errors retain a bounded log tail.
Preview processes have the same explicit lifetime as other project services;
turn the toggle off to release their watchers. With provider hosting enabled,
preview survives replacement of the web server while its host remains alive.
Loss of the runtime owner requires another explicit start.

**Decision:** use the template's existing dev server rather than a second YA
build watcher. This preserves framework HMR and error handling, and confines
the process through the existing service owner. The static build remains
available without running a watcher.

`project-live-preview` (ID 102, introduced in 0.9.4) owns `mode: "live-preview"`
on POST `/api/projects/:projectId/app/start`, `livePreview` and `mode` on App
information, and app WebSocket forwarding. The maintainer approved the optional
compatibility plan on 2026-09-29: stable v0.9.0, v0.9.1 and v0.9.2 lack it.
Without it, clients hide Live preview and never send its start mode; ordinary
App and Reload keep their previous gates. Existing capability meanings do not
change. Templates declare availability, not permission to execute on viewing.
Existing projects need the new declaration and port/base-path-aware dev config;
updating a template source does not rewrite their files.

## Runtime ownership and confinement

YA owns one launch generation per project service, independently of provider
session lifetime. Duplicate Start requests reuse the current launch; serialize
Start/Stop and reject stale-generation results. States are **Stopped,
Starting, Running, Stopping, Failed**, plus **Unavailable** when confinement or
delivery prerequisites are missing. “Running” requires the readiness probe;
a PID alone is not readiness. Bound probe work, retain useful failure/log
details, and do not poll an idle or unseen project indefinitely.

Every service of a sandboxed, limited-user-created project runs entirely in
its project sandbox with the network firewall on. No unconfined preview,
setup/build helper, daemon, or host service may substitute when the sandbox
is unavailable, even when the superuser presses Start for that project.
The project root is the writable project boundary; vhost publication cannot
widen it. Reuse the enforced sandbox launcher and private runtime directories
rather than treating `cwd` as confinement. Static output may be read and
served by YA without executing project code on the host.

Persist declaration identity, runtime owner and desired/observed state in YA
app data. Never adopt an unrelated listener or trust a recycled PID. Stop tears
down the owned sandbox and broker after the app exits, retaining the declaration,
working files and name reservation.

### Managed app lifetime

When a compatible provider host is enabled and registered, it owns one app
worker, separate from provider-session workers. That worker runs the same
project service manager and sandbox launcher. Hono replacement (including Safe
Reload) reconnects through authenticated host RPC to the same launch, broker,
port and token. Startup restores transient app-host routing as well as reserved
names, so an existing app link remains usable. Closing Hono releases its client;
it does not stop hosted apps. Stopping the provider host or its terminal owner
stops its apps. This is survival of the web server, not survival of a machine
reboot or a full wrapper/host shutdown.

The private `project-services` feature is negotiated before use. Execution
authorization stays in Hono: the worker asks the current request's registered
controller to recheck grants at each queued lifecycle boundary. Disconnect or
revocation refuses pending execution. Host loss fails explicitly and never
starts an in-process replacement. A failed app worker is not automatically
replaced inside the same host; restarting the host performs owned cleanup first.
The owner bounds requests at 128, data directories at 32, and apps per data
directory at 32. It uses no idle polling or heartbeat per app.

With hosting intentionally disabled or unsupported, the existing in-process
manager remains available and stops apps with Hono. Persisted host ownership
prevents this mode from duplicating or pretending to stop an app that may still
belong to a live host: enable hosting again to inspect or stop it. Missing owner
fields in older records mean in-process ownership. After owner loss, persisted
state reports interruption; automatic relaunch is not implemented.

Provider hosting supports Linux and macOS Node source launches; Unix-domain
IPC is not Linux-specific. Project service execution still requires the
existing enforced project-write sandbox and network firewall, currently Linux.
Neither hosting nor fallback relaxes that requirement. Static apps need no
runner and remain independently available.

Project Settings and Settings → Apps show app state and explicit Start/Stop
separately from reserved-address serving. Dismissing the pane changes neither.
Link authorization is independent: configured app-bearer revocation invalidates
old links/cookies and closes app WebSockets, but does not stop the process or
delete data. Launch links last until the owned launch ends; persistent hostname
links have no automatic expiry. Optional timed app links remain in
[app access](../gaps/app-artifact-access-control.md). Artifact grants retain
their separate expiry and declared file-ownership rules; app lifecycle actions
never infer permission to delete working files from a path, command or port.

**Decision:** reuse the optional provider host as app parent rather than adding
an always-running app daemon or tying apps to a provider session. This reuses
authenticated discovery, process identity and terminal cleanup while allowing
ordinary non-hosted installations. Apps retain independent project sandboxes;
no agent queue or provider-session lifetime is shared.

## Two delivery paths, one sandbox target

**Without a reserved vhost:** authorized App viewing must work without enabling
operator vhost hosting or claiming a public name. An authenticated project
request selects the permitted app, and a scoped, isolated viewer delivery
path proxies only its backend through the sandbox broker (or serves its static
root). Static apps use existing artifact grants. A process honoring
`basePathEnv` uses `/p/<launch-token>/` on the isolated artifact origin, including
the public artifact origin for relay clients. This bearer path is cookie-less:
YA strips request credentials and response cookies, gives it an opaque sandbox
origin and allows credential-free CORS for its own API calls. The token expires
with the launch. Apps requiring cookies/storage or root-relative URLs use a
dedicated app hostname instead. Missing safe delivery configuration fails
explicitly; never iframe host loopback or serve executable HTML on YA's origin.

**With a reserved vhost:** the configured tunnel/router carries requests to
YA's app host handler, which authorizes the app request and forwards to that
same sandbox broker and service generation. The tunnel does not launch the
app outside the sandbox. Strip YA credentials and app-access credentials
before forwarding, following existing app-proxy policy. Public hostname
reachability and app health are separate status dimensions.

Existing pieces verified in source on 2026-09-28:

- `session-sandbox-port-broker.mjs` splices a YA-only Unix socket connection
  to a requested port in the sandbox namespace, with connection and idle
  bounds. It opens no host TCP port and relaxes no outbound firewall rule.
- `artifacts/vhost-proxy.ts` (`proxyLoopbackVhost`) can use that broker socket.
  Current session App links mint a transient private app host and require app
  serving to be configured; they are not the no-vhost project delivery path.
- Raw WebSocket upgrades now dispatch through the same app authorization and
  sandbox broker as HTTP, on both the main and separate artifact listeners.
  The `/p/<launch-token>/` path also carries Vite HMR without configured vhosts.
  Static artifact paths and YA control endpoints are not app WebSocket targets.
  See [app WebSocket access](active-content-security.md#app-websocket-access).

The separate project runner reuses these sandbox facilities. Viewing never
starts it. Settings refreshes status on entry and after lifecycle actions;
explicit Reload renews the current target, without background replacement of
an interacting iframe. A changed declaration is shown alongside the active
launch; stopping that launch remains possible even if the new file is invalid.

## App address in project Settings

Administrators see **Project apps** immediately below manual Vhosts in
Settings → Apps. This is a second surface for the same lifecycle/address
controls, not a second service configuration. Inventory loads on entry and
explicit Refresh, with no idle polling. It includes declarations (including
invalid or missing builds), owned launches and retained reservations. Old-domain
and unavailable-project reservations remain visible; administrator release
rotates the address bearer and frees the claim without deleting files or
stopping a service. Static apps have no Start/Stop control.

The inventory requires an app declaration, an owned launch or a retained
reservation. An unrelated project whose directory is missing is not an app.
Project folder and other table headers sort the displayed rows; paths share
the responsive middle-elision component with manual vhosts. Selecting a row
opens its details, and the `_` control minimizes them back to the list.

Administrators can separately confirm **Delete app** or **Delete project**
beside the minimize control. Both remove exactly `.project-template/app.json`,
stop the owned app through its serialized lifecycle and revoke/release every
reserved address, including previous namespaces. The declaration's canonical
parent must remain inside the project. App deletion keeps project registration;
project deletion then unregisters it through the existing project API. Neither
deletes the directory, source/output files, sessions or removal audit history.
Artifact grants retain their separate lifecycle. Failed cleanup is reported
and inventory refreshed; completed steps are not silently rolled back.

`project-app-deletion` (ID 110, explicit optional bit) gates administrator
DELETE `/api/projects/:projectId/app` and both new controls. The 2026-10-01
review uses the approved v0.9.0–v0.9.2 corpus, which has no project-app routes.
Without the bit, details show update guidance and send no deletion request.
Standing maintainer compatibility authorization applies.

`project-app-inventory` (ID 101, version-implied from 0.9.4) owns administrator
GET `/api/project-apps` and POST `/api/project-apps/address/release`. The existing
principal boundary denies both to limited users. Maintainer approval on
2026-09-29 covers v0.9.0–v0.9.2, which lack the contract: older servers retain
manual Vhosts and an update note; clients make no inventory request.

Static reserved-address opens redirect to an isolated artifact bearer. Access
changes apply at the reserved address on the next request; previously issued
artifact grants retain their independent expiry/revocation lifecycle.

Hide the entire vhost section when server vhost serving is disabled or the
server lacks the required capability. Retain any previous association in
storage; disabling the feature does not release a name. Re-enabling displays
the existing association before offering a new reservation.

When enabled, show the current/previous reserved hostname, owner, private or
public visibility, and **Reserved / Serving / Unavailable** separately from
service status. A stopped app still shows its reserved address. With none,
offer **Reserve address** to an authorized principal, prefilled with an
available-looking `username-project` suggestion but validated atomically by
the server. Never silently replace an existing association or take over a
name. Reservation alone neither starts the app nor publishes it.

**Serve at this address** is an explicit separate operation, gated by the
superuser or the limited user's **Allow public apps** permission (default off),
with Start sessions access. Name-prefix restrictions and the **Private apps only**
ceiling apply server-side. A private link remains a transferable app bearer,
so label it “Private link required”, not “Only me”. Public access is a separate
unchecked choice where allowed. A reservation grant does not imply publishing
authority. Keep first-claim-wins persistence and superuser-only release from
[project templates](project-templates.md#persistent-app-name-reservations).

The limited project owner's current public-app permission is the ceiling for
public access a limited user chose. Revocation makes such addresses require a
token again at the next request. The superuser is not capped by it
(user-directed 2026-09-29): public access the superuser saves is recorded as
theirs and served regardless of the owner's permission. A limited user
re-saving it unchanged keeps it; turning public access off discards it. A
private-only app shows an explanation instead of an inert Public checkbox,
and a user without publishing permission is told the administrator can make
the app public. Where public access is allowed, **Save access** applies the
checkbox without changing serving state.

**Allow copying private app links** defaults on independently of publication.
Authorized users see the current address URL and Copy viewer link beside it;
with the permission off, the API withholds private address URLs and the App
viewer hides its share/copy controls. This governs link-distribution controls,
not the ability to extract a URL needed to view an app. Viewing authority is
unchanged; public URLs remain visible. Previous-namespace rows get no link.
The `project-app-address-links` capability covers these permissions, optional
URLs and release/copy flags. Without it clients omit new permission fields and
the URL row; v0.9.0–v0.9.2 lack this contract (approved 2026-09-28).

Release remains superuser-only and rotates the address bearer before freeing the claim. Static
reservations redirect authorized opens to a contained artifact grant; process
reservations proxy the same sandbox. Previous namespace rows stay visible in
Settings while vhosts are enabled, and cannot silently be reassigned.

## Authorization and audit-preserving removal

Reuse the authenticated YA principal and existing project grants; do not add
a service-local identity system. View requires project read access, lifecycle
actions require project execution authority, and publication requires the
separate ceiling above. Recheck grants and confinement at execution, including
queued operations and after reconnect. Unknown or inaccessible projects do
not leak service state, artifact paths, reservations or logs.

A limited user's project delete action means **Remove from my projects**.
Confirm that meaning and persist a principal-scoped hidden marker, actor and
time. It does not delete files, unregister the canonical project, erase
sessions/audit records, stop a service, release an address, or remove the
project from the superuser's view. Apply hiding consistently across that
user's project lists and selectors; it does not revoke access grants.
The superuser sees “Removed from archer's view” and can inspect the retained
project. Restoration clears the marker with an audit event. See
[limited users](limited-users.md#approved-project-removal-retention).

Personal hiding and audit storage are implemented under
`personal-project-hiding`; project App Settings shows retained removal records
to the administrator and provides Restore with a fresh audit event.

## Delivery acceptance

Before calling this implemented, verify the real main-pane path for both
principal kinds and both client transports: latest artifact, static starter,
running/stopped/failed service, absent/disabled vhosts, previous reservation,
and insufficient grants. Cover concurrent claims and lifecycle requests,
provider exit, YA restart, expired/missing artifacts, revoked access and
symlink escapes. Prove writes and direct network access outside the project's
sandbox stay denied with and without vhost serving. Removing a project as a
limited user must survive reconnect/restart as a personal hide while the
superuser still sees the project, sessions, service and reservation.

Advertise new project-service and reservation behavior under separate precise
capabilities; existing template or session-app capabilities do not imply it.
Compatibility plan approved by the user on 2026-09-28 (`Qcompat`): reviewed
stable releases v0.9.0, v0.9.1 and v0.9.2 lack this contract. Introduce separate
capabilities for App/service routes, reservations and personal project hiding.
Absent a capability, keep existing project/session behavior and send no new
requests. Do not broaden existing capability meanings. Rendered mockups
establish layout only, not these guarantees.
