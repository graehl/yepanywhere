# OpenCode Backend

> The OpenCode backend is YA's provider integration contract for starting,
> resuming, controlling, and rendering OpenCode sessions without losing
> provider-specific transcript meaning.

Topic: opencode-backend

See also [`pi-provider.md`](pi-provider.md): pi-mono is the other
agnostic-backend candidate, recommended primary with OpenCode as
secondary/fallback (see `../docs/research/opencode-vs-pi-mono-provider-backend-comparison.md`).

See also [`opencode-copilot.md`](opencode-copilot.md): the prioritized plan to
expose GitHub Copilot models through this backend (with a gating baseline review
against the upgraded `opencode` binary) plus the copilot auth UX; it
re-prioritizes the "Gaps To Close" list below around the copilot goal. The "Gaps
To Close" contracts here remain authoritative for the general fleshout detail.

## Scope

OpenCode is integrated through `opencode serve` plus HTTP and SSE, not through a
Claude-style SDK iterator or the Codex app-server JSON-RPC surface. That makes
the provider useful for local and alternate model backends, but the adapter must
translate more provider-specific concepts itself:

- live SSE events from `packages/server/src/sdk/providers/opencode.ts`;
- durable file or `opencode export` reads in
  `packages/server/src/sessions/opencode-reader.ts`;
- normalized session content in
  `packages/server/src/sessions/normalization.ts`;
- generic YA content block rendering in
  `packages/client/src/components/renderers/`.

## Capability Comparison

| Capability | Claude | Codex | OpenCode status |
|---|---|---|---|
| Session startup and resume | SDK `query()` with `resume` and native session files. | App-server `thread/start` / `thread/resume`. | Starts or resumes native `ses_*` sessions through `opencode serve`; YA currently exposes that native ID as the session ID. |
| Initial message | Queued through `MessageQueue`. | Queued through `MessageQueue`. | Queued through `MessageQueue`, then sent as a single OpenCode text part. |
| Global instructions | SDK system prompt append. | Prompt-visible `[Global context]` prefix on first turn. | Same prompt-visible `[Global context]` prefix as Codex, not a native system/config channel. |
| Uploaded file references | `.attachments` references are appended by `MessageQueue`; image blocks can also be passed to the Claude SDK. | `.attachments` references survive as text; image blocks are discarded when Codex extracts text for app-server input. | `.attachments` references survive as text; image blocks are discarded when OpenCode extracts text for the POST body. |
| Permission modes | Passed to SDK; YA `canUseTool` mediates approvals. | Maps YA modes to app-server approval/sandbox policy and handles approval requests. | Provider reports no YA permission-mode support. An optional e2e test observes OpenCode `permission.asked`, but YA does not yet route it to the normal approval UI. |
| Slash commands | Native SDK command list, with YA `/goal` alias for `/loop` when needed. | YA advertises built-in `/goal`; native command surface is app-server-specific. | `supportsSlashCommands=false`; no advertised command list or `/compact` equivalent in YA. |
| Thinking and effort settings | Passed to SDK and adjustable through `setMaxThinkingTokens`. | Maps YA thinking/effort to Codex reasoning effort. | `supportsThinkingToggle=false`; OpenCode model/provider options are selected, but YA thinking/effort controls do not map to provider options. |
| Steering and interrupt | Graceful interrupt exists; provider steering flag is false. | Supports active `turn/steer` and `turn/interrupt`. | No steering hook and no graceful interrupt hook; abort terminates the per-session `opencode serve` process. |
| Model changes | SDK-supported `setModel` and supported-model inventory. | Model inventory from app-server/fallbacks; model/service tier passed at thread and turn start. | Model inventory from `opencode models`, with `local-glm/*` sorted first; no dynamic `setModel` hook. |
| Recaps and prompt suggestions | Recaps plus native prompt suggestions. | Recaps, but not native prompt suggestions. | No recap or prompt-suggestion capability flags. |
| Clone/DAG UI metadata | Client metadata says DAG and cloning are supported. | Client metadata says cloning is supported, linear history. | Client metadata marks both DAG and cloning unsupported. |
| Liveness | SDK/process probes. | App-server thread probes and raw event cadence. | `/session/status`, `session.status`, and `session.idle` are integrated as liveness evidence. |

## Transcript Rendering Coverage

The generic YA renderer already understands these normalized content block
types: `text`, `thinking`, `tool_use`, and `tool_result`. OpenCode quality in
the session view therefore depends mostly on how completely the live and durable
OpenCode paths produce those blocks.

Live stream path in `opencode.ts`:

| OpenCode SSE shape | Current YA mapping | Gap |
|---|---|---|
| `message.part.updated` / `message.part.delta` with `type: "text"` | Assistant text, after role filtering through `message.updated`. | Covered for live text; user text parts are intentionally not assistant progress. |
| `type: "reasoning"` | YA `thinking` block. | Covered live, but only when the part is seen through SSE or POST fallback. |
| `type: "tool-use"` | YA `tool_use` block. | Generic block is covered; OpenCode lower-case tool names still miss rich renderer aliases. |
| `type: "tool-result"` | YA `tool_result` block. | Pairing assumes the result part ID is the correct `tool_use_id`; this should be fixture-tested against real OpenCode events. |
| `type: "step-finish"` with tokens | YA `result` usage message. | Cost, reason, and snapshot metadata are not rendered. |
| `type: "step-start"` | Ignored. | Usually metadata, but the ignored count should stay visible in coverage metrics. |
| `session.diff` | Ignored. | File-change summaries are not mapped to read/edit/diff UI. |
| `permission.asked` | Ignored by the provider adapter. | No bridge to the YA approval UI. |

Durable reader path in `normalization.ts`:

| OpenCode stored/export shape | Current YA mapping | Gap |
|---|---|---|
| `type: "text"` | YA `text` block. | Covered. |
| old stored `type: "tool"` with `callID` | YA `tool_use`; completed tools also produce `tool_result`. | Generic block is covered, but lower-case OpenCode tool names fall through to the raw JSON fallback renderer. |
| `type: "reasoning"` | Ignored. | Historical/session reload view drops OpenCode thought blocks instead of rendering YA `thinking`. |
| event-shaped `type: "tool-use"` / `type: "tool-result"` in exports | Ignored. | If newer exports use the live-event part shape, historical tool blocks disappear. |
| `type: "step-finish"` | Ignored as a part. | Message-level token usage is rendered when present, but part-level cost, reason, snapshot, and token metadata are lost. |
| `type: "step-start"` | Ignored. | Usually acceptable metadata; still count it when measuring coverage. |

## Local Export Sample

On 2026-06-01, OpenCode 1.15.13 had eight sessions under this project path. Seven
exported as parseable JSON; one older export was malformed or truncated. Across
the seven readable exports:

| Part type | Count | Durable block coverage today |
|---|---:|---:|
| `text` | 17 | 17 |
| `reasoning` | 9 | 0 |
| `step-start` | 9 | 0 |
| `step-finish` | 8 | 0 |
| `tool` | 5 | 5 generic tool blocks |

If every part is counted, the durable reader maps 22 of 48 parts to visible YA
blocks. If `step-start` and `step-finish` are treated as metadata rather than
content/action/thought blocks, the durable reader maps 22 of 31 semantically
visible parts. The missing visible parts in that sample are all nine
`reasoning` parts.

The five sampled tool parts used OpenCode tool names `bash` and `task`. YA's
tool renderer registry has rich renderers for `Bash` and `Task`, and aliases for
some Codex/OpenAI names, but not these lower-case OpenCode names. So those five
parts become generic `tool_use` / `tool_result` blocks, but do not get the rich
Bash/Task presentation yet.

These counts are local evidence, not a product-wide statistic. A real regression
test should record fixture exports and SSE events, count OpenCode part/event
types, and report both raw coverage and coverage after excluding deliberate
metadata-only parts.

## Gaps To Close

1. Durable reasoning: map stored/export `reasoning` parts to YA `thinking`
   blocks, with a fixture that proves historical OpenCode sessions preserve
   thought blocks after reload.
2. Durable event-shape parity: accept both old stored `tool` parts and newer
   live-style `tool-use` / `tool-result` parts in the durable normalizer.
3. Tool name aliases: map OpenCode names such as `bash` and `task` to YA's rich
   `Bash` and `Task` renderers where the input/result schema is close enough.
   Keep unknown OpenCode tools explicit rather than forcing misleading aliases.
4. Tool result pairing: verify whether OpenCode `tool-result.id` is always the
   correct YA `tool_use_id`. If not, preserve call IDs or nearby tool-use state
   in the adapter.
5. Permission bridge: wire `permission.asked` and `GET /permission` /
   `POST /permission/:id/reply` into YA's normal approval panel if OpenCode's
   semantics match the existing allow/deny model.
6. Native command inventory: investigate whether OpenCode exposes slash or agent
   commands that can populate `supportedCommands`, especially compact-like
   maintenance commands.
7. Thinking/effort options: decide whether OpenCode model options can represent
   YA thinking and effort settings. Until then, keep the UI capability flag off.
8. Attachments and multimodal input: keep text `.attachments` references, but do
   not imply image content is sent until OpenCode POST parts can carry it
   structurally.
9. Graceful control: add interrupt/steer only if OpenCode exposes a provider
   operation that does not require killing the per-session server.
10. Session ID split: preserve a provider-native `ses_*` ID separately from the
    YA session ID when OpenCode can be resumed through YA-owned IDs without
    breaking existing links.

## Verification Shape

OpenCode backend changes should be checked against both live and durable paths:

- live SSE fixture: text deltas, final updates, reasoning, tool use/result,
  `step-finish` usage, and role-filtered user parts;
- durable export fixture: old stored `tool`, live-style `tool-use` /
  `tool-result`, `reasoning`, `step-finish` usage, and lower-case tool names;
- UI renderer fixture or client test: OpenCode `bash` and `task` aliases either
  reach rich renderers or intentionally fall back with clear raw display;
- liveness fixture: `/session/status`, `session.status`, `session.idle`, and
  malformed/missing entries still follow `topics/session-liveness.md`.
