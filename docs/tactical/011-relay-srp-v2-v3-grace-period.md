# Relay SRP v2/v3 Grace Period

Status: Planned

Progress:

- [x] 2026-06-04: Captured the compatibility invariant and the corrective
  client-side rollout plan after the protocol 3 cutoff blocked protocol 2
  servers.

## Context

Relay SRP protocol 3 was introduced by commit `503de19d` on 2026-06-02. It
adds authenticated server metadata after full SRP and a server proof after
session resume, so a compromised relay cannot pair a saved-session client with
an impostor YA server that merely accepts the client's resume proof.

The implementation made the hosted remote client require protocol 3
immediately. That means a protocol 2 server can complete ordinary SRP server
verification with `M2`, `sessionId`, and `transportNonce`, but the client still
rejects it because `serverInfoProof` is missing. Users see:

```text
Server protocol verification failed
```

That violates the hosted Remote Access compatibility policy. Protocol updates
that can strand valid YA servers need a visible grace period measured in weeks,
with warnings that users must update their YA server before the eventual
cutoff.

## Desired Split

Updated YA servers should continue to speak and advertise protocol 3 only.
Current servers should not keep weaker resume behavior around for new releases.

The hosted remote frontend should support both protocol 2 and protocol 3 during
the grace period:

- Prefer protocol 3 when the server proves it.
- Accept protocol 2 full SRP login when the SRP proof is valid and the server
  provides the protocol 2 `sessionId` and `transportNonce`.
- Show a visible warning for protocol 2 servers telling users to update the YA
  server soon because future hosted clients will require protocol 3 for
  security.
- Do not silently downgrade a browser profile or stored session that has
  already authenticated protocol 3 for the same server.

The grace period should start from the release that restores protocol 2
frontend compatibility, not from the 2026-06-02 hard cutoff. Pick and document a
planned cutoff date in the implementation PR or release notes; do not cut off
protocol 2 before at least a few weeks of warning.

## Goals

- Restore hosted remote login for protocol 2 YA servers.
- Keep protocol 3 as the current server-side protocol.
- Preserve downgrade protection for clients that already pinned protocol 3.
- Show actionable update guidance for protocol 2 servers.
- Keep protocol 1 and pre-v2 security-baseline servers out of the compatibility
  path.

## Non-Goals

- Do not re-enable protocol 1 resume behavior.
- Do not restore base-session-key traffic, missing-`transportNonce` traffic,
  obsolete encrypted JSON envelopes, or unsequenced payload fallbacks.
- Do not move compatibility enforcement into the public relay.
- Do not make the relay inspect encrypted application traffic.
- Do not silently auto-update YA servers from the hosted client.

## Protocol Behavior

### Full SRP Login

Protocol 3 server:

- `srp_verify` must include `M2`, `sessionId`, `transportNonce`, and
  `serverInfoProof`.
- The client verifies `M2`, decrypts `serverInfoProof`, verifies protocol
  metadata, derives the transport key from `transportNonce`, and stores
  `resumeProtocolVersion: 3`.

Protocol 2 server during grace:

- `srp_verify` must include valid `M2`, `sessionId`, and `transportNonce`.
- `serverInfoProof` is absent.
- The client verifies `M2`, derives the transport key from `transportNonce`,
  marks the session as protocol 2, and connects.
- If the same stored host/session has already pinned protocol 3, reject the
  protocol 2 response as a downgrade unless the user deliberately clears or
  replaces the stored host/session.

Protocol 1 or pre-v2 server:

- Missing `transportNonce`, missing session id, or metadata that clearly falls
  below protocol 2 remains blocked for hosted Remote Access.

### Session Resume

Protocol 3 resume remains the preferred and only automatic resume path:

- Client sends `srp_resume_init` with client nonce.
- Server returns nonce challenge.
- Client sends challenge-bound proof.
- Server returns `transportNonce` and encrypted `serverProof`.
- Client verifies server proof and resumes.

Protocol 2 resume should not be accepted as silent resume in the hosted client
during this grace period. The safe fallback for protocol 2 servers is full SRP
login, because SRP `M2` authenticates the server on a fresh password login while
protocol 2 resume lacks the new server proof.

Practical effect:

- A stored protocol 2 session in resume-only mode should fall back to the login
  flow rather than reporting an opaque host failure.
- A stored protocol 2 session with a password available may skip resume and
  perform full SRP.
- A stored protocol 3 session must not resume or full-login-downgrade to
  protocol 2 without explicit user action.

## Implementation Shape

### 1. Client Handshake Compatibility

Update `packages/client/src/lib/connection/SecureConnection.ts`:

- Split constants into a current protocol (`3`) and grace minimum (`2`).
- Keep current protocol 3 verification exactly as the preferred path.
- Add a protocol 2 full-SRP acceptance path when `serverInfoProof` is absent
  but `M2`, `sessionId`, and `transportNonce` are valid.
- Preserve downgrade rejection when a stored session or host record has already
  observed authenticated protocol 3.
- Store enough metadata to know whether a saved session is protocol 2 or
  protocol 3.
- Do not attempt protocol 2 silent resume from resume-only connections; route
  the user to password login instead.

### 2. Warning Notices

Update `packages/client/src/lib/remoteCompatibilityNotices.ts` and
`packages/client/src/components/RemoteCompatibilityNotices.tsx`:

- `resumeProtocolVersion >= 3`: no relay SRP protocol warning.
- `resumeProtocolVersion === 2`: show a non-blocking but high-severity warning
  such as `Server update required soon`.
- `resumeProtocolVersion < 2`: keep a blocking cutoff.
- Missing `resumeProtocolVersion` plus comparable server version `<0.4.0`
  remains the durable pre-v2 cutoff fallback.
- The v2 warning should include concrete update guidance and explain that the
  cutoff is for relay session-resume server verification security.

### 3. Login And Host Offline UX

Check the resume-only flows in:

- `packages/client/src/contexts/RemoteConnectionContext.tsx`
- `packages/client/src/pages/RelayConnectionGate.tsx`
- `packages/client/src/pages/HostPickerPage.tsx`

When a protocol 2 stored session cannot resume automatically, the user should
land on a password login path with clear copy, not a generic offline/error
state. The warning can be shown after successful full login from `/api/version`.

### 4. Tests

Update or add focused tests:

- `SecureConnection.compatibility.test.ts`
  - protocol 3 full SRP still requires and verifies `serverInfoProof`;
  - protocol 2 full SRP succeeds during grace;
  - protocol 2 full SRP is rejected when a stored session has pinned protocol 3;
  - protocol 2 resume-only does not silently authenticate and sends the user to
    login/fallback;
  - protocol 1 or missing `transportNonce` remains rejected.
- `remoteCompatibilityNotices.test.ts`
  - protocol 2 emits a non-blocking warning;
  - protocol 1 emits a blocking cutoff;
  - protocol 3 emits no SRP protocol warning.
- Component tests for the protocol 2 warning copy and action command.

### 5. Verification

Run the focused client tests first:

```bash
pnpm test -- packages/client/src/lib/connection/__tests__/SecureConnection.compatibility.test.ts
pnpm test -- packages/client/src/lib/__tests__/remoteCompatibilityNotices.test.ts
pnpm test -- packages/client/src/components/__tests__/RemoteCompatibilityNotices.test.tsx
```

Then run the normal source checks for the touched packages:

```bash
pnpm typecheck
pnpm test
```

## Cutoff Follow-Up

When the grace period has elapsed, make the cutoff a deliberate change:

- Check relay/version adoption if the relay has enough observability data.
- Update the warning copy or release notes with the actual cutoff date.
- Remove protocol 2 full-login acceptance only in that follow-up change.
- Keep historical notice tests so old version/protocol behavior remains
  documented.
