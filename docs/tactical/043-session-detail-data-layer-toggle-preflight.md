# Store-Backed Messages Toggle Preflight

Topic: session-detail-data-layer

This note supports the tactical plan in
[`043-session-detail-data-layer-plan.md`](043-session-detail-data-layer-plan.md).
It records the remaining `useSessionMessages` main-transcript writes before a
hidden dogfood toggle can return store-selected `messages` instead of local
React state.

## Toggle Shape

Keep the first toggle narrow:

- Scope: returned `messages` only.
- Source: `selectSessionDetailMessages(defaultSessionDetailStore)`.
- Fallback: local `messages` state if the store entry is missing.
- Still maintain local mirrors for diagnostics, fallback, and rollback.
- Do not include `agentContent`, render selectors, scroll ownership, or `/btw`.

One important guard: warm snapshot restore currently writes the store before it
reveals local `messages`, because the hook intentionally yields through the
loading path. A naive `store ?? local` read would bypass that yield. The toggle
should either stay gated until hydration has completed, or explicitly accept and
test that behavior change.

## Main Transcript Transition Audit

| Boundary | Local mirror write | Store path | Preflight status |
| --- | --- | --- | --- |
| No warm snapshot reset | Clears local state while REST starts | Deletes the store entry | Ready with fallback to local empty state |
| Warm snapshot start | Clears local state before deferred reveal | Restores route snapshot immediately | Needs hydration gating before broad toggle |
| Warm catch-up before hydration | Merges REST delta into warm snapshot | `applyCatchupMessages` over restored snapshot | Hook/store parity asserted |
| Warm catch-up after hydration | Merges REST delta into revealed snapshot | `applyCatchupMessages` over restored snapshot | Hook/store parity asserted |
| Cold persisted load | Sets tagged/reconciled REST snapshot | `loadPersistedTranscript` | Reducer and hook/store coverage exist |
| Ordinary stream/replay | Merges stream row with replay suppression | `applyStreamMessage` | Reducer/provider fixtures cover dedupe; hook uses local mirror |
| Main streaming placeholder upsert | Copies selector-backed store result | `upsertStreamingPlaceholder` | Selector-backed |
| Main streaming placeholder cleanup | Copies selector-backed store result | `clearStreamingPlaceholders` | Selector-backed |
| Incremental persisted catch-up | Merges new REST rows and updates cursor | `applyCatchupMessages` | Hook/store parity asserted |
| Older-page prepend | Prepends older REST rows and updates cursor | `prependOlderMessages` | Hook/store parity asserted |

## Remaining Toggle Risks

- Warm snapshot timing is the main behavioral risk. The store has messages
  earlier than the returned local mirror during deferred loading.
- Stream/replay parity depends on provider-specific approximate dedupe. Reducer
  fixtures cover the important Codex shapes, but the hook still computes local
  state independently after dispatch.
- Cursor and persisted timestamp watermark side effects stay outside the
  selector read. The store can own the returned array before it owns those refs,
  but tests must keep covering both.
- Subagent `agentContent` is deliberately out of scope for the first toggle.
  Its live-vs-durable parity remains broad-shape only.

## Readiness Call

The next implementation chunk can add a hidden opt-in only if it includes the
hydration guard above. Without that guard, dogfooding would also test a loading
behavior change, not just a data-source change.
