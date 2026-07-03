# Provider Output Contract

> The provider output contract is the single spec for the normalized objects
> every provider integration must produce — message envelope, content blocks,
> structured tool results, status, and lineage links. The named TS types are
> the type definition; runtime validation stays off hot paths.

Topic: provider-output-contract

See also:
[provider-authoring](provider-authoring.md) (the workflow map — *how to add*
a provider; this topic is the output half, *what a provider should attempt
to produce*),
[provider-abstraction](provider-abstraction.md) (when a provider/model
conditional gets promoted to the `AgentProvider` seam),
[stream-persisted-render-parity](stream-persisted-render-parity.md) (the
binding equivalence between the two delivery paths),
[stream-durable-id-dedup](stream-durable-id-dedup.md) (id stability across
stream and durable copies),
[provider-state-machine](provider-state-machine.md) (the status half of the
contract),
[provider-session-tree](provider-session-tree.md) (lineage capability audit),
[transcript-display-objects](transcript-display-objects.md) (display-only
objects that are *not* provider output).

## Rule: normalize in the provider layer, against this spec

All provider-specific shape conversion happens in the provider seam — the
session reader, the stream adapter, and their normalization helpers — and
produces the shapes named here. Routes, renderers, and the client must not
carry provider conditionals that repair output shape; a shape defect in what
a provider emits is fixed in that provider's normalization helper, behind
this contract. ([provider-abstraction](provider-abstraction.md) governs when
an existing scattered conditional gets promoted into the seam.)

Where normalization lives today:

- **Persisted path.** Readers (`packages/server/src/sessions/*-reader.ts`)
  return provider-raw payloads inside `UnifiedSession`
  (`packages/shared/src/session/UnifiedSession.ts`, a tagged union by
  provider). `normalizeSession`
  (`packages/server/src/sessions/normalization.ts`) is the central
  per-provider switch that converts raw entries to normalized `Message`s,
  delegating to provider-specific helpers
  (`packages/server/src/codex/normalization.ts`,
  `packages/server/src/sdk/providers/gemini-tools.ts`,
  `packages/server/src/sdk/providers/opencode-tools.ts`,
  `packages/server/src/sessions/claude-messages.ts`).
- **Stream path.** Provider stream adapters under
  `packages/server/src/sdk/providers/` emit messages that
  `normalizeStreamMessage` (`packages/server/src/subscriptions.ts`) touches
  only lightly; heavy provider-specific transforms belong upstream in the
  adapter.

New provider work extends those helpers; it does not add conversion logic
downstream of them.

## Two delivery paths, one output

A session reaches the UI live from the **stream** and again later
re-read from **persisted** storage. Both feed the same render pipeline, and
[stream-persisted-render-parity](stream-persisted-render-parity.md) requires
the two render-item streams to be equivalent — same tool calls, same
*structured* result fields, not merely the same visible text. Message ids
must match deterministically across the two paths wherever the provider
allows ([stream-durable-id-dedup](stream-durable-id-dedup.md)); a provider
whose ids genuinely cannot align sets the `needsApproxMessageDedup`
capability and accepts the tight content+timestamp reconcile backstop.

## Typing stance: rigidly described, loosely enforced

The runtime representation is deliberately dict-like. The hot read path
casts (`JSON.parse(line) as ClaudeSessionEntry` in the Claude reader); the
client `Message` is an all-optional interface with an open
`[key: string]: unknown` index signature. There is no hot-path schema
validation, and none should be added — transcript reads and stream fan-out
are the highest-rate surfaces in the server.

The rigid description lives in named types, which are this contract's type
definition:

- `AppMessage`, `AppMessageExtensions`, `AppContentBlock` —
  `packages/shared/src/app-types.ts` (persisted entry + app extensions; the
  main app-side message type).
- Client `Message` — `packages/client/src/types.ts`.
- Server `Message`, `SessionSummary`, `Session` —
  `packages/server/src/supervisor/types.ts`.
- Zod schema families — `packages/shared/src/claude-sdk-schema/`
  (`entry/`, `message/`, `content/`, `tool/`, `guards.ts`), validated
  offline via `scripts/validate-jsonl.ts` and
  `scripts/validate-tool-results.ts` and in tests.

TS-only types are erased at compile time, so naming and expanding them has
**zero runtime cost**; the cost line is runtime `.parse()`, which stays in
offline validation and tests. Where a Zod schema exists, prefer the
`z.infer`-derived named type (as `claude-sdk-schema/types.ts` already does)
so the doc, the type, and the validator cannot drift three ways. A new
normalized shape gets a named exported type in `packages/shared` and a
mention here.

## The normalized message envelope

What a provider's normalization must attempt to supply per message. Unknown
fields are **passed through, never stripped** — consumers tolerate extras;
they rely only on the fields below.

- **Identity**: `uuid` (preferred) or `id`; consumers resolve identity as
  `uuid ?? id` (`getMessageId`). The id must be stable between the streamed
  copy and the durable copy of the same message (see parity/dedup above).
  Dedup and incremental fetch (`afterMessageId`) key on it; there are no
  content hashes anywhere in identity judgment.
- **Kind**: `type` — `user` | `assistant` | `system` | `summary`, plus
  provider-specific subtypes discriminated further by `subtype`. `role` is
  set for user/assistant.
- **Content**: canonical location is `message.content` (string or
  `AppContentBlock[]`); a top-level `content` convenience copy is added by
  the reader. Block types consumers render: `text`, `thinking`
  (+`signature`), `tool_use` (`id`, `name`, `input`), `tool_result`
  (`tool_use_id`, `content`, `is_error`). Unknown block types pass through.
- **Timestamp**: ISO-8601 `timestamp`. Load-bearing, not decorative: the
  approx-dedup backstop windows, pending-echo reconciliation, and ordering
  fallbacks all compare timestamps.
- **Structured tool results**: `toolUseResult` (and/or a `tool_result`
  block). The parity harness compares these as structured objects; a field
  present in the stream copy must survive the persisted copy.
- **Lineage**: `parentUuid` when the provider has entry-level parent links
  (see next section). Null/absent for linear providers.
- **App extensions** (added by YA downstream, never by the provider
  normalization itself): `_source` (`sdk`/`jsonl`), `_isStreaming`,
  `isSubagent`, `orphanedToolUseIds` — documented in
  `AppMessageExtensions`.

## Status

The status half of the contract is
[provider-state-machine](provider-state-machine.md): `processState`
(`idle`/`in-turn`/`waiting-input`), `sessionLiveness.derivedStatus`,
compacting, and ownership. Providers supply raw process/stream events; the
seam derives these normalized states — the same
normalize-in-the-provider-layer rule applies.

## Lineage: forest links at two levels

Provider lineage appears at two distinct levels, and the contract keeps them
separate:

- **Entry-level parent links** (a message forest inside one transcript):
  Claude `parentUuid` (single-parent branching forest — see the
  `packages/shared/src/dag.ts` module header), Pi v3 `id`/`parentId`.
- **Session-level parent links** (lineage between session ids): Codex
  `forked_from_id` → `parentSessionId` (codex reader), OpenCode session
  `parentID`, and YA's own fork metadata `parentSessionId`.

Distinguish **harness-native data model** from **what YA currently
surfaces**. Capability flags describe the latter only: Pi natively maintains
a tree (`/tree`, per-entry `parentId`) while YA reads just the active-leaf
path, so Pi's `supportsDag` is `false` without contradicting Pi's data
model. The audit and the proposed `sessionTree` capability live in
[provider-session-tree](provider-session-tree.md).

**Traversal rule**: any parent-link traversal — linearization, reorder
repair, walk-to-root, tree projection — uses the shared facility in
`packages/shared/src/dag.ts` (`orderByParentChain`, `needsReorder`, over the
`DagOrderable` view) rather than a hand-rolled per-provider walk. The
facility is deliberately a small family, because the traversals differ by
intent: conservative reorder repair (never invents order), active-leaf path
selection, and lineage/tree projection. Extend it by generalizing the
id/parent accessors (today it hardcodes `parentUuid`), not by copying the
loop. Known debt predating this rule: the Pi reader's walk-to-root and the
Claude reader's DAG handling are self-contained.

## Capabilities registry

Client-side capability flags (`ProviderCapabilities`,
`packages/client/src/providers/types.ts`): `supportsDag`,
`supportsCloning`, `needsApproxMessageDedup`, `approxDedupExcludesTools`.
Each flag is a claim about how far the provider's normalization satisfies a
section of this contract; when a provider's normalization improves (e.g.
deterministic id alignment lands), flip the flag in the same change.
