# Session Scroll Memory Policy

Date: 2026-07-03

Status: initial slice implemented

## Motivation

Session detail scroll state can look like a read cursor, but it is not durable
read state. It is an in-tab warm-restore hint. Before this slice, that hint was
mixed into the session detail reducer state, which made ownership hard to
reason about:

- reducer state carries transcript/session data and scroll metadata together;
- `MessageList` owns the actual DOM geometry and follow-tail mechanics;
- a bottom-position snapshot means "follow the newest tail on return", while a
  scrolled-back snapshot means "restore this viewed row";
- the user preference is implicit in restore code instead of named as policy.

The goal is to make those concepts explicit without changing the default
provider-like behavior.

## Decisions

- Browser-local policy lives in `localStorage` under `UI_KEYS`, alongside the
  existing performance settings.
- Per-session scroll memory belongs to the session detail cache entry, not the
  reducer-owned `SessionDetailState`.
- `MessageList` remains responsible for live DOM scroll physics:
  programmatic-scroll suppression, ResizeObserver catch-up, user scroll intent,
  and follow-button behavior.
- The default mode is `live-tail`: ordinary session opens and bottom snapshots
  load at the current bottom and keep following.
- New/non-default modes may be hidden or advanced settings first. The policy
  surface should exist before all modes are exposed in the settings UI.

## Policy Modes

- `live-tail`: provider-like default. Restore a bottom snapshot to the newest
  bottom and follow. Restore scrolled-back snapshots to their anchor/geometry.
- `remember-place`: restore the last viewed anchor when available, including
  snapshots captured while the user was at bottom. This makes "new output while
  away" visible below the restored viewport instead of jumping past it.
- `manual-follow`: same restore preference as `remember-place`, with future
  follow-entry changes reserved for explicit send/follow-button behavior.
- `no-memory`: do not retain or restore per-session scroll snapshots. Transcript
  cache may still retain message data.

## Implementation Tracking

- [x] Add a tactical plan for scroll memory policy and storage ownership.
- [x] Add a browser-local scroll behavior policy key and hook plumbing.
- [x] Move retained scroll snapshots out of `SessionDetailState` and into the
  cache entry metadata boundary.
- [x] Capture anchors even when the viewport is at bottom; default live-tail
  restore still ignores that anchor for bottom snapshots.
- [x] Route initial restore through a named policy decision.
- [x] Prevent resize handling from re-arming follow mode from near-bottom
  geometry.
- [x] Add focused tests for policy parsing, cache-owned scroll memory, and
  remember-place restore.
- [x] Retry anchored `remember-place` restore while progressive hydration is
  still mounting older rows.
- [x] Show a "new output below" follow affordance when `remember-place`
  restores a previously-bottom viewport above newer output.
- [x] Capture anchor neighbor/timestamp context and use exact anchor,
  neighboring row, nearest timestamped row, then raw `scrollTop` as the restore
  fallback order.
- [x] Suppress scroll snapshot writes while progressive hydration is active and
  publish one settled snapshot after the reveal completes.

## Follow-Up Work

- Expose the policy in settings after the mode names and copy are settled.
- Add diagnostics for non-exact scroll restores so anchor misses can be counted
  by reason instead of inferred from user reports.
- Tighten fast-stream bottom-follow tests around large bursts and async row
  height changes.
