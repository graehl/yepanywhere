# Remote Compatibility Notices

Status: Initial client slice implemented; v3 grace-period correction planned

Progress:

- [x] 2026-06-01: Captured the design direction for durable hosted remote
  compatibility notices, including the existing relay resume protocol cutoff
  and the upcoming backend/API update-recommended banner.
- [x] 2026-06-01: Added the pure notice engine, browser-local dismissal hook,
  remote notice banner, and replacement for the old relay resume modal.
- [x] 2026-06-01: Verified the focused notice tests and client typecheck.
- [x] 2026-06-01: Added host update guidance with visible versions, npm/source
  commands, and explicit server install-source metadata.
- [ ] 2026-06-04: Correct the relay SRP v3 rollout so protocol v2 is a
  warning-path compatibility fallback during the grace window rather than an
  immediate hosted-client cutoff. See
  [`011-relay-srp-v2-v3-grace-period.md`](011-relay-srp-v2-v3-grace-period.md).
- [x] 2026-06-30: Add a coarse hosted-remote compatibility level to
  `/api/version` and relay compatibility metadata. See
  [`../../topics/remote-hosted-compatibility.md`](../../topics/remote-hosted-compatibility.md).
- [ ] 2026-06-30: Show a hosted remote warning for missing or lower
  `remoteCompatibilityLevel`.

## Context

The hosted remote client can move faster than servers installed on user
machines. Most remote changes should remain backward compatible, but releases
that change backend APIs, remote transport semantics, or relay security posture
need a visible, dismissible notice so users understand when updating the local
server is recommended or required.

There are already several related user-facing prompts:

- the onboarding modal in the local app;
- the Codex CLI update prompt, which can update npm-global Codex installs;
- relay session-resume protocol warnings and cutoffs;
- dev reload banners;
- Settings -> About version/update state.

These should not grow as independent one-off modals. A single compatibility
notice model should decide what to show, how severe it is, and when a user has
already dismissed it.

This is specifically about the hosted remote UI after a secure connection is
established. The relay remains a dumb encrypted pipe and should not inspect or
enforce application-level notice policy.

## Existing Signals

The server already exposes enough metadata for a first slice through
`GET /api/version`:

- `current`
- `latest`
- `updateAvailable`
- `resumeProtocolVersion`
- `capabilities`
- `installSource`
- `remoteCompatibilityLevel`

The relay registration path also reports optional compatibility metadata for
observability:

- `appVersion`
- `resumeProtocolVersion`
- `renderProtocolVersion`
- `remoteCompatibilityLevel`
- `capabilities`

Relay resume protocol warnings should distinguish three cases:

- Protocol 1 and pre-metadata servers below the v2 security baseline may be a
  cutoff.
- Protocol 2 is the established compatible baseline from the earlier resume
  hardening rollout and should remain usable during a v3 grace period.
- Protocol 3 is the current protocol for updated servers.

Protocol 2 covered the security hardening released in `v0.4.0`, whose
changelog includes:

- "Harden session resume replay defenses for untrusted relays"
- "Harden relay replay protection for SRP sessions"

Protocol 3 adds mutual resume server proof so a compromised relay cannot pair a
saved-session client with an impostor YA server that merely accepts the
client's proof. Updated YA servers should advertise and speak protocol 3, but
the hosted remote client should continue to connect to protocol 2 servers
during the grace period and show a server-update warning. Compatibility
reporting to the relay itself landed later in `v0.4.11`, but the user-facing
cutoff notice should still treat `<0.4.0` as the durable v1/pre-v2 fallback
when protocol metadata is absent.

## Goals

- Keep compatibility notices durable and data-driven instead of scattering
  hard-coded UI checks through `RemoteApp`.
- Preserve hosted remote access whenever basic usage still works.
- Allow multiple notices to coexist with explicit severity and stable IDs.
- Make dismissal stable per host/install/version/notice so a dismissed old
  warning does not suppress a future warning.
- Keep old warnings in code indefinitely when they document meaningful
  compatibility history.
- Leave room for server-provided notices from the update service later without
  requiring that infrastructure for the next release.

## Non-Goals

- Do not block hosted remote login for the upcoming update-recommended release.
- Do not move compatibility policy into the public relay.
- Do not auto-update Yep Anywhere from the phone in the first slice.
- Do not infer or shell out to package managers for Yep Anywhere updates in the
  first slice.
- Do not change the Codex CLI update flow, except for any later shared prompt
  coordination work.

## Notice Model

Add a pure function that converts server metadata into remote UI notices.

Conceptual shape:

```ts
type RemoteNoticeSeverity = "info" | "recommended" | "security" | "blocking";

interface RemoteCompatibilityNotice {
  id: string;
  severity: RemoteNoticeSeverity;
  title: string;
  body: string;
  action?: {
    label: string;
    command?: string;
    href?: string;
  };
  dismissKey: string;
}

interface RemoteCompatibilityInput {
  currentVersion: string | null;
  latestVersion: string | null;
  updateAvailable: boolean;
  resumeProtocolVersion?: number;
  capabilities?: string[];
  relayUsername?: string | null;
  installId?: string | null;
}
```

The function should be deterministic and side-effect free:

```ts
getRemoteCompatibilityNotices(input): RemoteCompatibilityNotice[]
```

Severity meanings:

- `info`: non-urgent feature/capability gap.
- `recommended`: update recommended, but basic remote use remains broadly
  compatible.
- `security`: security or authentication hardening is missing; usage may
  continue, but the user should update.
- `blocking`: deliberate deprecation/cutoff where the hosted client cannot
  safely continue.

## Initial Notice Rules

### 1. Relay Resume Protocol Notices

Show a `blocking` cutoff notice only when either condition is true:

- `resumeProtocolVersion` is known and is lower than `2`;
- `resumeProtocolVersion` is absent and `currentVersion` is a comparable
  semver lower than `0.4.0`.

Suggested copy:

- Title: `Server update required`
- Body: `This hosted client requires current relay session-resume server
  verification. Update the local server, or use localhost, a tunnel, or a VPN
  with the old server.`
- Action command: `npm update -g yepanywhere`

Show a `security` or high-priority `recommended` notice when
`resumeProtocolVersion === 2` during the v3 grace period. Basic remote login
should remain available, but the user needs clear warning that the server must
be updated before the cutoff.

Suggested copy:

- Title: `Server update required soon`
- Body: `This server uses the older relay session-resume protocol. Remote
  login still works during the compatibility window, but update the YA server
  soon; future hosted clients will require the newer server-verification
  protocol for security.`
- Action command: `npm update -g yepanywhere`

This replaces the current `RemoteApp` modal check. It should be rendered as a
high-severity banner or notice, not as a blocking dialog.

### 2. Upcoming Backend/API Compatibility Notice

Show a `recommended` notice for the upcoming release when:

- the connection is through relay;
- the server version is below the chosen release baseline;
- basic compatibility is expected to continue;
- the notice has not been dismissed for that server/version.

The exact baseline should be set when the release version is chosen, for
example `0.4.29`.

Suggested copy:

- Title: `Update recommended`
- Body: `This hosted client includes backend/API compatibility changes. Basic
  remote use should still work, but updating the local server is recommended
  for this release.`
- Action command: `npm update -g yepanywhere`

If `currentVersion` is unknown or not comparable, avoid overclaiming. At most,
show a generic `recommended` notice when `updateAvailable` is true and
`latestVersion` is known.

### 3. Generic Update Available Notice

Optionally show a lower priority `recommended` notice when:

- `updateAvailable` is true;
- no more specific notice already covers the same update;
- the connection is through hosted remote.

This should not duplicate the release-specific backend/API notice. Prefer the
more specific notice when both match.

## Version And Metadata Policy

Prefer semantic metadata over version checks when metadata directly expresses
the compatibility concern:

- `resumeProtocolVersion` is the primary signal for the relay resume protocol
  warning or cutoff notice.
- version `<0.4.0` is the cutoff fallback for servers that do not report the
  protocol.
- future render/client contract checks should prefer `renderProtocolVersion`
  once it exists.
- `capabilities` are useful for feature-level notice copy, but they should not
  be the only basis for a hard cutoff.
- `remoteCompatibilityLevel` is the coarse hosted-client/server drift signal:
  use it to warn that the hosted client broadly expects a newer server
  generation, not to replace exact feature capabilities or protocol versions.

Use versions for release-specific guidance:

- known security baseline releases;
- known recommended-update releases;
- generic current/latest update state.

For the first `remoteCompatibilityLevel` rollout, older servers that omit the
field should evaluate as level `0`. The hosted client should initially require
level `0` but recommend level `10`, producing a strong non-blocking update
warning for missing or lower levels.

Do not treat dev/git versions as older unless they can be safely compared. For
`git describe`-style versions such as `0.4.0-3-gabcdef`, compare them as newer
than their base tag and still avoid npm-specific update actions.

Prefer explicit `installSource` metadata for update instructions:

- `npm-global`: tell the user to run `npm update -g yepanywhere`, then restart.
- `source`: tell the user to merge `origin/main`, run `pnpm install` and
  `pnpm build`, then restart.
- `release-package` or `unknown`: avoid claiming the package manager; show the
  npm command only as an npm-global example.

Older servers do not report `installSource`. Treat the missing field as
`unknown`, except that existing `git describe` versions such as
`0.4.28-6-g1ccc58f4` are a reliable source-checkout fallback.

## Dismissal

Dismissal should be browser-local and scoped narrowly enough that future
warnings can still appear.

Recommended key components:

- server install id when available;
- relay username as a fallback when install id is unavailable;
- notice id;
- current server version or protocol value that triggered the notice.

Example key shape:

```ts
remote-notice-dismissed:${installIdOrRelayUser}:${notice.id}:${versionOrState}
```

Dismissal behavior:

- dismissing the cutoff notice for `0.3.9` should not dismiss it for a
  different host;
- upgrading to `0.4.0+` should naturally remove the notice;
- a future notice with a different `id` should appear even if an older notice
  was dismissed;
- storage failures should be non-fatal and may cause notices to reappear.

## UI Placement

Create one `RemoteCompatibilityNotices` component rendered from connected
remote app content after authentication.

Suggested behavior:

- only render for relay-hosted connections initially;
- sort notices by severity;
- show one visible notice at a time at the top of the app, or stack compact
  banners if the design remains clean;
- never stack a notice modal on top of login, reconnect, or host-offline
  states;
- keep actions small: `Dismiss`, `Copy command`, and optionally `Settings`.

Prompt priority should be:

1. Login/reconnect/host-offline states.
2. Existing local onboarding modal, local app only.
3. Existing Codex update modal, local app only.
4. Remote compatibility notices after remote connection.
5. Dev reload banners.

The first implementation can keep local onboarding/Codex coordination as-is
and focus on remote compatibility notices.

## Tactical Work

### 1. Pure Notice Engine

- Add a small client module for remote compatibility notice derivation.
- Include semver comparison helpers or reuse an existing client-safe helper if
  one exists.
- Encode the initial notice rules:
  - relay resume protocol warning/cutoff, protocol first and `<0.4.0`
    fallback;
  - upcoming backend/API recommended update baseline;
  - optional generic update-available fallback.
- Add focused unit tests for:
  - `resumeProtocolVersion < 2`;
  - `resumeProtocolVersion === 2`;
  - missing protocol plus version `<0.4.0`;
  - version `0.4.0+` suppresses the cutoff notice;
  - unknown/dev versions avoid unsafe old-version claims;
  - release-specific recommended notice;
  - duplicate generic notice suppression.

### 2. Dismissal Hook

- Add a tiny localStorage-backed hook for dismissed remote notices.
- Scope keys by install id when available, then relay username fallback.
- Keep storage parse/write errors non-fatal.
- Add unit tests for dismissal keys and version-sensitive reappearance.

### 3. Remote UI Component

- Add `RemoteCompatibilityNotices`.
- Render it from connected remote app content.
- Replace one-off relay protocol checks with the notice engine.
- Use existing banner/modal styling primitives where possible.
- Ensure text fits on mobile and actions wrap cleanly.

### 4. About Settings Visibility

- Optionally surface the same highest-severity remote notice in Settings ->
  About, near the existing server/client version display.
- Avoid duplicating copy by using the same notice engine.
- Keep the existing manual update check button.

### 5. Future Update-Service Notices

- Later, extend `/api/version` to include structured server/update-service
  notices if release policy needs to change without rebuilding the hosted
  remote client.
- Keep client-bundled notice rules for historical security baselines that
  should remain durable forever.
- Treat server-provided notices as additive and validated, not as arbitrary
  HTML.

## Verification Checklist

- A relay-connected server with `resumeProtocolVersion: 2` shows one
  non-blocking update-required-soon warning during the v3 grace period.
- A relay-connected server with `resumeProtocolVersion: 1` shows one
  `blocking` cutoff notice.
- A relay-connected server with no `resumeProtocolVersion` and version
  `0.3.9` shows the relay resume protocol cutoff notice.
- A relay-connected server with version `0.4.0` does not show the cutoff
  notice from version fallback alone.
- A server below the release compatibility baseline shows the
  update-recommended notice.
- Dismissing one notice hides only that notice for that host and triggering
  version/state.
- Reconnecting to another relay username or install id re-evaluates notices.
- Local direct app behavior is unchanged.
- Codex update prompt behavior is unchanged.
- Remote login, reconnect, and host-offline flows do not show stacked
  compatibility modals.
