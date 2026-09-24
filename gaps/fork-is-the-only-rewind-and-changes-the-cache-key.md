# Fork is YA's only rewind, and a fork changes the provider cache key

YA's only way to continue from an earlier point of a conversation is
`forkSession` ([provider fork support](../topics/provider-fork-support.md)):
a new provider session id carrying a copied or reference-backed prefix. On
both wired providers the cache identity follows the session id, so the child's
first request is a cache-miss candidate even when the parent's prefix is warm.
[Quick Answer forks](quick-answer-fork-cache-efficiency.md) measured that miss
on Codex (94% uncached input across three forks; 85% on a native `/side`
reproduction). YA has no control over which cache shard a new id lands on.

Both providers expose an **in-place rewind** that keeps the session id, which
YA's provider control surface does not offer as an operation. This entry
records what each harness actually does, what YA already has, and the gap.

## Codex 0.154.0 (pinned `references/codex`)

- **Cache key follows the thread id.** `prompt_cache_key` is
  `responses_metadata.session_id` (`codex-rs/core/src/client.rs:504-514`),
  which for a root thread is the thread id
  (`codex-rs/core/src/session/session.rs:776-796`). A fork
  (`InitialHistory::Forked`) is explicitly given a fresh session id, so the
  child requests under a new key. The only override
  (`prompt_cache_key_override`) is internal to guardian review sessions; the
  app-server protocol exposes none.
- **Esc-Esc backtrack forks in every released Codex.** The TUI's backtrack
  "forks before the selected turn and restores its prompt in the new composer"
  (`codex-rs/tui/src/app_backtrack.rs:1-14`), through `fork_thread_at` with
  `before_turn_id` (`codex-rs/tui/src/app_server_session.rs:891-966`). The
  installed 0.155.0 is unchanged (`git show rust-v0.155.0:` of both files).
  So the released TUI's own rewind has exactly the fork cache exposure YA
  has. Unreleased `main` (commit `7498521`, 2026-09-18) switches backtrack to
  `thread/revert` in place: `app_backtrack.rs` reads "Revert the current
  thread before the selected prompt", `event_dispatch.rs` calls
  `revert_thread`, and `thread-store/src/local/thread_rollout_resolver.rs`
  states "`thread/revert` keeps the thread ID stable while switching the
  thread to a new rollout file". That is the direction to follow, and a
  future Codex release will ship it as the TUI default.
- **The in-place primitives exist, and the TUI does not use them for
  backtrack.** `thread/rollback {threadId, numTurns}` drops the last N turns
  of a legacy-history thread and rejects paginated threads
  (`codex-rs/app-server/src/request_processors/thread_processor.rs:2311-2333`).
  `thread/revert {threadId, beforeTurnId}` replaces a paginated thread's
  durable history with the prefix before one turn, shuts the runtime down, and
  rebuilds it from the truncated history (`thread_processor.rs:2085-2175`).
  Neither changes the thread id, so `prompt_cache_key` is unchanged; neither
  reverts local file changes. YA never passes `historyMode` to
  `thread/start`, and Codex defaults a persisted thread to paginated when the
  store supports it (`thread_processor.rs:1434-1437`), so `thread/revert` is
  the primitive for YA-started threads and `thread/rollback` for older legacy
  rollouts.
- **Codex 0.156.1 removed `thread/rollback`.** YA used to call it only on a
  fresh fork child, which paginated children already refused
  ([tactical 121](../docs/tactical/121-codex-reference-backed-fork-history.md)).
  Every YA fork now bounds the copy with `thread/fork.lastTurnId` instead
  ([provider fork support](../topics/provider-fork-support.md#codex)), so
  `thread/revert` is the only in-place primitive left. The live per-session
  `CodexAppServerClient` can send it to the running thread today.

## Claude (Agent SDK 0.3.273, CLI 2.1.276)

- **The SDK's truncating resume keeps the session id.** `resume` plus
  `resumeSessionAt` resumes "up to and including" a chain UUID; the optional
  `resumeDropsTurn` makes the CLI refuse when the discarded tail contains
  anything other than the named turn (`claude-agent-sdk/sdk.d.ts:1951-2000`).
  The pair is honored only on the headless lane, which is the lane YA uses.
  YA already sends it: the resume guard picks the last good assistant UUID
  before an API-error tail and resumes there instead of forcing a handoff
  (`packages/server/src/routes/session-claude-resume-guard.ts`,
  `routes/sessions.ts:4469-4510`, `supervisor/Supervisor.ts:2580`). The
  primitive is wired end to end; only the trigger is limited to that blocker.
- **Interactive `/rewind` "Restore conversation" stays in the session.** The
  checkpointing docs describe it as rewinding to a message while keeping the
  code, and the sessions docs call it "checkpoint-based rewind within a single
  session", in contrast to `/branch` and `--fork-session`, which "get their
  own session IDs". The Claude Code changelog refers to "rewound timelines"
  inside one source session, so a rewind is a parent-pointer branch in the
  same transcript, which is what `buildDag`'s active branch already renders.
  YA cannot invoke the interactive menu; the SDK truncating resume above is
  the same operation on the headless lane.
- **Measured 2026-09-18: a Claude fork within the cache window is a cache
  hit.** Forking a Claude session within 5 minutes of its last use and firing
  a new turn always hit the parent's prompt cache (user measurement). A later
  observation the same day saw a fork hit the cache 16 minutes after last
  use, past the 5-minute default TTL, which weakens the suspicion that the
  1-hour cache TTL YA requests for Claude is not taking effect; more
  observations are needed before treating the 1-hour window as confirmed. This
  matches the Anthropic docs, which name only exact prefix match and
  organization/workspace isolation as cache determinants with no per-session
  key, and the Claude Code changelog entries where `/fork` keeps "the original
  conversation's prompt cache in the new background session" and a
  `subagent_type: "fork"` subagent "inherits the full conversation and prompt
  cache". YA's Claude fork keeps the prefix byte-identical. So on Claude the
  Codex fork-miss measurement in the Quick Answer gap does not transfer, and
  in-place rewind is a UX and history question, not a cache-cost one. The
  sticky-routing writeups found were about proxies (LiteLLM), not Anthropic.

## The gap

Neither provider adapter offers a `rewindSession` operation, and the session
control surface (`routes/sessions.ts` fork endpoints, `Supervisor`) has no
verb for "drop the tail of this live session and keep its id". The pieces are
present and already partly exercised:

| Provider | In-place primitive | YA status |
|---|---|---|
| Codex paginated thread | `thread/revert {threadId, beforeTurnId}` | in the pinned 0.154.0 schema, absent from YA's generated protocol types; needs a protocol refresh |
| Codex legacy thread | `thread/rollback {threadId, numTurns}` | removed in Codex 0.156.1; YA no longer calls it |
| Claude | `resume` + `resumeSessionAt` (+ `resumeDropsTurn`) | used only for API-error tail recovery |

An in-place rewind is the right shape for "try that turn again" and for the
recap/aside flows that fork only because they need a parent prefix; it is not
a replacement for fork when the parent must keep running. The kept prefix is
the same bytes under the same id, which is the strongest cache-reuse position
either provider offers a client. On Codex that is an argument from key
identity, not a measurement, and the first implementation must measure
first-request cached tokens on warm parents exactly as the Quick Answer gap
requires. On Claude the fork measurement above already shows the cache is
kept either way; the rewind is wanted there for same-session history, not
cost.

## Planned: rewind + new turn in the same session (Claude first)

The binding contract is now [topics/session-rewind.md](../topics/session-rewind.md);
this section is the design history that fed it. Build and enable this for
the Claude provider, where the truncating resume is already wired end to
end. Codex follows once `thread/revert` is in the generated protocol.

**Turn menu.** The existing per-turn fork menu
(`packages/client/src/components/blocks/UserPromptBlock.tsx`, the
`onForkBefore` / `onForkAfter` / `onForkAfterSummary` handlers, labels
`forkBeforeTurnLabel` etc. in `packages/client/src/i18n/en.json`) gains two
same-session entries:

- **Clear after this turn** — keep this turn and its response; drop
  everything later. Same cut point as fork-after.
- **Clear replacing this turn** — drop this turn and everything later, and
  put this turn's prompt text back in the composer (the Codex Esc-Esc
  shape). Same cut point as fork-before.

Turn numbering: N is the turn index, a stable identifier for a user turn in
the session. The tooltip for the existing entry becomes
`Fork from this turn [N]`, where N is the same index a user passes on the
command line below, so the menu teaches the command. Stability is the point:
a rewind only removes turns after N, so N still names the same turn after
every `/clear N`, which is what lets `/clearloop` repeat `/clear N` without
recomputing anything.

**Commands.** These are YA-routed emulated commands per
[emulated-slash-commands](../topics/emulated-slash-commands.md) and are
intercepted before provider ingress:

- `/clear N` — rewind so that turn N is the last kept turn ("clear after
  N"). `/clear` with no argument is `/clear 0`: drop every turn, keep the
  session id. This intercepts the provider's native `/clear` on Claude; the
  native command would start a fresh context under the same CLI session,
  which is the same user-visible result without YA's grouped history below.
- `/fork N` — new command, identical to the menu's fork-after at turn N.
- N counts real user turns in the active branch as the menu displays them,
  never provider message uuids.

**Server verb.** Add a `rewindSession` operation beside the fork endpoints in
`routes/sessions.ts` and `Supervisor`. On Claude it is the existing
`resume` + `resumeSessionAt` restart
(`routes/session-claude-resume-guard.ts`, `routes/sessions.ts:4469-4510`,
`Supervisor.ts:2580`) with the cut chosen by the user instead of the
API-error blocker, and `resumeDropsTurn` passed so a queued message or task
notification in the discarded tail refuses rather than vanishing. The rewind
must run between turns; a request during an in-flight turn waits for or
requires a stop, as the Codex constraint above already says.

**Durable history: rewound turns stay visible, grouped and collapsed.** YA's
durable session view must not lose the rewound turns. On every rewind, the
discarded tail becomes one grouped outline entry at the cut point, collapsed
by default, labelled with the cut (`cleared after turn N`, timestamp, turn
count). Claude's transcript already branches by `parentUuid`, and `buildDag`
already renders the active branch; the inactive branch is what the group
shows. Reusing the nested subagent presentation is allowed: the
`isSubagent` / `subagent-item` handling in
`packages/client/src/components/RenderItemComponent.tsx` gives the main
session view a collapsible nested group, and the sidebar's nested-session
rendering can show the same group. The main-session group is required; the
sidebar part is optional.

**`/clearloop N M: [prompt]`.** M times: `/clear N`, then send `[prompt]`.
One iteration is a full assistant turn, including any blocking question and
its reply: the loop waits while the session is `waiting-input` and treats
the user's answer as part of the iteration, not as a manual turn. Then it
rewinds and sends again.

- Iteration boundary, two candidate variants. **Strict turn:** one
  iteration is one full assistant turn plus any blocking question and its
  reply, which requires YA to classify a user send as a question answer
  versus a manual turn. **Inactivity:** one iteration ends after a
  settings-defaulted inactivity window (for example 1 minute) with no user
  send and no assistant progress, which needs no answer/turn classification
  and also covers a session that stalls without a question. v1 will hard
  pick one; both may be useful later, so keep the boundary policy a single
  seam.
- Stop conditions: the stop button, or any manual user turn other than a
  question answer (strict-turn variant), ends the loop. The clearloop
  indication itself is also explicitly cancelable with the usual x / cancel
  control on the queued entry: that cancel stops the loop without
  hard-stopping the in-flight assistant work and without entering a new
  turn, so the current iteration runs to completion and simply is not
  followed by another rewind. Every stop path, including cancel, leaves the
  durable record: YA writes a notice into the session with the original
  `/clearloop N M: [prompt]` line, completed x times, interrupted with M-x
  remaining. The notice is session history, not a toast.
- Progress: while the loop runs, a badged queued-turn entry shows `m/M` and
  the prompt. Queued entries are server-owned per
  [queued-messages](../topics/queued-messages.md), so the loop's state lives
  on the server and the client only renders it; the topic already allows
  YA-local command chips to reuse that projection without entering a
  provider delivery queue. The badge persists across client reloads because
  the state is server-side.
- Each iteration's discarded output lands in the grouped history above, so
  the M attempts remain reviewable after the loop ends. This subsumes the
  `/rep N <prompt>` idea in the follow-on section below.

Constraints the implementation inherits:

- Codex `thread/revert` restarts the thread runtime, so it is a
  between-turns operation on an idle thread; YA must hold the turn and replay
  the resulting thread state to clients. Neither Codex primitive reverts
  files, and Claude's conversation-only truncation does not either; a
  code-restoring rewind is the separate file-checkpoint story
  ([fork with worktree checkpoint](sketches/fork-with-worktree-checkpoint.md)).
- Claude's truncation is a resume, so it applies when the process is
  restarted; YA's activation path already restarts on resume, and
  `resumeDropsTurn` should be passed so an absorbed queued message or task
  notification in the discarded tail refuses rather than silently vanishes.
- The transcript readers must show the rewound state: Claude branches by
  `parentUuid`, which `buildDag` already resolves to an active branch; Codex
  `thread/revert` rewrites durable history, which the reader re-reads.

## Prior art for repeating a prompt from the same parent

`/clearloop N M: [prompt]` above is M sends of the same prompt from the same
parent state, equivalent to prompt, rewind, prompt, rewind, ... (M-1 rewinds),
with every attempt starting from an identical warm prefix under one session
id. It composes directly from the rewind verb plus the grouped history as
the cursor over attempts; nothing beyond that is needed on the provider side.

No harness or wrapper ships it (web survey 2026-09-18). Closest matches, each
single-shot and interactive: Claude Code `/branch`, `--fork-session`, and SDK
`forkSession`; Codex `/fork` and Esc-Esc; opencode `/undo`, `/redo`, and
fork. `agentoptics/rewind` replays a recorded agent run from a step for
debugging, not sampling, and targets OpenAI Agents SDK, Pydantic AI,
LangGraph, and CrewAI rather than Claude Code or Codex. The gwpl Claude Code
branching gist issues three `claude --resume --fork-session -p` calls off one
parent, but with different prompts as an isolation test. Parallel-worktree
runners such as vibe-kanban and ralph-harness start fresh sessions per
attempt with no shared prefix. On Claude, N parallel `forkSession` calls are
the simpler route and, per the changelog fork entries above, plausibly still
hit the parent's cache; on Codex the rewind verb is required.

Found 2026-09-18 while researching whether harness-native rewind avoids the
fork cache misses recorded in the Quick Answer gap. Extended 2026-09-18 with
the Claude fork cache measurements and the same-session rewind, `/clear N`,
`/fork N`, grouped rewound history, and `/clearloop` design.
Contributing-model: fable-5.1
