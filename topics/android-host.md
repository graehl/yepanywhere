# On-device Android host

Status: experimental scaffold in `packages/android-host`, authorized 2026-10-17.
This is an Android distribution of the YA host, separate during incubation from
the remote companion. It is not yet an independently usable released product.

## Product and ownership

The Android device owns real Claude Code and Codex processes, projects, native
session files, and YA storage. The existing YA server and web UI are shared with
desktop. Do not fork their conversation UI or agent harness. Use Alpine/PRoot
for the current runtime; native Android builds remain an optional later spike.
PRoot shares Android's kernel and grants neither root nor workspace isolation.
The explicit full-access Codex experiment is authorized; Android app confinement
remains while Codex's incompatible additional Linux sandbox is disabled.

Normal use should eventually require only the phone and internet. A desktop
helper may bootstrap/re-arm same-phone ADB after reboot. AAR is optional
development infrastructure, not a normal-use dependency or credential service
that ships by default. Provider authentication runs on the phone.

There are separate ADB dependencies. Runtime staging is a temporary development
installer, described under distribution below. The original phone-control spike
also enabled `adbd` with `adb tcpip 5555`, then connected from the phone using
its own ADB identity. That route supplies Android shell authority for device
control; the Linux runtime alone does not. The sibling spike's original
`docs/product-direction.md`, source `85f2e3c9f04ba4aabf0309b50b5c74437b88ca28`,
accepted USB re-arming after reboot. `adb forward`/`reverse` are different,
temporary tunnels: the spike's reverse tunnel carried AAR inference traffic,
which phone-local direct provider sign-in no longer requires. A normal Play
install should support local coding without ADB setup. ADB-based phone control
still needs explicit platform setup; a Play install or app toggle cannot grant
that authority. Phone-only wireless-debugging setup remains an alternative to
qualify. The separate Moto helper report below supplies evidence for automatic
recovery after initial privileged setup, rather than establishing that USB must
be repeated after every reboot on every implementation.

The focused shared YA sign-in pages are the current onboarding baseline.
Native **Set up Codex** and **Set up Claude** shortcuts open those pages, which
relay the actual local CLI login flow and hand authorization to the system
browser. The user completed and confirmed both subscription sign-ins on the
Pixel 9 on 2026-10-17. Buddy and AAR informed the approach; their flows are no
longer a placeholder for unimplemented host onboarding. Credential refresh,
sign-out and recovery still need independent validation; see the
[physical sign-in evidence](../docs/testing/android-host-scaffold-2026-10-17.md#completed-provider-sign-in).

### Reported Moto automatic debugging recovery

**User-supplied Tomly device-access report, 2026-10-30; not independently
inspected or reproduced in this session.** The linked external worktree was
unavailable. The report describes a native helper provisioned once over USB
with relay configuration, `WRITE_SECURE_SETTINGS`, normal accessibility consent
and retained ADB host authorization. After `BOOT_COMPLETED` and Wi-Fi readiness,
it requests wireless debugging, handles the exact network-trust dialog only
for explicitly enrolled access points, discovers the changing listener port
and forwards its local socket through an authenticated outward WebSocket.
The Mac owns the ADB client/server and protocol authorization; the helper
does not run an on-phone ADB client/server or PRoot.

The reported USB-unplugged, untouched-phone run completed three reboots,
boot counts 43 through 46, with ADB recovery in 126/131/129 seconds. Each cycle
passed 1 MiB push/pull, screenshot, native tap and actual Android drag/drop.
A subsequent ten-minute screen-asleep run passed 21/21 direct ADB checks.
Qualification is limited to that Moto with screen lock disabled and enrolled
Wi-Fi. With a PIN, the current boot receiver depends on first unlock. Hosted
relay deployment, cellular-only operation, longer Doze and other firmware
remain unqualified; the tested relay ran on the Mac.

This is a candidate recovery mechanism for MC/YA evaluation, not an adopted
helper or YA acceptance result. A normal Play install cannot itself obtain
the settings authority used in this experiment:
[`WRITE_SECURE_SETTINGS`](https://developer.android.com/reference/android/Manifest.permission#WRITE_SECURE_SETTINGS)
is a special system/development permission, distinct from an ordinary runtime
consent prompt. The helper can restore debugging because setup already granted
that authority; FCM by itself still cannot. Its narrowly matched, enrolled
network-prompt handling is also distinct from model-directed accessibility
control and needs its own source/platform/distribution review.

The proven remote byte tunnel is not yet an on-phone agent control adapter.
Local Claude/Codex sessions still need an on-phone ADB protocol client or
native MC adapter to use the recovered listener. Keep that adapter, listener
recovery, relay/push wake and the user-controlled enable/disable boundary
separate. No new physical-device test or debugging/settings change follows
from recording this report.

## Guest user and administration

The host runs YA and its provider children as the guest account `user`
(UID/GID 1000), with Bash and `/home/user` as its persistent home. The guest
hostname is `ya-phone`, including `hostname`, `uname -n` and Node's hostname
API. Android retains its own hostname, kernel version and architecture. The
Linux harness uses the same account and explicitly sets its container hostname.
The Android guest binds its own hostname/hosts files from the payload because
Docker export does not retain the container's generated versions of those files.

`sudo` is the standard pinned Alpine package. The `user` account has passwordless
guest administration, including `sudo apk add ...` and `sudo -i`; ordinary
commands start as `user`. Both account passwords remain locked. This is a
development convenience under the existing Android app execution boundary,
not a YA principal, API grant, real Android root or a boundary between mutually
untrusted Linux users. PRoot emulates credentials and ownership; Android still
enforces one app identity. Supplemental groups and file ownership need not look
like a conventional multi-user kernel. Guest sudo does not grant Android
permissions, privileged mounts or Codex sandbox support.
Runtime staging restores sudo's setuid marker after Android tar strips it;
the binary remains owned by the Android app identity. PRoot uses that marker
for the emulated guest-root transition.

Changing the guest home does not move or rewrite the persistent Android
`files/state` tree. It is bound at `/home/user`, while `/home/host` remains a
symlink to that same directory so saved project/transcript paths continue to
resolve. Provider sign-ins, profiles, local access credentials and YA data stay
in their existing private storage. Custom accounts, sudo policy changes and
installed packages belong to the replaceable runtime and are not preserved by
runtime staging; this does not change the durable workspace contract below.

`host.py smoke` exercises the real Linux account, sudo, hostname and old-home
alias alongside the existing protected server/SQLite restart check.
`host.py check-user --serial ...` runs the same opt-in identity/admin check
against the installed debug app's Android PRoot, preserving existing state and
removing its temporary witness files. It does not establish provider sign-in,
inference, Doze or interrupted-turn recovery.

Physical acceptance on the explicitly selected Pixel 7a (2026-10-18) covers the
staged APK/payload, standard sudo and root login, a temporary package installed
and removed through sudo without network, an additional temporary guest account,
both provider CLI version commands, hostname/name resolution and two real
service-owned server launches. All 135 pre-existing state files remained present;
the 106 provider-profile/access-credential files were byte-identical after both
launches. Temporary account, package, files, probe runtime and transport were
removed; the selected host was left stopped. This did not exercise inference or
revalidate provider authentication. Linux Alpine smoke, Android Debug/Release
builds/lint and the required root checks passed.

## Durable user-owned workspace

### Built-in shared storage

With optional all-files access enabled, primary shared storage is mapped to
`/sdcard` on host start without choosing a folder or taking a SAF grant.
Downloads, Documents and other accessible shared files use ordinary direct
filesystem operations. The native folder screen distinguishes current
availability from the applied mapping and offers controlled restart.
Unavailable authority/storage exposes a blocked path, not a private fallback;
new provider launches under `/sdcard` recheck authority and applied identity.
Existing handles/processes do not gain new mappings or guaranteed immediate
revocation. Named shortcuts remain optional; runtime, credentials and YA state
remain private. `/sdcard` always means primary shared storage, not a removable
card. Mounted writable removable volumes map independently to
`/storage/<volume-id>` without a picker, using StorageManager UUIDs rather than
labels or enumeration order. Native status distinguishes availability from the
applied mapping. New provider launches recheck authority, writable mount state
and applied source; media transitions invalidate the affected volume until an
explicit host restart, including after reinsertion. Other volumes stay usable.
Unavailable/unknown volumes never become private writable fallbacks. Existing
I/O and handles retain Android's removal semantics; this is not unplug safety.
The [workspace guide](../packages/android-host/docs/workspaces.md) owns
volume qualification, failure/recovery details and physical evidence.

Disposable `-PworkspaceFixture` builds use loopback port 13420; normal host
builds keep 13400. Native readiness, WebView origin checks and the shared
runtime agree on the compiled port, so fixture tests can leave a running normal
host untouched. Linux defaults remain 13400.

### Multiple folder shortcuts

**Implemented in the experimental host, 2026-10-18.** Save up to 16 named,
user-selected folders with two independent access methods: optional direct
filesystem mappings for qualified local folders, and explicit `ya saf` document
operations using persisted individual folder grants. All-files access is
optional; the host and SAF operations remain usable without it. UI status
separates current SAF/direct health from mappings applied to the running host.

Direct roots appear at stable paths such as `/workspaces/docs` and
`/workspaces/downloads`. These are PRoot path bindings, not Unix symlinks or
new filesystem mounts. Select an available direct path as a normal YA project's
working directory; both providers use their ordinary file and shell tools.
Enable direct access per shortcut, then explicitly apply mappings/restart the
host. Restart confirmation warns that active turns are interrupted. Names,
selection and requested direct access survive ordinary host restarts.

The native **Pick folder** action opens Android's picker without requesting a
name first. The selected display name becomes the shortcut, preserving case,
spaces and Unicode within the guide's path-safety/length bounds. Name collisions
use the first free `-1`, `-2`, `-3` suffix. Optional Rename changes a shortcut
afterward; Reselect and app updates preserve its existing name. Canceling adds
nothing, and picking an already registered folder reports its existing shortcut.
Root-status rendering waits until Rename closes so background refreshes do not
interrupt sequential typing.

The native UI adds, reselects, renames and removes registrations. Removing a
shortcut leaves external files intact and releases unused SAF permission.
Registrations and permissions are not restored from erased app data: select the
same existing folders again, optionally reuse the same aliases, and recover
external bytes without a YA marker. Internal sessions, credentials and databases
have their separate private lifetime.

Before each provider launch beneath `/workspaces`, the server asks the native
host to recheck registration, applied identity, individual grant and actual
broad permission. Failure rejects admission; healthy roots remain usable.
Disabled/unavailable mappings expose blocked placeholders, never writable
private fallback directories. Existing sessions/handles are not revoked by
this admission check. All-files authority still permits broader raw access by
the app UID; these registrations are product policy, not directory confinement.

Pixel 7a/API 37 acceptance passed two actual picked roots, both real YA provider
sessions writing into both mappings, SAF CRUD without broad permission, separate
revocation/repair, controlled restart, shortcut cancellation/rename/removal and
fixture data-clear/reinstall recovery. Independent bytes/hashes covered 10 files;
owned fixture resources were removed and existing user documents preserved.

The [workspace guide](../packages/android-host/docs/workspaces.md) owns CLI
syntax, bounds, permission/recovery behavior and physical acceptance. Native
qualification and SAF document I/O live in MC under its MIT license; YA owns
UI, registration, transport and runtime integration. CLI transfers are explicit,
without synchronization or a transparent general SAF filesystem. Provider writes
report completion/errors honestly; partial external writes cannot promise
rollback, POSIX atomicity or cloud durability.

### Earlier single-folder qualification

**Disposable physical spike passed, 2026-10-18.** The tested workspace is an
ordinary user-chosen local shared-storage folder, such as
`Documents/YAshare`. Optional Android all-files access is accepted for this
feature. Android's folder picker chooses the folder; its SAF grant alone does
not authorize raw filesystem access. Qualify the built-in local provider,
resolve and verify its real path, and bind that same directory into Alpine/PRoot
as `/workspace`. Shell, Python and both real provider CLIs write the external
files directly; there is no private copy, asynchronous synchronization, publish
step or new filesystem mount.

Files must survive clearing host app data or reinstalling. Re-enable permissions
and select the existing folder again to recover access. File lifetime, permission
lifetime and the erased app-local registration are separate. Recovery can create
a fresh registration; it does not depend on a hidden YA marker or restore erased
provider credentials, sessions or application databases.

All-files access belongs to the runtime app UID and grants broader shared-storage
authority than the directories shown inside PRoot. PRoot does not grant
additional Android authority or contain it to the chosen folders. Keep
replaceable runtime binaries, provider homes, credentials, temporary files and YA
SQLite private. Unsupported permissions, provider identities or missing folders
must fail visibly, never redirect writes into a private fallback directory.

The [local workspace spike](../packages/android-host/workspace-spike/README.md)
owns the bounded implementation, commands, physical acceptance and filesystem
limitations. Use a disposable application and newly created fixture folder on an
explicitly selected Pixel 7a. Preserve the signed-in host and existing documents.
Verify external bytes/hashes independently, both real providers, process restart,
revocation, app-data clear/reselection and uninstall/reinstall/reselection.
The Pixel 7a/API 37 passed both real providers, independent SHA-256 checks of
28 files, restart, separate SAF/all-files revocation/repair, app-data clear and
uninstall/reinstall recovery. The fixture and owned tree were removed afterward;
the signed-in host was not changed. This qualifies the storage route, not
production host onboarding or session lifecycle integration.

The measured directory is case-insensitive and does not support symlinks,
executable bits or `flock`. Ordinary CRUD, positional writes, replace and fsync
passed. Git required `core.createObject=rename`, `core.fileMode=false` and
explicit trust for the selected repository under PRoot's simulated root; do not
use wildcard `safe.directory` trust. SQLite WAL and writer contention passed a
bounded fixture, while YA's live internal databases remain private.

A selected root's provider/volume/document identity and current grant health
are distinct. On reset the registration is erased; the user selects the existing
folder and grants authority again. Renamed/moved/missing folders require explicit
repair rather than inference from a display name. The fixture sentinel only
witnessed test identity; production recovery requires no project marker.
Releasing SAF access is an admission failure, not raw-path revocation while
all-files remains enabled. Fresh raw reads failed after all-files was disabled;
already-open handles and running-session revocation remain unqualified.

**Explicit SAF access:** the installed `ya saf` commands now reuse these same
named roots without broad permission. The completed original single-folder
spike did not prove this; the later host acceptance is recorded in the
[workspace guide](../packages/android-host/docs/workspaces.md#physical-acceptance-and-limits).
Arbitrary-provider behavior remains provider-specific and unqualified beyond
source review. No general adapter or unprivileged FUSE mount is assumed.

The existing [MC data spike](../../machine-control/platforms/android/resident-spike/README.md#independent-photo-and-document-reads)
proves read-only document access across app restart, not this direct-path mode.
Android documents [SAF URI operations](https://developer.android.com/training/data-storage/shared/documents-files)
and [direct paths under all-files access](https://developer.android.com/training/data-storage/manage-all-files)
as distinct access mechanisms.

## Phone capabilities and assistant entry points

**Exploration recorded 2026-10-17; these capabilities are not implemented in
the host and are not new release prerequisites.** The phone should be useful
without ADB through user-enabled native Android capabilities, while ADB remains
an optional stronger route. Keep detailed platform research and reusable device
operations in Machine Control's
[Android exploration](../../machine-control/topics/android-family-control.md#app-resident-provider-exploration)
and [source/API research](../../machine-control/research/platforms/android.md#app-resident-capabilities-without-adb).
APK/module packaging and permission isolation remain open.

YA supplies the provider sessions, onboarding, supervision and full work UI.
Quick assistant entry points should lead into that same work: share a photo or
document to a session, ask by voice, invoke an optional default-assistant
surface, or ask about the current screen. A request that becomes substantial
should continue in the existing full interface with its conversation, files,
tool results and approvals. Do not create a second agent harness or a parallel
reduced conversation product for quick tasks.

Candidate capabilities include accessibility observations/actions/screenshots;
SAF documents with explicit workspace import/export; photo selection or media
access; contacts and calendars; camera/microphone; location; notifications;
native intents for sharing, maps, calls/messages and alarms; and optional
assistant-role integration. Health Connect is a further possibility. Offer
grants in context when a requested task needs them, query focused data, and
show unavailable/revoked capabilities honestly. Native API access and UI
automation complement one another; neither grants arbitrary app-private data.

MC should expose one native operation implementation through CLI/MCP facades
usable by either local provider and authenticated remote callers. Like the
ChromeOS composition, different Android facilities can serve different
operations without duplicating the user-facing control vocabulary. YA should
consume those operations rather than accumulate independent device drivers.
Assistant invocation, custom hotwords, locked-screen behavior, runtime wake and
ADB re-arming require distinct validation; none follows from a permission
toggle alone. This exploration does not change the existing incubation order.

The [Machine Control resident spike](../../machine-control/platforms/android/resident-spike/README.md#acceptance)
now proves the stateful Python bridge on the Pixel 7a with real on-phone Codex
and Claude sessions, fixture-file effect witnesses, inline screenshots and
stale/grant/revocation refusals. Its native fixture is a separate APK; the test
uses this host's Alpine runtime but does not automatically register phone
control in ordinary YA sessions. It does not implement the broader capabilities
listed above or establish background, remote or reboot acceptance.

## Distribution and optional phone automation

**Direction clarified 2026-10-30; implementation and store acceptance pending.** The
basic product is the existing YA coding host on a phone. It should be useful
without AccessibilityService, an accessibility MCP, ADB or the assistant role.
Phone computer use is a core product capability, controlled by an explicit
default-off app toggle; optional enablement does not make it an unimportant
future feature. The toggle must gate actual control operations and report
missing/revoked platform authority, rather than merely hide tools from prompts.
The implementation must establish how disabling it retires existing control
access. PRoot and same-app shell access are not an independent security boundary;
withholding an MCP declaration alone cannot revoke a separately usable ADB key.
The preferred advanced phone-automation route is explicit developer-options
setup and the existing MC/ADB facilities, with a computer able to bootstrap or
re-arm the phone's listener. Shizuku's on-phone wireless-debugging setup is an
alternative to study, not an adopted dependency or implemented fallback.

Built-in autonomous AccessibilityService control remains unselected. The
computer-use direction does not select that mechanism, an assistant-role
integration, or a second agent harness. Local coding, optional device control
and optional remote access belong to the same phone-owned host.

The [October 30 distribution comparison](../docs/competitive/android-host-distribution.md)
records stronger precedents than the original Termux/compiler comparison:
UserLAnd and standalone Andronix distribute downloadable Linux environments,
and UserLAnd's AiCLI is publicly listed on Play for Claude Code/Codex in Ubuntu.
This supports proceeding with concrete packaging work; it does not reveal
Google's review rationale or approve YA's exact payload and control mechanism.

The current desktop/ADB provisioning dependency is an unfinished installer,
not a PRoot requirement. The APK bundles native PRoot libraries but not the
Alpine/Node/YA filesystem. `host.py prepare` builds `runtime.tar`, and `stage`
extracts it through debug `run-as` into app-private storage. HostService refuses
a missing `opt/host/launch.mjs`; no in-app runtime installer exists. Normal
installation must replace that development path with phone-owned provisioning,
keeping replaceable runtime files separate from persistent credentials/sessions.
Bundled or Play-delivered assets and verified in-app downloads are packaging
candidates; the delivery choice and update contract remain to be selected.

Google's [device/network policy](https://support.google.com/googleplay/android-developer/answer/16559646?hl=en)
restricts external executable downloads and app self-updates, with a bounded
VM/interpreter exception. PRoot runs native guest instructions on Android's
kernel; the word container does not establish that exception. Termux and
compiler IDEs provide relevant development-environment precedents, but their
presence does not establish YA approval or an individual package-review rule.
Runtime packaging, provider updates and locally compiled user programs remain
separate review questions. A basic host is a credible candidate, not a
confirmed submission outcome.

The [AccessibilityService policy](https://support.google.com/googleplay/android-developer/answer/10964491?hl=en)
specifically prohibits autonomous planning/actions through that API outside
qualifying disability tools; deterministic scripts are distinguished. This is
not a blanket ban on coding agents. Disability assistance must be the product's
primary purpose, not incidental positioning. ADB setup does not exempt later
behavior from other policies. Recheck both live policies before submission.

The October 18 Buddy snapshot documents a Play closed test and a restricted
Play flavor. The October 30 README instead recommends a direct Play link;
the follow-up could not independently confirm its track availability. Its GitHub
flavor's self-update opens Android's installer for the user to confirm; it is
neither a silent APK replacement nor the Play flavor's update mechanism. The
[Buddy review](../docs/competitive/buddy.md) preserves source evidence and
the limits of the reported closed-test status.

## Remote access and wake direction

**Priority clarified 2026-10-30; not implemented.** Reliable access to the
phone-owned host from another device is important. Remote wake means reaching
the native host app when its ordinary relay socket is suspended or absent,
then attempting bounded host readiness and relay reconnection. It does not
mean turning on the display or unlocking the phone, and it does not grant
phone-control authority.

An FCM registration plus the existing separate push-broker infrastructure is a
candidate delivery path. Relay connection and push enrollment are separate:
the experimental host has neither Firebase integration nor a wake receiver.
The published companion's [push enrollment](android-fcm-push.md) delivers
server events to companion clients; it does not wake this host. A candidate
flow is an authorized remote wake request, broker/FCM delivery, native service
recovery, relay registration, then ordinary authenticated encrypted access.
Existing pairing/owner authority remains the authentication boundary; a push
token or relay target name is not permission to access the host. Revocable
wake authorization must exist before the host becomes unreachable. The exact
protocol, enrollment and rate limits remain design work.

**Direct sibling reference, reviewed 2026-10-30:** YepControl, locally still
checked out as `android-remote-access`, already implements this class of wake.
At source `152b20c1e8eb24dac67f6fb376d52bbd3201be39f`, its
[Cloudflare FCM sender](https://github.com/kzahel/yepcontrol/blob/152b20c1e8eb24dac67f6fb376d52bbd3201be39f/docs/cloudflare-fcm.md)
renews Google access tokens on demand in Workers/Durable Objects. Native
`RemoteMessagingService` checks local access policy and the hint, presents a
connection notification, and schedules `WakeWorker` to establish an
authenticated outward connection. Push remains a hint, not authority. The
[production cutover evidence](https://github.com/kzahel/yepcontrol/blob/152b20c1e8eb24dac67f6fb376d52bbd3201be39f/docs/cloudflare-production.md#verified-production-cutover--2026-10-22)
records process-absent FCM receipt in 1,682 ms and encrypted exchange in 2,164 ms
through Cloudflare on an owned emulator. The separate
[physical acceptance](https://github.com/kzahel/yepcontrol/blob/152b20c1e8eb24dac67f6fb376d52bbd3201be39f/docs/fcm-wake-v1.md#physical-pixel-7a-acceptance)
covers screen-off forced-Doze wake on its earlier hosted sender. Review these
implementations before designing YA wake; this is stronger than the companion
notification analogy. YA's long-lived Node/PRoot service, provider work and
MC/ADB recovery still require their own integration/acceptance. No YepControl
credentials, Firebase registration, pairing authority or runtime dependency
are adopted by this reference.

[FCM priority guidance](https://firebase.google.com/docs/cloud-messaging/android-message-priority)
limits urgent delivery to time-sensitive user-visible behavior, and
[Android background-start rules](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start)
constrain foreground-service starts. A silent push is not an unlimited runtime
or immediate-delivery guarantee. Force-stop requires subsequent user action
under [Android's stopped-state contract](https://developer.android.com/about/versions/15/behavior-changes-all#stopped-state).
Reboot/unlock, OEM power restrictions, network loss, native process loss and
same-phone ADB re-arming need separate acceptance. A push cannot itself restore
an unavailable ADB listener; the separately reported Moto helper above uses
pre-granted settings authority for that recovery. This direction adds no
unattended behavior to YA today.

## Assistant entry-point research

**Compelling optional direction recorded 2026-10-18; documentation/source
research only. No device investigation, assistant-role changes, implementation
spikes, hotword tests or locked-screen experiments are authorized by this
discussion.** Earlier generic exploration is not authorization to start one.

The candidate experience is a quick way into the same YA sessions: invoke the
assistant while looking at another app, ask about the visible error/document,
and continue substantial work in the existing full YA interface. Screen context
could be useful even with no ADB or autonomous phone control. This does not
select a separate assistant agent loop or a replacement conversation UI.

### How Android users invoke an assistant

These are published platform instructions, not observations of the maintainer's
phone or proof of how a future YA assistant would be invoked:

- On supported Pixels, holding the bottom navigation handle/Home button opens
  **Circle to Search**. It is not a generic gesture for whichever app holds the
  assistant role. See [Circle to Search help](https://support.google.com/pixelphone/answer/14508957?hl=en).
- Common assistant routes include holding Power on Pixel 6+ when configured
  for the assistant, or swiping diagonally inward from a bottom corner with
  **Swipe to invoke assistant** enabled. The relevant settings are under
  System / Gestures and System / Navigation mode. OEMs, navigation modes and
  settings can differ. See [Pixel gesture help](https://support.google.com/pixelphone/answer/7443425?hl=en).
- The selected assistant is configured through the device's default-app /
  digital-assistant settings. Google-specific wake phrases or Circle to Search
  must not be assumed to transfer to a third-party assistant.

### Capabilities and unresolved boundaries

Android's [Assist documentation](https://developer.android.com/training/articles/assistant)
describes a user-selected assistant overlay receiving available screen text,
structure and a screenshot. User settings, protected windows and app behavior
can limit context; it is not unrestricted continuous screen access.
The [assistant role](https://developer.android.com/reference/android/app/role/RoleManager#ROLE_ASSISTANT)
and [voice-interaction sessions](https://developer.android.com/reference/android/service/voice/VoiceInteractionSession)
are the API starting points. Participating apps can expose direct actions;
the role does not itself grant arbitrary taps, root, shell privileges or
another app's private data.

The selected [VoiceInteractionService](https://developer.android.com/reference/android/service/voice/VoiceInteractionService)
is kept resident, but Android explicitly expects it to be lightweight and
separates heavy session work. This is not proof that Alpine/provider processes
survive indefinitely. Invocation, available context, consent before provider
submission, a cold/stopped host, default-assistant replacement costs, optional
voice input, protected content and return to a durable YA session all need
future design/validation. No gesture compatibility, custom hotword, wake,
locked-screen access or provider-lifetime acceptance is claimed here.

## External research references

The dedicated [Buddy](../docs/competitive/buddy.md),
[Shizuku](../docs/competitive/shizuku.md) and
[Termux](../docs/competitive/termux.md) reviews distinguish source findings,
upstream claims and policy interpretations. The
[reference map](../docs/competitive/android-host-references.md) and
[pinned YAML manifest](../docs/competitive/android-host-references.yaml) record
exact revisions, local reading paths and reproducible checkout instructions.
These are research sources, not YA runtime dependency or release-artifact pins.
Reusable device-operation implementation still belongs to Machine Control.

## Implemented scaffold contracts

- A separate application id coexists with the existing companion and original
  feasibility APK. No existing app data or radio/debugging setup is replaced.
- One verified Alpine payload serves Android and Linux tests. YA is built from
  this checkout, with source and dependency identity recorded in the payload.
- The host profile sets `YEP_RESOURCE_SAMPLE_SECONDS=0`, disabling periodic
  resource samples, 10 ms event-loop monitoring and continuous stall profiling.
  These general-server diagnostics must not keep an idle Android PRoot runtime
  busy. External session tracking and Codex periodic corpus rescans remain
  disabled; this host's own saved-session history/resume remains available.
- Android explicitly starts a visible foreground service. That service owns the
  runtime process tree independently of either activity. Stop keeps durable
  state and signals the runtime's dedicated process group, with a forced sweep
  after two seconds. Killing only the PRoot tracer is insufficient. This bounded
  stop does not promise a live provider turn has checkpointed. No boot receiver,
  restart loop or remote push wake is installed.
- Debug builds, including the isolated Lab, support ADB-only start, stop,
  restart and authoritative status without opening an activity, waking the
  display or dismissing keyguard. The service and snapshot provider are exported
  only in debug builds and require Android's privileged `DUMP` permission;
  ordinary applications cannot drive them. Release builds keep both components
  non-exported. This is OS administrator access through already authorized ADB,
  not a YA principal, remote grant or authentication bypass for the HTTP API.
  `tools/host.py control` sends explicit shell service intents and waits for
  native ready/stopped state; restart also requires a new runtime generation.
  Status does not start the runtime. Unavailable ADB, an unsupported package,
  an older/private component or a failed/expired readiness attempt fails the
  command; there is no activity launch or screen-control fallback. Decrypted
  app storage and an already provisioned runtime are prerequisites. See the
  [headless commands](../packages/android-host/README.md#headless-debug-lifecycle).
- **Open Yep Anywhere**, **Set up Codex** and **Set up Claude** are explicit
  requests to start a stopped host. The native screen waits for the current
  credential to be accepted by the protected loopback API before navigating.
  A saved token, old status text or spawned process alone is not readiness.
  Startup readiness has a 45-second budget with bounded individual request
  timeouts. Attempts show native progress, then a
  recoverable error with **Retry** and **Host controls**. Missing provisioned
  runtime is reported immediately; saved state is retained.
- **Open** brings an existing WebView forward. A healthy completed page keeps
  its document and route on return; it is not reloaded merely because the user
  visited the browser or native controls. Unavailable hosts are started and
  recovered with a fresh credential read and the last usable local route.
  Top-level load failures show native recovery, including service-worker fetch
  errors reported by WebView as `main=false` when they match the outstanding
  top-level URL. A navigation-intent readiness check covers failures delivered
  before that top-level callback, even when no load-completion event follows.
  Fragment-only jumps preserve the document. Unrelated subresource errors do
  not replace the page. A completed page load also checks backend readiness. Failed
  pages are unloaded so hidden JavaScript cannot keep retrying indefinitely.
- A persistent native toolbar exposes **Home**, **Tabs** with a count, and
  **+** above both the web UI and recovery screens (requested 2026-10-18).
  Home returns to the native
  main menu without finishing the web activity; **Open Yep Anywhere** returns
  to its selected tab. Android Back retains the ordinary activity-close
  behavior; use Home to keep the mounted document alive.
- The native WebView container owns system-bar and display-cutout spacing
  once, including side cutouts in landscape. It forwards zero for those
  handled insets to CSS while preserving keyboard/visual-viewport updates.
  Opening, switching tabs and recreating the activity must not retain duplicate
  safe-area padding. Shared browser/PWA safe-area styles remain unchanged.
- Tabs follow the companion's single-mounted-document pattern: up to 32 local
  tabs, a switcher with page titles/paths, selection and separate close targets,
  and new tabs opening Projects. Page titles stay in memory only. Long-pressing a local link offers **Open in new tab**;
  user-initiated local new-window links open a tab. External links still open
  the system browser. Switching/closing destroys the old WebView and cancels
  its readiness request, so inactive tabs own no running JavaScript, connection
  subscriptions or readiness polls. Up to 64 history entries per tab are kept
  in memory. Switching reconstructs the document rather than preserving its
  JavaScript globals; YA's existing saved-draft behavior remains the owner of
  unsent text. Home/Open preserves a healthy mounted document.
- Tab IDs, selected ID and local paths survive activity/process recreation.
  Disk records exclude query strings, fragments, credentials and page content;
  a cold tab starts at its saved path with a freshly read credential. In-memory
  history restoration also bootstraps authentication because Android WebView
  history does not restore the page’s in-memory credential. Recovery discards stale history.
  Closing the last tab returns home with a fresh Projects tab available for
  the next Open. Provider setup selects an existing matching sign-in tab or
  opens one in the same web activity, preserving other tabs.
- WebView navigation verification belongs to its foreground activity, is
  cancelled when it pauses/dies, and has one bounded background worker. The
  service separately owns its bounded startup readiness check. There is no
  permanent readiness poll or unattended restart loop. A rapid **Stop → Open** joins the
  prior process group's shutdown before launching a new server. The controls
  observe authoritative lifecycle snapshots rather than retained status text.
- The runtime binds only loopback. A private persistent local access token uses
  YA's existing desktop-token API/WebSocket mechanism; anonymous API requests
  cannot access the host. The scaffold does not use `AUTH_DISABLED=true`.
- Android supplies the guest's DNS configuration from its active network's
  advertised DNS servers. The service owns one network callback, updates the
  bound resolver file in place on network changes, and unregisters on Stop.
  There is no hard-coded public resolver fallback. Docker's empty exported
  resolver cannot establish phone networking. This does not implement Android's
  DNS-over-TLS policy inside musl; strict encrypted-DNS-only networks still need
  separate validation.
- Provider profiles, YA data, local credentials and development config are under
  the app-private persistent home, separate from the replaceable runtime. Direct,
  AAR and mock profiles remain separate. Existing direct Codex config wins over
  initialization defaults; changed AAR endpoints require explicit review.
- `YEP_EXTERNAL_SESSIONS=false` disables `ExternalSessionTracker` and prevents
  host process inventory even if editable settings enable it. Ordinary server
  deployments retain their previous default (`true`). The Android runtime also
  supplies only its own provider homes and enables only Claude/Codex. No
  workstation home, Claude Desktop store, or unrelated provider history is
  mounted or imported. Reading/indexing this host's own native transcripts for
  history and resume remains necessary; this flag does not disable that path.
- Permission actions are contextual and explicit. Notification state and battery
  optimization state are visible. Battery exemption supports continuing active
  sessions; it does not authorize remote access or promise unlimited execution.
- Native Set up Claude/Codex controls open the shared focused YA provider sign-in
  page. HTTP and HTTPS links outside YA's exact loopback origin open the system
  browser, including localhost development-server links. Both ordinary links
  and user-initiated external new-window links support this handoff. Ordinary navigation
  within YA's own origin stays in the WebView; subframe loads do not launch a
  browser. An unavailable browser produces visible feedback. There is no
  privileged JS bridge or external access to local host credentials. Actual
  account authorization remains an explicit browser step by the user.
- AAR development setup creates an account-scoped temporary grant and USB
  inference tunnel. Upstream OAuth and router control stay on the computer.
  Cleanup revokes first and retains a local recovery lease on failure.

These are operator/runtime boundaries, not a new universal identity/grant
protocol. Local app access reuses the existing owner credential mechanism;
future remote access must use existing pairing/authentication and remain
explicitly opt-in. Push may request a wake, never carry arbitrary shell commands
or replace relay authentication. See [principals and grants](principals-and-grants.md)
and [native push](android-fcm-push.md).

## Native and web appearance

The native main menu, web header, tab dialog and recovery controls follow the
Android system light/dark mode, including changes while the app is running.
Native text, buttons, surfaces and system-bar icons use the corresponding
Android theme. Native appearance follows the system independently of an
explicit web appearance choice.

The shared YA wizard and main web UI follow the Android system light/dark
preference when appearance is Auto, including after a system theme change.
Explicit Light, Dark and Very Dark choices remain authoritative. WebView's
`prefers-color-scheme` comes from the native theme's day/night-qualified
`isLightTheme` value; native toolbar colors do not override the web preference.

## Battery-aware relay liveness

The experimental host selects `YEP_RELAY_KEEPALIVE_PROFILE=battery`. General
server launches default to `default`; no operating-system or battery-state
detection changes desktop behavior. An explicit profile can be selected on
another host. Android's private `development.json` can set
`relayKeepaliveProfile` to `default` for comparison; unknown values fail startup.

Both profiles ping an enabled remote-access waiting connection every 30 seconds.
The default profile retains its existing 10-second pong deadline and replaces
the socket after a greater-than-60-second clock gap. The battery profile probes
the existing socket with a five-second deadline instead of treating a delayed
timer alone as proof of failure. Each probe requires its own matching pong.
If suspension or a stall also delays the deadline by more than another five
seconds, a fresh probe receives a new bounded deadline; an earlier pong cannot
satisfy it. Stop and connection handoff release the pending probe and timer.
An unanswered timely probe starts the existing reconnect path, initially after
one second. Saved relay endpoints and remote-access enablement remain authoritative.

The product target is an interactive connection within approximately ten seconds
of demand while the enabled host is running. A five-second probe leaves room
for reconnect and registration on an available network; it is not an Android
wake guarantee. A silently broken socket between scheduled probes can still
take approximately 30 seconds to detect plus probe/reconnect time, exceeding the
target; this profile alone does not establish ten-second reachability from any
instant of demand. Battery exemption, actual suspension, radio/network availability,
process death, and public relay/TLS behavior require separate qualification.
This profile adds no wake lock, wake alarm, push enrollment, unattended restart,
or permission change. Its initial scope avoids unnecessary reconnects after
scheduling gaps; it does not reduce the normal ping cadence or establish a
battery-drain improvement.

The [2026-10-18 experiment](../docs/testing/android-host-battery-profile-2026-10-18.md)
records physical scheduling-gap recovery, idle artifact persistence and protected
ADB lifecycle checks, including the unqualified sleep/demand boundaries.

## Older Android support

**Decision, 2026-10-18:** Support Android 9/API 28 on ARM64 for now within the
experimental host. Keep Android 11/API 30 and newer as the routinely tested
baseline. Revisit the Android 9 support floor if it blocks runtime or dependency
upgrades, requires substantial special-case code, or causes recurring testing,
debugging or release friction. Reassess the trade-off when that friction appears
rather than accumulating compatibility workarounds by default.

A local Moto X4/API 28 prototype ran the existing ARM64 Alpine/PRoot payload,
real Claude/Codex tool turns, WebView submission/streaming, sequential typing,
full-host restart and actual provider resume through temporary USB AAR access.
It required local native API compatibility changes. Delivering the accepted
support floor in the standard build remains follow-up work: the checked-in APK
still requires API 30, and the compatibility changes remain local. Shared-storage
mapping, direct subscription authentication, Doze and overnight operation were
not qualified. See the [dated evidence](../docs/testing/android-host-moto-x4-2026-10-18.md)
for measured results, compatibility gaps and cleanup.

## Test boundary

Portable unit checks protect configuration/persistence decisions. The real ARM64
Alpine Docker harness tests the same server/runtime payload, protected API,
SQLite and restart persistence without an emulator or real inference. It does
not test Android, PRoot or Doze. Keep ordinary server/UI checks in their existing
test suites rather than duplicating them under Android.

Physical tests must establish native app identity, service ownership, UI-close
survival, screen-off/Doze behavior, process termination and actual provider
resume. A container restart or retained transcript display is not a resume test.
Recovery of a host after reboot must distinguish server readiness from ADB
readiness; a push cannot re-arm TCP adbd after reboot.

The [2026-10-18 lifecycle investigation](../docs/testing/android-host-lifecycle-2026-10-18.md)
records the morning stopped-host failure, the controlled physical recovery
checks and the remaining overnight/Doze/provider-resume limits.

## Next incubation milestones

1. Finish the service lifecycle on the physical phone, including safe shutdown,
   process-death recovery and real provider resume.
2. Keep the user-confirmed phone-local Claude/Codex subscription sign-in flows;
   validate credential persistence across restart, refresh and sign-out without
   importing host credentials. AAR remains optional for repeatable development.
3. Integrate the already-demonstrated same-phone ADB bridge behind explicit
   setup/readiness and the app's own ADB key.
4. Test screen-off work and bounded idle resource use, with no external desktop
   observers. Optional remote wake/relay reconnection follows that baseline.

See [package development commands](../packages/android-host/README.md) and the
[dated scaffold evidence](../docs/testing/android-host-scaffold-2026-10-17.md).

## Native host state and useful controls

The foreground service is the sole owner of starting, stopping and restarting
its runtime. Native controls and the separate WebView process observe an
app-private state provider (non-exported in release, `DUMP`-protected for ADB
in debug); observing or opening host controls
never starts the runtime. Snapshots distinguish stopped, starting, ready,
stopping and failed, identify each launch generation, and report mappings
applied to that launch. Diagnostic text retained on disk is not live authority.
Ready requires the current local credential to pass authenticated HTTP
readiness after that generation's process was spawned.

Repeated start requests join startup; repeated restart requests while stopping
join one restart. Stop cancels startup. Restart waits for the owned process
group's bounded cleanup before replacing the runtime. An explicit Open during
shutdown queues startup after cleanup. Stale completion callbacks cannot change
a newer launch. Web navigation checks also fence replaced readiness probes within
the same navigation; duplicate completion callbacks cannot turn a cancelled
older check into a false connection failure. Explicit Stop retains a stopping
indication until cleanup finishes, then removes the foreground notification. An
unverified shutdown blocks further runtime launches in that app process and asks
for an Android force-stop before retrying; a new runtime cannot overlap the
uncertain process group. Failed startup retains visible failure detail in host
controls. Android process death still requires
an explicit Open/Start/Retry; no unattended restart policy is added.

Controls show OS notification/channel permission, battery exemption and broad
all-files permission beside their applicable actions. Already granted settings
remain manageable. Notification denial that cannot produce another permission
prompt opens Android settings; Android 11–12 also use settings. Returning from
Settings refreshes current authority. Battery exemption is not a guarantee of
process survival. All-files authority is independent of mounted storage,
individual SAF grants, per-folder direct preferences and applied mappings.

Workspace controls distinguish Start with mappings, Restart to apply changes,
transitions and Mappings up to date. Service changes refresh the screen after
startup/restart; no screen reopening is needed to see applied mappings. Saving
shows progress and prevents duplicate mutations; errors retain feedback and
restore persisted checkbox state. Lost SAF access highlights Reselect as repair.
The folder picker exposes the 16-folder limit before opening. Background status
queries never replace the active Rename input; new refresh requests are deferred
until the dialog closes, then read current authority. The main menu summarizes folder
health and pending mappings. Provider shortcuts read the existing protected YA
provider status while the menu is visible and the host is ready; stopped or
unreachable hosts show unknown status rather than cached authentication claims.
Signed-in providers offer Manage. The tab toolbar and picker disable new-tab
actions at 32 tabs while existing tabs remain selectable and closable.

## Foreground notification

The low-importance, ongoing host notification reflects starting, ready and
stopping from the same service state. Tap and Open return to the selected YA
web tab; Host controls opens native setup/status. Stop host opens an explicit
confirmation that active agent work will be interrupted. Cancel leaves the
runtime running. Notifications alert only once and carry no session titles,
prompts, project paths or credentials; private lock-screen visibility is used.

While ready, the notification reports working sessions and sessions waiting for
input. A service-owned authenticated `GET /api/android-host/summary` stream
sends only working/attention counts: initial state plus supervisor lifecycle
changes, never transcript parsing or corpus polling. It is mounted only in the
coupled Android runtime with its native SAF socket, behind ordinary owner API
authentication. No hosted web client depends on this endpoint. Older staged
runtimes without it retain host controls and show session activity unavailable.

Each server permits at most four summary streams. A slow consumer retains at
most a queued snapshot and the newest pending value, not an event backlog.
Transport heartbeats every 15 seconds do not sample sessions. Disconnect/abort
releases the subscription and heartbeat. The native service owns one connection
and reconnect worker, with 1–30 second backoff and bounded HTTP timeouts; teardown
closes both. Lost connectivity drops stale counts and explicitly reports
activity unavailable, rather than claiming idle. Closing all UI does not retire
this service-owned notification feed; stopping the host does.


## On-phone native build and disposable test host

The opt-in [phone build workflow](../packages/android-host/docs/phone-build.md)
compiles the native shell from this checkout into a separate purple **YA Host
Lab** (`com.yepanywhere.host.lab`, port 13410). It stages identity/resources,
includes MC storage sources, and leaves normal Android build defaults intact.
It does not replace the protected agent/build host (`com.yepanywhere.host.experimental`,
port 13400), rebuild its server payload, copy its persistent HOME or expose keys.

The companion install tool verifies the actual APK package, content hash and
same-signer updates, and provisions only a fresh Lab's independent runtime.
The verifier checks distinct credentials, own-token acceptance, cross-token
refusal and optionally Lab-only force-stop/restart while the build host retains
its PID and readiness. Its inventory contains public signing identity, never
private keys or token values. This is same-phone, Android-user-0 experimental
development tooling; shared hardware pressure, background survival, real provider
inference, release builds and full Gradle equivalence remain outside its proof.
