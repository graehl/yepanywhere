# pi Provider

> pi (a.k.a. pi-mono) is Mario Zechner's provider-agnostic coding agent. This
> topic covers (a) integrating pi as a YA provider backend and (b) periodically
> tracking Zechner's pi work — the web-UI/TUI refactor and third-party remote
> web clients — because a remote pi supervisor overlaps YA's value proposition.

Topic: pi-provider

## What pi is

A TypeScript monorepo coding agent with a session-first runtime
(`AgentSession`), JSONL append-only session storage (`~/.pi/agent/sessions`,
`id`/`parentId` branching tree), explicit cross-provider message normalization
(`transformMessages`), and a runtime provider-registration API
(`registerProvider()`). Upstream is `badlogic/pi-mono`; active development also
appears under `earendil-works/pi` (packages `pi-ai` / `pi-agent`). Treat the
exact repo/org relationship as unconfirmed and check both when tracking.

YA already has a deep evaluation of pi-mono as a backend; do not redo it. See
[`../docs/research/opencode-vs-pi-mono-provider-backend-comparison.md`](../docs/research/opencode-vs-pi-mono-provider-backend-comparison.md).

## Why YA cares

The research doc's conclusion: **pi-mono is the better primary agnostic-backend
candidate than OpenCode** for YA's goal (provider/model agnosticism,
bring-your-own keys, transparent session persistence, flexible local tool
execution). It aligns with YA's `AgentProvider` / `AgentSession` shape, has
first-class cross-provider handoff tests, and inspectable JSONL storage.

Separately: pi's own remote/web-UI direction matters competitively. If a good
remote pi supervisor exists or emerges, it overlaps directly with YA. Tracking
it informs both "should YA add pi as a backend" and "what does YA's mobile
supervisor offer that a pi-native web UI does not."

## Integration plan (from the research doc)

Two-layer design: a backend adapter layer (`PiAdapter`, alongside
`OpenCodeAdapter`) for lifecycle/transport, and YA's normalized session/event
layer for UI and persistence indexing.

- **Phase 1 (pragmatic):** add a `pi` provider; integrate via pi **RPC mode**
  first (stdin/stdout JSON-RPC — stable process boundary, typed protocol); add a
  `PiSessionReader` for `~/.pi/agent/sessions` JSONL trees.
- **Phase 2 (first-class):** optional in-process pi SDK path
  (`createAgentSession`) behind a feature flag; compare latency/memory/failure
  vs RPC.
- **Phase 3 (normalization hardening):** promote a shared normalized event
  contract mapping pi `message_*` / `tool_execution_*` / `turn_*` and OpenCode
  events into one internal envelope.

Known integration cost: pi has no OpenCode-style standalone permission endpoint,
so YA must layer a thin permission-policy UX on top of pi tool events to match
the Claude/OpenCode approval UX.

## What to track (periodic)

The user wants at least periodic checks on Zechner's progress: refactored web
UI vs TUI vs other clients. Re-check these and update this section with dates:

- **`earendil-works/pi#339`** — "Move agent-loop to `pi-agent`, use
  `AppMessage` throughout" (closed). Architectural cleanup that makes
  `AppMessage[]` the single message type through the agent layer and transforms
  only at the LLM boundary, preserving message metadata in emitted events.
  Relevance: a cleaner, metadata-preserving event stream is exactly what a YA
  adapter (or any web UI) consumes — worth confirming the post-refactor event
  shape before building `PiAdapter`.
- **`VVander/pi-remote-web-ui`** — third-party browser UI for the pi agent.
  In-process single `AgentSession` (per pi SDK guidance), WebSocket broadcast of
  agent events with `state_sync` full-history replay to new tabs, SSH
  port-forward access (binds `127.0.0.1`, SSH-key auth, no passwords/tokens).
  Modest community traction. Desktop-oriented today. Relevance: a reference
  implementation of the in-process embedding path (YA's Phase 2) and a
  competitive data point for remote pi supervision.
- **General:** watch pi's RPC protocol stability (`rpc-types`), any official web
  UI / TUI split, and whether the refactor changes the session/event surface a
  YA adapter would bind to.

## Related

- [`opencode-backend.md`](opencode-backend.md) — the other agnostic-backend
  candidate; pi is recommended primary, OpenCode secondary/fallback.
- [`provider-abstraction.md`](provider-abstraction.md) /
  [`provider-state-machine.md`](provider-state-machine.md) — the
  `AgentProvider` / `AgentSession` contract a `PiAdapter` must satisfy.
- [`deferred-roadmap.md`](deferred-roadmap.md) — item 7 places this in priority
  order.
