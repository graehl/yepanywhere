# Stream / Persisted Render Parity

> For every provider, rendering a session **live from the stream** and
> rendering the **same session reloaded from persisted storage** must produce
> equivalent UI. Streaming is not allowed to surface information that reload
> silently drops.

Topic: stream-persisted-render-parity

See also: [transcript-display-objects](transcript-display-objects.md) (the
opposite direction — display-only objects that are *not* provider turns),
[provider-authoring](provider-authoring.md) (a new provider must satisfy this
contract), [codex-sessions](codex-sessions.md),
[stream-durable-id-dedup](stream-durable-id-dedup.md) (the id/dedup half of
"same session, two sources"). Dev-doc: `docs/project/multi-provider-integration.md`.

## The invariant

A session reaches the UI two ways:

- **Stream** — live provider events during a running turn (e.g. Codex
  `command_execution`, Claude SDK messages).
- **Persisted** — the same session re-read from disk later (Codex rollout
  JSONL, Claude JSONL DAG, OpenCode SQLite, …).

Both feed the same `preprocessMessages` → render-item pipeline. **The two
render-item streams must be equivalent** — same tool calls, same results, same
*structured* fields. This is provider-agnostic: it is a property of every
provider's stream-vs-reload pair, not a Codex-only concern. The harness
currently exercises Codex because that is where a divergence was found; adding
a stream+persisted fixture for another provider is the way to extend coverage,
not a sign the contract is Codex-scoped.

"Equivalent UI" is stronger than "equivalent visible text": the parity harness
compares the **structured tool-result objects**, so a field that renders
nothing today (e.g. `exitCode: 0`, which only shows `rc=N` when non-zero) still
must match. The reason is that structured fields are latent UI — a later
renderer change can surface them, and a value present live but absent on reload
would then flicker in and out across a reload.

## Enforcement

`packages/server/test/render-parity.test.ts` +
`test/utils/render-parity-harness.ts`. `assertRenderParity(name, persisted,
stream)` normalizes both render-item arrays and reports the first structural
difference by path (e.g. `$[3].toolResult.structured.exitCode`). The
`runPersistedPipeline` / `runStreamPipeline` pair build the two sides from the
same logical session; keep the two fixtures representing the *same* commands so
a drift means a real asymmetry, not two different sessions.

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

The durable lesson: **make both sides funnel through the same normalizer with
the same information source.** For Codex commands that means the structured
`exec_command_end`, not a best-effort parse of an output string. When a stream
event carries a structured fact (exit code, timing, interruption), ensure the
persisted representation carries the same fact, and parse it into the same
structured field.

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
