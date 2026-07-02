# Store-Backed Messages Toggle Preflight

Topic: session-detail-data-layer

This note supports the tactical plan in
[`043-session-detail-data-layer-plan.md`](043-session-detail-data-layer-plan.md).
It records the remaining `useSessionMessages` main-transcript writes before the
Developer settings dogfood toggle returns store-selected `messages` instead of
local React state. The first dogfood toggle now exists as Store-Backed Session
Messages in the Development settings page.

## Toggle Shape

The first toggle started narrow and now covers the two returned hook data
surfaces that already have selector-backed mirrors:

- Scope: returned `messages` and `agentContent`.
- Source: `selectSessionDetailMessages(defaultSessionDetailStore)` and
  `selectSessionDetailAgentContent(defaultSessionDetailStore)`.
- Fallback: local `messages`/`agentContent` state if the store entry is
  missing or the hook has not reached the reveal point.
- Still maintain local mirrors for diagnostics, fallback, and rollback.
- Do not include render selectors, scroll ownership, or `/btw` in this toggle.

One important guard: warm snapshot restore currently writes the store before it
reveals local `messages`/`agentContent`, because the hook intentionally yields
through the loading path. A naive `store ?? local` read would bypass that
yield. The toggle is gated until `loading` is false so dogfooding tests the
data source change without also changing the deferred warm-reveal behavior.

## Main Transcript Transition Audit

| Boundary | Local mirror write | Store path | Preflight status |
| --- | --- | --- | --- |
| No warm snapshot reset | Clears local state while REST starts | Deletes the store entry | Ready with fallback to local empty state |
| Warm snapshot start | Clears local state before deferred reveal | Restores route snapshot immediately | Needs hydration gating before broad toggle |
| Warm catch-up before hydration | Merges REST delta into warm snapshot | `applyCatchupMessages` over restored snapshot | Hook/store parity asserted |
| Warm catch-up after hydration | Merges REST delta into revealed snapshot | `applyCatchupMessages` over restored snapshot | Hook/store parity asserted |
| Cold persisted load | Sets tagged/reconciled REST snapshot | `loadPersistedTranscript` | Reducer and hook/store coverage exist |
| Ordinary stream/replay | Merges stream row with replay suppression | `applyStreamMessage` | Store-backed return parity asserted |
| Main streaming placeholder upsert | Copies selector-backed store result | `upsertStreamingPlaceholder` | Selector-backed |
| Main streaming placeholder cleanup | Copies selector-backed store result | `clearStreamingPlaceholders` | Selector-backed |
| Incremental persisted catch-up | Merges new REST rows and updates cursor | `applyCatchupMessages` | Store-backed return parity asserted |
| Older-page prepend | Prepends older REST rows and updates cursor | `prependOlderMessages` | Store-backed return parity asserted |

## Remaining Toggle Risks

- Warm snapshot timing is the main behavioral risk. The store has messages
  earlier than the returned local mirror during deferred loading.
- Stream/replay parity depends on provider-specific approximate dedupe. Reducer
  fixtures cover the important Codex shapes, but the hook still computes local
  state independently after dispatch.
- Cursor and persisted timestamp watermark side effects stay outside the
  selector read. The store can own the returned array before it owns those refs,
  but tests must keep covering both.
- Subagent `agentContent` live-vs-durable parity remains broad-shape only. The
  dogfood toggle can prove store read ownership for the current shape, but it
  does not make streamed and persisted subagent transcripts semantically
  equivalent.

## Readiness Call

The Developer settings opt-in is ready for dogfooding returned `messages` and
`agentContent`. The next implementation chunk should keep capturing any
returned-data divergence as a compact reducer or hook fixture while starting a
render-selector preflight. Scroll ownership and `/btw` remain out of scope.
