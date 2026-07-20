# Host Awake

> YA may hold a process-lifetime operating-system power assertion so an
> explicitly opted-in host remains reachable while the server is running,
> without keeping its display on or persistently changing its power plan.

Topic: host-awake

Status: product direction and implementation proposal. No runtime behavior is
implemented yet.

Related topics: [vanilla-defaults](vanilla-defaults.md),
[architecture-mandates](architecture-mandates.md),
[settings-ui-placement](settings-ui-placement.md),
[hard-development-rules](hard-development-rules.md), and
[server-capabilities](server-capabilities.md).

## Decision Summary

Host-awake support is in scope for YA because remote supervision depends on the
host remaining reachable between user interactions. It is a server-wide host
availability setting, not provider/session behavior and not a browser-local
preference.

The first implementation should follow these rules:

- ship configurable and default-off;
- prevent automatic idle system sleep while YA runs, on battery or external
  power, while leaving display sleep alone;
- continue to respect the operating system's lid, explicit sleep, low-power,
  and thermal policies in the ordinary mode;
- expose a separate macOS-only best-effort option to request closed-lid
  operation while connected to external power;
- never mutate persistent operating-system power plans;
- never require administrator/root privileges for the ordinary mode;
- bind every assertion/helper lifetime to the YA server process so a crash,
  forced exit, or disabled setting releases it;
- treat an unavailable backend as a visible, nonfatal degraded state: YA still
  starts and serves requests.

The ordinary setting intentionally remains active without a live browser tab or
provider process. The explicit server setting is the owner of this single
global lease. It must not create a per-client or per-session timer, watcher, or
poll loop.

## Motivation

YA is useful from another room, another device, or away from the host. A host
that automatically sleeps can silently suspend an active agent, make approvals
unreachable, and disconnect direct or relayed clients. Requiring each operator
to remember a separate `caffeinate`, PowerToys Awake, browser extension, or
desktop setting makes host availability less reliable than the server-owned
agent processes YA is supervising.

There are two distinct needs:

1. **Idle-sleep prevention.** The lid is open, but the user is not typing. This
   should work on battery as well as external power. It is the common case and
   has a supported OS-level implementation on the main desktop platforms.
2. **Closed-lid operation.** The host should keep working headlessly after a
   laptop lid closes. Operating systems treat this as a stronger, more
   safety-sensitive request. macOS exposes a stronger external-power assertion,
   but Apple does not promise the no-external-display configuration across all
   hardware and OS releases. This behavior must therefore remain separate and
   visibly best-effort.

## Product Contract

### Ordinary mode

When **Keep host awake while the server is running** is enabled:

| Power source | Laptop lid | Requested behavior |
| --- | --- | --- |
| Battery | Open | Prevent automatic idle system sleep |
| External power | Open | Prevent automatic idle system sleep |
| Battery | Closed | Follow the operating system's lid policy |
| External power | Closed | Follow the operating system's lid policy |

The display may dim or turn off in every row. YA does not simulate input, move
the pointer, or request a display-required assertion.

### macOS closed-lid-on-power mode

When the macOS-only **Also stay awake with the lid closed on external power**
option is enabled, YA additionally requests the stronger macOS system-sleep
assertion:

| Power source | Laptop lid | Requested behavior |
| --- | --- | --- |
| Battery | Open | Prevent automatic idle system sleep |
| External power | Open | Prevent automatic idle system sleep |
| Battery | Closed | Sleep according to macOS policy |
| External power | Closed | Best-effort continued operation |

This is not equivalent to an Apple guarantee of headless closed-lid operation.
Apple's supported closed-display instructions still assume an external display
and input devices. YA should describe the no-display result as best effort and
test it on each maintained Intel/Apple-silicon and macOS family before claiming
compatibility.

External power is only one safety boundary. A USB-C battery pack in a closed
bag may still count as external power, so the stronger mode needs explicit copy
warning that the computer must remain ventilated. macOS retains authority to
sleep for thermal emergencies and other hardware policy.

## Suggested UI

### Placement

Add a **Host availability** group to the existing **Remote Access** settings
category. Reachability is the user concept, and one or two controls do not earn
a new category under [settings-ui-placement](settings-ui-placement.md). The
setting remains useful for LAN/direct access even when relay access is not
configured, so the group must not be hidden behind relay enablement.

If a later host-management cluster grows around startup-at-login, service
installation, wake-on-network, or power state, it may justify a dedicated Host
or Server category. Do not create that category for this feature alone.

### Primary control

**Label:** Keep host awake while the server is running

**Description:** Prevent automatic system sleep while this server is running,
including on battery power. The display may still turn off, and closing a
laptop lid follows the normal system policy.

This switch is off by default. It is server-persisted and applies regardless of
which browser or remote client changed it.

### macOS subordinate control

Show this only when the connected server advertises the macOS stronger-mode
capability and the primary control is enabled.

**Label:** Also stay awake with the lid closed on external power

**Description:** Request continued operation when this Mac is connected to
power and its lid is closed. Support varies by Mac and macOS version. Keep the
computer ventilated; closing the lid on battery still allows sleep.

The subordinate control is independently default-off. It should not be folded
silently into the ordinary keep-awake toggle.

### Status and errors

Show quiet inline status only in the settings group:

- **Active — preventing automatic sleep**
- **Active — closed-lid operation on external power requested**
- **Unavailable on this server**
- **Could not enable: `<bounded reason>`**

Do not add a first-run prompt, global banner, session toolbar control, or
notification. A backend failure should remain visible when the user visits the
setting, but it must not make unrelated server health appear failed.

All new copy belongs in `packages/client/src/i18n/en.json` and must be rendered
through `useI18n().t(...)`.

## Configuration Model

Prefer one enum over two independent booleans so invalid combinations cannot be
persisted:

```ts
export type HostAwakeMode =
  | "off"
  | "idle"
  | "idle-and-closed-lid-on-external-power";

interface ServerSettings {
  hostAwakeMode?: HostAwakeMode;
}
```

Semantics:

- missing or `"off"`: no assertion;
- `"idle"`: ordinary cross-platform idle-sleep prevention;
- `"idle-and-closed-lid-on-external-power"`: ordinary prevention plus the
  macOS stronger request where supported; on other platforms, reject the mode
  rather than silently broadening or weakening it.

`DEFAULT_SERVER_SETTINGS.hostAwakeMode` is `"off"`. The settings route accepts
only the exact enum values and applies a successful update live. Missing stored
state needs no migration beyond the default merge.

Do not add an environment-variable override in the first pass. If headless
deployment later needs one, define its precedence explicitly under
[hard-development-rules](hard-development-rules.md), expose the effective
source in UI/status, and do not let the UI appear to change an env-pinned value.

## Runtime Architecture

Add one server-global `HostAwakeService`. It owns no provider or client state.

```ts
interface HostAwakeBackend {
  readonly platform: NodeJS.Platform;
  readonly supportsClosedLidOnExternalPower: boolean;
  acquire(mode: Exclude<HostAwakeMode, "off">): Promise<HostAwakeLease>;
}

interface HostAwakeLease {
  status(): HostAwakeBackendStatus;
  release(): Promise<void>;
}
```

The concrete API may differ, but preserve these responsibilities:

1. initialize after `ServerSettingsService` has loaded;
2. apply the persisted mode before reporting the feature active;
3. serialize live mode changes so overlapping PUT requests cannot leak helpers;
4. retain exactly one current lease;
5. release it when disabled and from `gracefulShutdown`;
6. bind helper cleanup to parent-process death for ungraceful exits;
7. record an unexpected helper exit as `error` without a retry loop;
8. expose a read-only status snapshot for the settings UI and diagnostics.

The service should not poll power state or retry indefinitely. Platform-native
assertions already track their relevant state. If a witnessed macOS
power-source transition proves that `caffeinate` drops the stronger assertion
permanently, prefer an OS power-source notification or a bounded helper
restart over a periodic poll.

### Status API and capabilities

Add a read-only status response, either as a focused settings subroute or a
small server-info field:

```ts
interface HostAwakeStatus {
  requestedMode: HostAwakeMode;
  state: "disabled" | "active" | "unsupported" | "error";
  platform: NodeJS.Platform;
  supportsClosedLidOnExternalPower: boolean;
  reason?: string;
}
```

`reason` must be bounded and scrubbed of command lines, environment values, or
other sensitive host data.

Register a transitional `host-awake-control` server capability so a newer
hosted client hides controls against older servers. Register a permanent,
dynamic `host-awake-closed-lid-on-external-power` capability only when the
server has a backend that implements that stronger request. Follow
[server-capabilities](server-capabilities.md) for lifecycle metadata rather
than adding raw capability strings.

The UI should fetch status when its settings pane mounts and after a mutation.
It does not need a status polling loop or a new WebSocket event for the first
implementation.

## Platform Strategy

### macOS

Use the OS-provided `/usr/bin/caffeinate` through `execFile`/`spawn` with fixed
arguments and no shell:

- ordinary mode: `caffeinate -i -w <ya-pid>`;
- stronger mode: `caffeinate -i -s -w <ya-pid>`.

`-i` creates an idle-system-sleep assertion and works on battery or external
power. `-s` creates the stronger system-sleep assertion and is valid only on
external power. `-w` binds the helper assertion to YA's PID, so it releases if
YA disappears even when graceful shutdown did not run.

Do not use `-d` because YA does not need the display. Do not use `-u`, fake
input, or cursor movement. Do not invoke `pmset`, especially undocumented or
persistent `disablesleep` settings. Those alter machine policy beyond the YA
process lifetime, generally require privilege, and can survive a crash.

The stronger mode remains experimental until manual testing answers:

- Does it keep the YA process and network reachable with the lid closed, on
  external power, without an external display?
- Is behavior consistent across power disconnect/reconnect?
- Do Intel and Apple-silicon targets behave consistently?
- Does explicit Apple-menu Sleep still behave acceptably while the assertion
  is held?
- Does reopening the lid restore the ordinary mode without restarting YA?

If the answers vary, report the tested compatibility rather than compensating
with privileged power-policy changes.

### Windows

Use a process-lifetime Windows power request for
`PowerRequestSystemRequired`; do not request `PowerRequestDisplayRequired` or
`PowerRequestAwayModeRequired`. Microsoft's power-request contract leaves the
display free to turn off and releases ordinary requests for user-initiated
Sleep, lid close, or the power button.

Node does not expose the Win32 power APIs directly. The dependency-minimal
first option is a small source-owned PowerShell helper that:

1. loads the fixed `Kernel32` P/Invoke definitions;
2. creates a reason context identifying Yep Anywhere;
3. calls `PowerCreateRequest` and `PowerSetRequest(SystemRequired)`;
4. opens a handle to the YA parent process and waits for it to exit;
5. calls `PowerClearRequest` and closes the request handle in `finally`.

Spawn it with `powershell.exe -NoProfile -NonInteractive`, fixed arguments, and
no interpolated user input. If enterprise policy or a minimal Windows image
does not provide the required PowerShell/Win32 path, return `unsupported`; do
not download a helper or require PowerToys automatically.

A later packaged native helper is preferable only if real deployments show
that PowerShell policy is a recurring blocker and the binary build/signing
cost is justified. If PowerToys Awake is already installed, it is useful
reference behavior and supports PID-bound execution, but YA must not take an
undeclared runtime dependency on it.

Windows Modern Standby can constrain power requests on DC/battery power, and
lock-screen behavior also varies by request path and policy. The Windows UI
therefore promises that YA requests idle-sleep prevention, not that it can
override every OEM or enterprise power policy. Validate at least Windows 10
and 11 on Traditional Sleep and Modern Standby hardware before marking the
backend fully supported.

YA must not run `powercfg` to rewrite power-plan timeouts or lid actions.

### Linux with systemd/logind

Use `systemd-inhibit` when available. Request only idle inhibition:

```text
--what=idle
--mode=block
--who=Yep Anywhere
--why=Keep the Yep Anywhere host reachable while the server is running
```

Do not accept `systemd-inhibit`'s broad default of
`idle:sleep:shutdown`. Do not request `sleep`, `shutdown`,
`handle-lid-switch`, or power-key inhibition. This keeps the ordinary feature
focused on automatic idle handling and leaves explicit/lid actions to system
policy.

Because `systemd-inhibit` wraps another command, spawn it around a tiny
source-owned lease holder whose stdin is a pipe owned by YA. The holder exits
on EOF; parent death closes the pipe; `systemd-inhibit` then releases the lock.
This avoids a polling parent-PID watcher and orphaned inhibitors. Use fixed
arguments and no shell.

The backend is unsupported when `systemd-inhibit` is absent, the logind bus is
unavailable, or the current service/user context cannot acquire the inhibitor.
Headless services and containers need explicit testing because a binary being
present does not prove an active logind session/bus.

### Linux without systemd

Return `unsupported` in the first release. Desktop-specific D-Bus APIs and
other init systems can become separate backends after a real target requires
them. Do not add a runtime D-Bus dependency or simulate input merely to claim
generic Linux coverage.

## Failure and Lifecycle Rules

- Enabling an unsupported or failed backend returns settings/status that make
  the failure visible; it does not abort server startup.
- A failed live update must not claim `active`. Decide before implementation
  whether the requested mode remains persisted for retry on next startup or
  the route rolls it back; the UI and API must agree. The safer first behavior
  is to persist operator intent and expose `error`, allowing a repaired host to
  activate on restart.
- Disabling is idempotent and succeeds even if the helper already exited.
- An unexpected helper exit produces one warning and an in-memory `error`
  status. No fast restart loop.
- Graceful shutdown releases the lease before `process.exit`.
- Parent-death coupling is required even though graceful shutdown exists.
- Helper stdout/stderr must be bounded or ignored; it must not become a new
  unbounded logging source.
- The setting must never create provider-visible messages, session activity,
  or client notification events.

## Safety and Security

- The settings mutation remains behind the existing authenticated server
  settings boundary, including over encrypted relay transport.
- No implementation requires administrator/root privileges in the supported
  path.
- Never rewrite persistent sleep timers, lid actions, or power plans.
- Never keep the display on by default.
- Never use mouse movement, synthetic keys, or user-activity simulation.
- Preserve explicit OS policy where the ordinary API allows it. The macOS
  stronger mode is separate because it intentionally asks for more.
- Treat battery pack/external-power detection as a policy hint, not proof that
  a closed computer is safely ventilated.
- OS thermal shutdown, critical battery behavior, managed-device policy, and
  explicit shutdown remain authoritative.

## Verification Plan

### Automated tests

- settings parser accepts only the three modes and defaults missing state to
  `off`;
- settings API persists intent and invokes the service exactly once per real
  transition;
- concurrent updates serialize and leave one lease;
- repeated enable/disable calls are idempotent;
- unexpected helper exit changes status to `error` without retrying;
- graceful shutdown and simulated parent-channel closure release the lease;
- each backend produces exact fixed executable paths/arguments;
- macOS ordinary mode includes `-i`, stronger mode includes `-i -s`, and
  neither includes `-d`;
- Linux requests only `idle`, never the default broad inhibitor set;
- Windows requests SystemRequired, never DisplayRequired or AwayModeRequired;
- capability-gated clients hide controls for older servers;
- UI toggle mapping cannot produce a stronger mode while the primary switch is
  off;
- UI copy and aria text use English i18n keys.

Mock the backend in ordinary unit/integration tests. CI must not actually alter
the runner's sleep state.

### Manual platform matrix

For each supported platform, verify:

- enable/disable live;
- server restart with the setting persisted;
- display timeout still works;
- open-lid idle behavior on battery and external power;
- explicit Sleep and lid close behavior;
- server SIGINT/SIGTERM cleanup;
- forced server termination cleanup;
- helper termination and visible error status;
- remote reachability during the expected awake interval.

Additionally test macOS stronger mode with no external display, with and
without external power, across power transitions, and under a long enough run
to cross the normal sleep timer. Record model, architecture, and macOS version
with the result.

## Suggested Landing Sequence

1. Land shared mode/status types, settings validation, the global service with
   a fake backend, lifecycle integration, and tests.
2. Add the macOS ordinary backend and primary UI toggle, capability-gated and
   default-off.
3. Manually validate the macOS stronger assertion; expose the subordinate
   control only if the tested behavior is useful and its limitations are
   accurately described.
4. Add the Windows power-request helper and platform tests.
5. Add the systemd/logind Linux backend and platform tests.
6. Revisit unsupported-platform demand before adding another abstraction or
   runtime dependency.

Each platform backend can land independently behind the same service/status
contract. Unsupported platforms must degrade cleanly throughout the series.

## Open Questions

- Should a failed acquisition persist operator intent for the next restart, or
  should the PUT fail and roll back? The proposal favors persisted intent plus
  visible `error`, but route conventions should be checked during
  implementation.
- Which currently maintained Mac models and macOS versions honor the stronger
  assertion with no external display?
- Does macOS external-power reconnect restore the same assertion reliably, or
  is an event-driven reacquire needed?
- Does the stronger macOS mode interfere with deliberate Apple-menu Sleep in a
  way that makes it unsuitable for YA?
- Can a source-owned PowerShell helper satisfy enterprise Windows policies, or
  is a signed native helper justified?
- Which Linux desktop/service configurations honor an `idle` inhibitor without
  also needing a desktop-session-specific API?

## Primary Platform References

- Apple:
  [`kIOPMAssertionTypePreventUserIdleSystemSleep`](https://developer.apple.com/documentation/iokit/kiopmassertiontypepreventuseridlesystemsleep)
  and
  [`kIOPMAssertionTypePreventSystemSleep`](https://developer.apple.com/documentation/iokit/kiopmassertiontypepreventsystemsleep)
- Apple:
  [sleep and wake settings](https://support.apple.com/guide/mac-help/set-sleep-and-wake-settings-mchle41a6ccd/mac)
- Microsoft:
  [`PowerCreateRequest`](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-powercreaterequest),
  [`PowerSetRequest`](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-powersetrequest),
  and
  [`PowerClearRequest`](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-powerclearrequest)
- Microsoft:
  [PowerToys Awake behavior](https://learn.microsoft.com/en-us/windows/powertoys/awake)
- systemd:
  [`systemd-inhibit`](https://www.freedesktop.org/software/systemd/man/latest/systemd-inhibit.html)
