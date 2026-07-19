# Stream / Persisted Render Convergence

> Provider persistence is the durable transcript authority. The live stream
> may add useful ephemeral detail near the active tail, but live items that
> have persisted counterparts should converge with minimal structural change.

Topic: stream-persisted-render-parity

See also: [transcript-display-objects](transcript-display-objects.md) (the
opposite direction — display-only objects that are *not* provider turns),
[provider-authoring](provider-authoring.md) (a new provider must satisfy this
contract), [codex-sessions](codex-sessions.md),
[stream-durable-id-dedup](stream-durable-id-dedup.md) (the id/dedup half of
"same session, two sources"), and
[codex-code-mode-render-convergence](codex-code-mode-render-convergence.md)
(the Codex 5.6 normalization/rendering plan). Dev-doc:
`docs/project/multi-provider-integration.md`.

## The convergence contract

A session reaches the UI two ways:

- **Stream** — live provider events during a running turn (e.g. Codex
  `command_execution`, Claude SDK messages).
- **Persisted** — the same session re-read from disk later (Codex rollout
  JSONL, Claude JSONL DAG, OpenCode SQLite, …).

Both feed the same `compileTranscriptProjection` → render-item pipeline, but
equality is graded by whether the live item has a durable counterpart:

- **Durable-corresponding items — strong convergence.** Tool calls, tool
  results, assistant messages, and other records present in both paths should
  preserve semantic identity, ordering, grouping, parameters, and roughly the
  same layout. These are the highest-jank failures because a refresh can
  reorder several rows or replace one group with another.
- **Live enrichment — update in place.** Streaming output, elapsed time,
  progress, provisional status, or a more timely label may enrich a durable
  item while it is active. Prefer changes that do not alter row count, group
  boundaries, navigation anchors, or stable identity. Once the persisted
  counterpart is available, the item settles to the durable representation.
- **Truly ephemeral live items — allowed.** Thinking deltas, transient status,
  progress, and other provider events that are never persisted may appear and
  disappear near the live tail when they are useful. They are not evidence
  that YA should invent a parallel persisted transcript.

The practical stability boundary is therefore `settled transcript | recently
completed turn | active live tail`: the left side should be very stable; some
bounded movement at the right edge is expected. Provider persistence remains
the sole durable source of truth. In particular, Codex rollout files are the
canonical durable transcript; YA must not create a second durable message or
metadata record to preserve live-only shape.

For durable-corresponding items, "converge" is stronger than "eventually show
similar text." Structured fields are latent UI, and item count/order/grouping
are layout. A fact used to restructure a live tool call should either be
recoverable from persistence or be demonstrably safe as bounded optimistic
tail presentation.

## Enforcement

`packages/server/test/render-parity.test.ts` +
`test/utils/render-parity-harness.ts`. `assertRenderParity(name, persisted,
stream)` normalizes both render-item arrays and reports the first structural
difference by path (e.g. `$[3].toolResult.structured.exitCode`). The
`runPersistedPipeline` / `runStreamPipeline` pair build the two sides from the
same logical session; keep the two fixtures representing the *same* commands so
a drift means a real asymmetry, not two different sessions.

The harness intentionally enforces strict equality for facts and items that
the fixture declares paired. That is a conservative test for the
durable-corresponding category, not a ban on separate live-only event types.
When an intentional live-only item is added, test its tail lifecycle separately
and do not weaken paired-tool parity to accommodate it.

## Worked instance: Codex Bash `exitCode` (2026-07-01)

Adding `exitCode` to Codex structured Bash results surfaced it on the **stream**
path (`command_execution` events carry `exit_code`) but not on **reload**. Two
gaps, both fixed:

1. **The persisted parser dropped a recoverable code.**
   `normalizeCodexToolOutputWithContext`'s Bash branch computed `exitCode` but
   did not pass it to `createBashToolResult` — unlike the command-execution
   path. Fixed by threading `exitCode` through (`codex/normalization.ts`).
2. **The reload fixture was unrealistic.** Real Codex persists the exit code in
   a structured `exec_command_end` event (which funnels through the *same*
   `normalizeCodexCommandExecutionOutput` as the live stream); the parity
   fixture used only a plain `function_call_output` string, which carries no
   exit code for a zero exit. Fixed by adding the `exec_command_end` event the
   real reload path relies on (the later `function_call_output` is deduped).

The durable lesson: **make durable-corresponding items funnel through the same
normalizer using facts recoverable on both sides.** For these Codex commands
that means the structured `exec_command_end`, not a best-effort parse of an
output string. Live-only facts may still render at the active tail, but they
must not silently restructure the settled tool call after reload.

## Provider-normalizes direction (deferred)

`topics/bash-result-contract.md` proposes a provider-base Bash-result
normalizer so every provider emits the same structured facts (output,
empty-output, exit code, timing, interruption, background state). That is the
principled long-term home for this contract — a single normalizer both paths
share, per provider. Phase-1 (a default provider-base normalizer matching
today's Codex heuristic) is **not yet implemented**; the exitCode fix above is
the point fix. Track that work under bash-result-contract, and require a
stream+persisted parity fixture whenever a provider gains a new structured
field.
