# Synthetic-turn injection

Topic: synthetic-turn-injection

Status: research note (not built). Records whether and how a fork/handoff
target can be seeded with a **sequence of synthetic user+assistant turns** —
turns the target model did not generate, carrying fabricated
(non-harness-registered) ids — instead of collapsing everything into one
synthetic user turn. Motivated by fork-after-summary interpretability.

See also:
[fork-from-turn](fork-from-turn.md) (the consumer: fork-after-summary submits a
single synthetic user turn today),
[recaps](recaps.md) (the summary facility that generates the collapsed text),
[session-context-actions](session-context-actions.md) (handoff posture this
would extend),
[provider-abstraction](provider-abstraction.md) (where a cross-provider inject
capability would live),
[compact-and-handoff](compact-and-handoff.md) (the adjacent compaction path that
also reshapes transcript history).

## Why this exists

Fork-after-summary collapses N source turns into **one** synthetic *user* turn
(`fork-from-turn.md` step 5; template contract there). That loses two things:

- **User-vs-agent authorization provenance** — a flat user turn cannot show
  "user authorized X · agent did Y–Z autonomously · user confirmed W." For a
  long autonomous `/loop` run, most of the compressed turns were agent-driven,
  and the receiver cannot see where the human actually greenlit.
- **Liveness honesty** — present-tense claims ("job in flight", "loop active")
  in the flattened prose float free of any real turn boundary.

There are two strengths of fix, and only the second needs this topic:

1. **Attributed content in one real user turn** (header + explicit attribution
   markers). No provider support required; covers the audit need. This is the
   recommended default and is tracked in `fork-from-turn.md`.
2. **Genuine synthetic alternation** — inject multiple user+assistant turns the
   target *model* replays as its own history. This doc is about whether the
   providers actually allow (2), and at what fidelity.

## Core question

Can a provider accept a **sequence** of synthetic user+assistant turns, with
fabricated ids and no server round-trip, as resumable model-visible history?

## Codex arm — first-class support

Verified by reading the inspected Codex source (`~/ya/.local-checkouts/
openai-codex-inspect` @ `251b241`, 2026-05-29; Codex CLI ~0.125.0 context per
`packages/server/src/sdk/providers/codex-turn-lifecycle-findings.md`). Codex's
rollout model makes synthetic alternation a supported operation, not surgery:

- **`InitialHistory::Forked(Vec<RolloutItem>)`** (`codex-rs/protocol/src/
  protocol.rs:2337`; variants `New | Resumed(ResumedHistory) | Forked(...)`). A
  thread can be started from an arbitrary vector of rollout items. Exercised in
  `core/src/thread_manager_tests.rs` with hand-built items, e.g.
  `InitialHistory::Forked(vec![RolloutItem::ResponseItem(user_msg("hello"))])`.
- **Live injection without a new turn** (`core/src/codex_thread.rs`):
  - `inject_response_items(Vec<ResponseItem>)` — "Record raw Responses API
    items without starting a new turn."
  - `inject_user_message_without_turn(String)` — "Records a user-role
    session-prefix message without creating a new user turn boundary."
- **Synthetic turn shape** (`external-agent-sessions/src/export.rs`):
  `ResponseItem::Message { id: None, role: "user"|"assistant",
  content: [InputText|OutputText] }`. `id: None` ⇒ **no server-assigned response
  id is required**. Each turn also emits paired `EventMsg`
  (`TurnStarted`/`UserMessage`/`AgentMessage`) carrying the UI/event view;
  `ResponseItem` is the model-visible unit (the synthesized `TokenCountEvent`
  counts only `ResponseItem::Message` content).
- **Fabricated turn ids are fine**: imported turns use
  `format!("external-import-turn-{n}")` — directly answers "without
  harness-registered uuids": Codex tolerates synthetic deterministic turn ids.
- **Tool calls are flattened to text**: the official importer collapses
  `tool_use`/`tool_result` into plain assistant `OutputText`
  (`records.rs`: a content block that is only a tool result maps to
  `MessageRole::Assistant` text). It does **not** reconstruct
  `FunctionCall`/`FunctionCallOutput` items. The safe synthetic form is
  text-only.
- **Provenance marker is an existing convention**: the importer appends an
  in-band `<EXTERNAL SESSION IMPORTED>` `AgentMessage`. Codex already marks
  synthetic/imported content in-band — direct precedent for an honest
  fork-after-summary boundary marker.

`external-agent-sessions` exists precisely to ingest a *foreign* agent session
(e.g. a Claude jsonl) as Codex rollout items — i.e. synthetic-turn injection is
already a shipped Codex feature, just aimed at whole-session migration.

**Unverified (Codex), the YA-integration crux:** whether YA's stdio app-server
JSON-RPC surface exposes `Forked`-start or `inject_response_items` directly, or
whether those are core-lib-only (reachable by embedding `codex-core`, not via
the app-server YA drives). An `import` RPC exists
(`app-server/src/request_processors.rs` → `ExternalAgentConfigRequestProcessor::
import`), but it is geared to whole foreign-session migration with detection,
not arbitrary mid-fork injection of a constructed item list. Next probe: read
`thread/start` + `thread/resume` params for an `InitialHistory`/`items` field;
determine whether `import` can target a chosen cwd with a caller-built item
vector.

## Claude arm — out-of-band only

What I know from YA's provider (`packages/server/src/sdk/providers/claude.ts`,
`types.ts`):

- **`forkSession`** (`claude.ts:1294` → `sdkForkSession`; primitive at
  `types.ts:293`): copies the jsonl with **remapped UUIDs**, optional slice at
  `upToMessageId`, kept prefix **byte-identical** to source so prompt-cache
  warmth carries over. There is **no inject/seed API** — fork is slice-only.
- Today's summary is submitted as **one ordinary user turn**; YA injects no
  synthetic assistant turns.
- **Feasible but unsupported:** append well-formed jsonl records
  (`type: user|assistant`, `message.content` blocks, a fabricated `uuid` with a
  correct `parentUuid` chain) to the forked session file *before* the first
  `query()` resume. The Claude jsonl shape is well-understood — Codex's own
  importer (`records.rs`) parses exactly these records (assistant records,
  `text`/`tool_result` content blocks), so the inverse construction is
  tractable.
- **Fragile part:** a synthetic assistant turn with a `tool_use` block needs a
  matching `tool_result`, or the next API `messages` array is malformed.
  Mitigate by keeping synthetic turns **text-only** (the same flattening the
  Codex importer uses). Resume replays the jsonl, so it should not validate
  uuid provenance — but this is reasoned, not verified.

**Unverified (Claude):** whether `sdkForkSession` or the Agent SDK exposes any
post-fork append/seed hook; whether resume rejects records with fabricated
uuids or unbalanced tool blocks. Next probe: inspect `sdkForkSession` internals
and whether `claude.ts` can write to the forked jsonl path between fork and
first `query()`.

## Design implications

- **Provider-agnostic 80% needs no injection.** Honest header + explicit
  user/agent attribution *inside the single real user turn* covers the
  authorization-provenance and liveness-honesty audit need on every provider.
  Recommended default; do this regardless of (2).
- **True synthetic alternation buys one thing:** making the target *model*
  experience prior agent reasoning as its own turns, so it continues
  in-character rather than reading a third-party status dump. Codex supports it
  cleanly; Claude requires out-of-band jsonl surgery.
- **Shared risk:** synthetic assistant turns put words in the model's mouth that
  it then treats as its own commitments — entrenching the summarizer's framing —
  and tool turns must be flattened, losing fidelity. Gate (2) behind a measured
  need (evidence that the flattened single-turn form degrades continuation),
  not as a default.
- **If built:** keep synthetic turns text-only on both arms, and adopt an
  in-band synthetic-content boundary marker (Codex's `<EXTERNAL SESSION
  IMPORTED>` is the precedent) so the transcript stays self-describing about
  what the model did vs. did not generate.

## Provenance

- Inspected source: `~/ya/.local-checkouts/openai-codex-inspect` @ `251b241`
  (2026-05-29). Treat as a snapshot, not a pinned dependency.
- Codex: `codex-rs/protocol/src/protocol.rs:2337` (`InitialHistory`);
  `codex-rs/core/src/codex_thread.rs` (`inject_response_items`,
  `inject_user_message_without_turn`);
  `codex-rs/external-agent-sessions/src/{export,records}.rs` (synthetic
  `RolloutItem` construction, flattening, provenance marker);
  `codex-rs/core/src/thread_manager_tests.rs` (`InitialHistory::Forked` usage).
- Claude: `packages/server/src/sdk/providers/claude.ts:1294` (`forkSession`);
  `packages/server/src/sdk/providers/types.ts:293` (fork primitive contract).
