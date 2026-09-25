# Live Codex commentary can render as a ladder of cumulative prefixes

During the first assistant turn of a new Codex session, the live transcript
showed the completed commentary paragraph followed by one bulleted row per
streaming snapshot: "I'll", "I'll read", "I'll read the", and so on. A page
reload removes every extra row. The observed case was a Codex 0.157.0 Astra
session in multi-agent mode whose first message carried a skill
(`01a0d957-2d1a-7331-b603-2f934dfe01d6`, 2026-09-25T16:12–16:14Z, on the
shared 3400 server, desktop browser).

## What the evidence rules out

- **Codex's stream.** A captured 0.157.0 Astra turn sends every
  `item/agentMessage/delta` with the same `itemId` as `item/completed`, and
  that id equals the durable `msg_…` response-item id in the rollout.
- **Persisted state.** The rollout holds one message per commentary item, and
  the session detail API returns one assistant row with one text block.
- **Server accumulation.** `buildStreamingAssistantMessage` in
  `packages/server/src/sdk/providers/codex.ts` keys the accumulated text by
  turn and item and emits every snapshot under `uuid = itemId`. Each rung
  being a longer prefix shows that accumulator worked.
- **The client merges by id.** `mergeStreamMessage` and `mergeMessage` in
  `packages/client/src/lib/mergeMessages.ts` replace a same-id row rather
  than appending, and never concatenate content blocks.
- **Stale provider code.** The session's worker started at 16:12:39 on
  current source.

## Reproduction attempts that stayed clean

On an isolated instance from this worktree (fresh data, desktop viewport),
DOM text was sampled every 250–300 ms for a real Astra first turn with a
four-sentence commentary preamble and two commands. No prefix rows appeared
either when the session was started through the API and opened directly, or
when it was started through the `/new-session` composer, whose navigation
state connects the stream before the first transcript load and replays
buffered stream messages.

## Remaining differences, ranked

1. The reporter's long-lived tab, including parked sessions kept mounted
   across A/B switches, versus a fresh page.
2. The temporary-to-real session id handoff: the server logged
   `session_id_mapping_updated` from a temporary id. Only one of the
   composer repro runs received a temporary id.
3. Multi-agent mode and code-mode (`custom_tool_call`) items, plus a skill
   attached to the first message.
4. Client appearance settings: the reporter's rows had bullet markers where
   the default view shows `>`, so the rendering view differed.

Each rung needs its own row identity. Look for a live path that assigns an
id other than the Codex item id, such as the `msg-${Date.now()}` fallback in
`useSession`'s stream handler, or a second subscription or coordinator
feeding one list.

Found 2026-09-25 while diagnosing a user report after the Codex 0.157.0
refresh.
