# Bounded Active Transcript Window

Status: implementation in progress; slices 1-5 complete and runtime active.

Topic: memory-growth
Topic: session-detail-data-layer
Topic: transcript-virtualization

## Implementation Status

### 2026-07-10: Slice 1 complete — pure policy projection

Added
`packages/client/src/lib/sessionDetail/activeWindowTrimPolicy.ts` with:

- a constant-time `shouldConsiderActiveWindowTrim(...)` gate that does not
  inspect transcript messages;
- real-user-turn and compact-boundary classification matching the server
  pagination exclusions;
- `planActiveWindowTrim(...)` with two-compaction retention, default 30-to-20
  turn hysteresis, custom-turn hysteresis, later-start intersection semantics,
  and the strict greater-than-60-second age guard; and
- pure evaluation orchestration so frequent irrelevant actions can prove they
  never enter the planner.

Focused coverage has 15 passing fixtures, including 10,000 irrelevant policy
evaluations with zero planner calls. No reducer, store, React, setting, or
runtime behavior is wired in this slice.

### 2026-07-10: Slice 2 complete — atomic reducer trim

Added the `trimLoadedWindow` session-detail action and
`trimLoadedWindow.ts`. The reducer independently rejects missing, first-row,
invalid-time, and 60-seconds-or-newer boundaries, then atomically:

- retains the planned suffix and replaces loaded-window pagination;
- preserves the session, durable tail cursor/watermark, and deferred queue;
- drops markdown augments owned by removed messages; and
- computes transitive tool/agent reachability from retained main messages,
  retained agent transcripts, and active (`pending`/`running`) agents so
  orphaned terminal agent trees are reclaimed without losing live work.

Reducer/store coverage verifies the bounded route snapshot, monotonic
pagination totals, auxiliary cleanup, nested-agent reachability, active-agent
preservation, and referential no-op guards. The action is not dispatched by
unrelated store paths; only the Slice 3 coordinator lifecycle owns its
automatic dispatch. Slices 4–6 remain pending.

### 2026-07-10: Slice 3 complete — coordinator lifecycle

The session-detail coordinator now owns mount-scoped active-window lifecycle
state: bottom-follow intent, structural and evaluated revisions, one cached
age-deferred candidate, and irreversible Load older suppression for that
coordinator lifetime. Initial/catch-up/tail/stream transcript paths notify the
lifecycle, while ordinary messages use constant-time gates and do not enter the
planner unless a cached candidate has crossed its strict age boundary.

The first valid Load older request pins the mount before starting its network
request; applying an older page also pins defensively. Live scroll snapshots
feed `atBottom` to the coordinator even when durable scroll-memory retention is
disabled. No timer, byte accounting, server request, or durable suppression
state was added.

Coordinator fixtures cover the disabled fast path, following-bottom trim,
strict-age deferred dispatch without a second scan, and mount-lifetime history
suppression. The hook currently passes an explicit `enabled: false` runtime
gate, so Slice 3 cannot activate automatic trimming before Slice 5 provides the
required default-on Performance preference and explicit off switch. Slice 4
adds the required rendered scroll/turn-navigation reconciliation below.

### 2026-07-10: Slice 4 complete — scroll and turn-rail integration

An accepted reducer trim now increments an ephemeral store revision that is
projected through the session hooks to `MessageList`; it is deliberately absent
from durable route snapshots. On that revision, a view still following the
tail scrolls to the new bottom and immediately replaces any route-memory anchor
that referenced a removed row. If reader intent changed immediately before the
render, the view does not force a jump.

`MessageList` also reports bottom-follow changes to the coordinator
synchronously, independently of the intentionally debounced route snapshot.
Wheel/touch departures, scroll events, turn navigation, remembered-position
restore, resize preservation, and programmatic tail follow all update that
immediate signal. The coordinator defensively strips a cached anchor after an
accepted trim as well.

The right-side `UserTurnNavigator` now remeasures from retained anchors and
reconciles removed bookmark ids across hover bands, preview/window state,
long-press work, and open notch menus. Reverse-search selection and committed
target ids are also reconciled before paint. Component coverage verifies the
rail markers and thumb geometry, stale preview/menu/search cleanup, live-tail
bottom preservation, and the last-moment reader-intent guard. Automatic
trimming remained explicitly disabled until the preference integration below.

### 2026-07-10: Slice 5 complete — Performance preference and activation

Added the browser-local `sessionActiveWindowTrim` preference, defaulting to
enabled when no value is stored while preserving an explicit stored `false`.
The existing performance-settings external store publishes same-tab writes and
responds to cross-tab `storage` events. The Performance pane now exposes an
i18n-ready **Unload Older Transcript Messages** toggle, and its open-time value
participates in the pane-level Undo baseline.

`useSessionMessages` now passes the non-reactive preference getter to the
coordinator instead of the temporary disabled gate. A mounted coordinator reads
the current value on each constant-time eligibility check, so disabling blocks
future automatic trims without a remount; enabling permits a later relevant
transcript event to evaluate the existing window.

Hook coverage verifies default-on trimming from 31 to 20 user turns while
following the tail, an explicit opt-out, and re-enabling the same mounted view.
Settings coverage verifies persistence, same-tab publication, cross-tab
updates, accessible UI state, and Undo restoration. Automatic active-window
trimming is now active; Slice 6 remains for telemetry assessment and closeout.

## Goal

Prevent a session page that remains mounted for hours or days from retaining
every transcript message received since mount. While the reader follows the
bottom, keep the client session-detail store approximately within the same
semantic history limits as a fresh default page load. Full provider history
remains canonical on the server and recoverable through Load older.

This is client transcript-window maintenance, not provider context compaction.
It must not run `/compact`, change provider input, alter provider persistence,
or add a periodic server/background task.

## Product Decision

Automatic active-window trimming is **on by default** and has a browser-local
toggle in the Performance settings pane. This is an explicit product decision
under `topics/vanilla-defaults.md`:

- the retained result matches the bounded transcript shape a user already sees
  after a normal reload;
- trimming happens only while following the live tail, where removing an old
  prefix should not interrupt reading;
- omitted history remains available through the existing Load older control;
- the behavior does not change model context or provider-visible history; and
- users can disable it, and an explicitly stored `false` remains authoritative.

The setting controls future automatic trims. Disabling it does not reconstruct
rows already omitted; Load older or a reload can recover them.

## Current Behavior And Existing Seams

- Initial session detail requests use `tailCompactions=2` and normally
  `tailTurns=20`.
- Incremental stream and `afterMessageId` catch-up actions append to the loaded
  client window indefinitely.
- `SessionDetailState.pagination` already describes the loaded window and
  carries the `truncatedBeforeMessageId` cursor used by Load older.
- `replaceTailWindow` proves that the reducer/store can atomically change a
  mounted transcript's start boundary, but its current auxiliary-state handling
  is not sufficient for memory reclamation.
- The session-detail cache already owns entry-local state and a non-reactive
  scroll snapshot whose `atBottom` value can participate in the policy.

The implementation should add a purpose-named local trim action instead of
pretending an auto-trim is an anchor-miss REST replacement.

## Retention Contract

### Default semantic window

For an ordinary session route:

- retain the newest two compact-boundary windows;
- retain approximately the newest twenty real user turns; and
- select the later of those two candidate starts, matching the intersection
  semantics of the server's compact-tail plus turn-tail initial load.

Turn-based trimming uses hysteresis:

- target: `20` real user turns;
- trigger: more than `30` real user turns; and
- after the trigger, trim back to the target rather than one turn at a time.

Compact-boundary trimming may run once the currently loaded window contains
more than two compact boundaries and the candidate start passes the age guard.
The retained compact boundary itself remains visible as the top "Context
compacted" divider.

Use the same definition of a real user turn as session pagination: compact
summaries, command wrappers, skill bodies, tool-result-only rows, and other
synthetic user-shaped entries do not count. Prefer a shared client predicate or
fixture parity with `packages/server/src/sessions/pagination.ts`; do not invent
a looser `message.type === "user"` count in the hot path.

If the route has an explicit `tailTurns=N`, treat `N` as its target and derive a
conservative hysteresis trigger rather than silently forcing the default 20.
An explicit `tailFrom` is a user-selected history scope and suppresses automatic
trimming for that mount. A deliberately huge diagnostic `tailTurns` therefore
continues to behave like its matching fresh reload.

### Minimum age

Never trim when the proposed first retained boundary is 60 seconds old or
newer. The candidate must have a valid timestamp strictly older than
`now - 60_000`; otherwise the decision is "do not trim."

This is a conservative guard against cutting near active/live reconciliation.
It replaces the need for a provider-idle or catch-up-complete requirement: an
old prefix may be removed while the current tail is streaming because the trim
does not alter tail identity or ordering.

Do not schedule a timer just to make a candidate old enough. Cache the pending
candidate/eligible time if useful and reconsider on later transcript growth. If
the session stops growing, there is no need to wake it merely to trim.

### Reader intent and mount lifetime

Auto-trim is allowed only while the session scroll state is following the
bottom. If the reader is above the tail, keep the loaded window unchanged.

The first Load older request sets a mount-scoped `historyExpanded` suppression
flag before applying the older page. Automatic trimming remains disabled until
that session view actually unmounts. It must not immediately discard history
the reader explicitly requested.

The suppression flag is not durable provider/session metadata and is not
serialized into `SessionRouteSnapshot`. A later mount starts from the normal
bounded initial response and receives a fresh unsuppressed policy owner. DOM
linger counts as still mounted; only disposal of that view resets the flag.

## Cheap Decision Path

The frequently callable predicate must not walk `state.messages` on ordinary
stream traffic. Split the policy into two layers:

1. `shouldConsiderActiveWindowTrim(...)` performs constant-time gates.
2. `planActiveWindowTrim(...)` performs the bounded boundary search only when
   the gates say transcript structure relevant to the policy changed.

The constant-time gates should reject, in this order or equivalent:

- preference disabled;
- mount-scoped history suppression active;
- not following the bottom;
- explicit `tailFrom` scope;
- action cannot introduce a real user turn or compact boundary and no cached
  age-delayed candidate has become eligible; or
- the relevant turn/compact boundary revision was already evaluated.

Token deltas, streaming-placeholder replacement, markdown augments, metadata,
tool/agent map updates, subagent-only updates, and scroll snapshot patches must
not invoke a transcript scan. They may call the constant-time predicate.

Relevant structural events are:

- a newly appended real user turn;
- a new `compact_boundary`;
- a persisted catch-up/load batch that can contain either; and
- later transcript growth after a previously planned candidate crosses its
  cached `eligibleAfterMs`.

The planner should walk backward and stop once it has enough recent boundaries
to decide the two-compaction and turn-trigger/target candidates. Cache the last
evaluated structural revision and any age-delayed candidate. Do not repeatedly
scan an unchanged large transcript, and do not compute JSON byte charges for
this feature.

If a batch merge or tail replacement invalidates cached indices, invalidate the
small policy cache and rebuild it on the next relevant structural evaluation.
Load older both invalidates that cache and permanently suppresses further
planning for the mount.

## Reducer Transition

Add an explicit action, provisionally:

```ts
{
  type: "trimLoadedWindow";
  startMessageId: string;
  reason: "compact_boundary" | "user_turn";
  nowMs: number;
}
```

The reducer/helper resolves the retained suffix by stable message id and applies
all window changes atomically. If the id is missing, the message timestamp is
invalid/recent, or the suffix would be unchanged, return the existing state.

The transition must:

- retain the candidate boundary/message and every later message;
- preserve `session`, `lastMessageId`, `maxPersistedTimestampMs`, and deferred
  queue state;
- update pagination to `hasOlderMessages: true`, set
  `truncatedBeforeMessageId` to the first retained message id, set
  `returnedMessageCount` to the retained message count, preserve monotonic total
  counts, and record the trim reason;
- prune final markdown augments whose message ids are no longer retained;
- prune tool-use-to-agent mappings no longer referenced by retained messages or
  preserved active agent state;
- prune completed agent content no longer reachable from retained transcript
  rows or retained tool mappings; and
- preserve running/pending agent content even when its originating row was in
  the removed prefix, until the normal lifecycle marks it terminal and a later
  trim can reclaim it.

Implement reference collection as a pure helper with focused fixtures. Avoid
leaving unbounded orphaned auxiliary maps behind an apparently bounded
`messages` array.

## Scroll And Render Behavior

The store update is a single external-store notification. Because the policy
runs only while following the bottom:

- clear a retained scroll anchor whose message id was removed;
- preserve `atBottom: true` in the entry's scroll snapshot;
- ensure the existing follow-bottom layout path restores the new bottom after
  the prefix DOM rows unmount; and
- verify there is no visible one-frame jump or flash to an intermediate
  `scrollTop` as `scrollHeight` shrinks.

Do not add estimated-height spacers for removed messages. The loaded window's
scroll range genuinely becomes smaller; Load older is the way to recover its
prefix.

Search, quote, selection, and comment state should normally be absent while the
reader follows the bottom. If a concrete active UI state can reference a row
above the trim boundary while still reporting bottom-follow, add it as another
constant-time suppression gate rather than attempting to repair a removed DOM
selection.

The right-side `UserTurnNavigator` rail is part of the trim contract, not an
incidental resize effect. Its anchors derive from retained turn groups, so old
turn notches/bookmarks must disappear with their rows and the rail's marker
positions, active id, and scrollbar thumb must be fully remeasured against the
reduced `scrollHeight`. Reconcile or clear rail-local ids that no longer exist,
including `previewId`, `previewWindowAnchorId`, an open notch context menu, and
search/active marker state. Do not leave a hover preview or menu targeting a
trimmed turn merely because the rail was open during the store update.

## Performance Setting

Add a browser-local boolean preference alongside the other session performance
preferences:

- suggested `UI_KEYS` member: `sessionActiveWindowAutoTrim`;
- suggested storage key:
  `yep-anywhere-session-active-window-auto-trim-enabled`;
- default when absent or invalid: `true`;
- explicit stored `false`: remain disabled across reloads and bundles; and
- storage events: update other tabs through the existing performance-settings
  subscription.

Add the setting to `useSessionPerformanceSettings`, its external-store snapshot,
the Performance settings toggle, and the settings undo baseline. Add English
i18n copy only, following the repository locale fallback policy. Suggested
meaning: automatically unload older transcript messages while following the
live tail; full history remains available with Load older.

Changing the setting to off prevents future trims immediately. Changing it to
on permits the next relevant structural event to evaluate the current window;
it need not synchronously scan or trim inside the settings event handler.

## Implementation Slices

1. **Pure policy projection — complete 2026-07-10.** Added real-turn/compact
   classification, cheap structural gates, bounded planning, age guard, and
   fixtures. No React or DOM.
2. **Atomic reducer trim — complete 2026-07-10.** Added the action, pagination
   update, transitive reachability-based auxiliary pruning, and reducer/store
   fixtures.
3. **Coordinator lifecycle — complete 2026-07-10.** Wired bottom-follow input,
   structural revisions, cached age candidates, and mount-scoped Load older
   suppression behind an explicit disabled runtime gate.
4. **Scroll integration — complete 2026-07-10.** Preserved bottom-follow,
   cleared removed route anchors, reconciled the right-side turn rail and its
   thumb/local ids, and covered live-tail and reader-intent behavior.
5. **Performance setting — complete 2026-07-10.** Added the default-on
   preference, UI/i18n copy, Undo, storage-event behavior, activation, and
   focused settings/runtime tests.
6. **Telemetry and closeout.** Add low-volume aggregate trim diagnostics only
   if existing memory/row telemetry cannot show the effect. Do not log message
   text or emit per-check console chatter.

Keep these reviewable. In particular, do not combine the first implementation
with row virtualization, server pagination changes, provider compaction policy,
or a generic byte-budget framework.

## Verification

### Policy fixtures

- Disabled preference, history suppression, explicit `tailFrom`, and
  not-following-bottom all return without planning.
- Ordinary high-frequency stream/token/augment actions do not invoke the
  boundary planner.
- Two or fewer retained compact boundaries do not trigger compaction trimming;
  a third old boundary trims to retain the newest two.
- More than 30 real user turns trims to the newest 20; 21-30 turns do not trim.
- Compact and turn candidates compose by selecting the later start.
- Synthetic user-shaped rows do not count as turns.
- A candidate exactly 60 seconds old, newer, missing a timestamp, or carrying
  an invalid timestamp does not trim.
- An age-delayed candidate can be reconsidered on later growth without a timer
  or a full rescan of unchanged history.
- A custom turn target uses its own conservative hysteresis; `tailFrom`
  suppresses trimming.

### Reducer/store fixtures

- Prefix rows are removed and the first retained boundary remains present.
- Pagination points Load older at the first retained id and preserves
  total/count monotonicity.
- `lastMessageId` and the persisted timestamp watermark remain unchanged.
- Orphaned augments, tool mappings, and completed agent content are reclaimed.
- Retained references and active agent content survive.
- A missing/recent candidate is a referential no-op.
- Route snapshots written after trimming contain only the bounded window.

### Hook/UI/browser fixtures

- A following-bottom live session trims atomically and remains at bottom while
  new messages continue streaming.
- A reader above the bottom is not trimmed.
- The right-side turn rail contains only retained turn bookmarks after trim,
  remeasures marker/thumb geometry, and clears stale hover, preview, menu,
  active, and search ids for removed turns.
- Load older pins the mounted view before the older page is applied; subsequent
  growth does not trim until unmount/remount.
- Default preference is on, an explicit off persists, cross-tab storage events
  propagate, and settings undo restores the prior value.
- The Performance toggle uses i18n-ready copy and has an accessible label.
- A stress fixture can send many irrelevant external-store actions and assert
  that the planner/backward scan count remains zero.

Run at minimum:

```bash
pnpm --filter @yep-anywhere/client test -- src/lib/sessionDetail/__tests__/transcriptReducer.test.ts src/lib/sessionDetail/__tests__/sessionDetailCoordinator.test.ts src/hooks/__tests__/useSessionMessages.cache.test.tsx src/hooks/__tests__/useSessionPerformanceSettings.test.ts src/pages/settings/__tests__/PerformanceSettings.test.tsx
pnpm lint
pnpm typecheck
pnpm console:scan
```

Any browser test or client unit run must be warning-free under the repository's
zero-warning policy.

## Acceptance Criteria

- An ordinary mounted session following the tail periodically returns to a
  reload-equivalent semantic window instead of retaining all post-mount growth.
- No provider compaction, server tail re-fetch, polling timer, or byte budget is
  introduced.
- The common per-token/per-augment decision path is constant-time and does not
  scan transcript rows.
- No boundary 60 seconds old or newer is used for trimming.
- Load older disables auto-trim until that mounted view is disposed.
- Pagination and auxiliary state remain coherent and omitted history remains
  recoverable.
- The feature defaults on, is disableable in Performance settings, and honors
  an explicitly stored disabled preference.
