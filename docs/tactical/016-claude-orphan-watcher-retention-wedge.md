# Claude orphaned background-watcher pins session in "thinking" forever

**Date:** 2026-07-08
**Provider:** Claude (Claude Agent SDK)
**Model:** `claude-opus-4-8`
**Related work:** [`docs/tactical/015-claude-background-task-idle-reap.md`](015-claude-background-task-idle-reap.md)
**Relevant code:** `packages/server/src/sdk/providers/claude-retention.ts`
(`ClaudeProviderRetentionTracker`)

## Symptom

A Claude session appeared permanently "stuck thinking" — the client showed a
`Conjuring…` / pulsing indicator that never resolved. Session Info reported:

- Activity: `Waiting on provider`
- Liveness: `Verified Waiting Provider`
- Provider retention: `bg=2 crons=0 tasks=2; stop-hook-background-tasks:2, sdk-live-tasks:2`
- Last wake: `User Message (~51m ago)`

The model was **not** actually running. Server-side process state history showed
the foreground turn had ended cleanly ~an hour earlier:

| Event | State |
|---|---|
| in-turn (turn started) | `in-turn` |
| turn ended, `state-change` emitted | `idle` |

No `in-turn` transition occurred after the idle edge. The last transcript entry
was an assistant `text` block written at the idle timestamp. The session was
idle but **retained** — held open entirely by two background tasks that never
settled.

## The tasks involved (corrected)

There were two *roles*, and it is important not to conflate them:

- **Watched tasks** — `brgjloujy` ("Run biome-guided mushroom scan") and
  `b9yss4f14` ("Re-render seed 0"). These were short `local_bash` tasks that ran,
  **failed**, and fired terminal `task_notification: completed` within ~1–3s.
  The tracker cleared them correctly. They are *not* what retained the session.
- **Retained watchers** — `b90xh2vn6` ("Wait for first mushroom hit") and
  `bxusbln1j` ("Wait for re-render"). These were the backgrounded `until`-loops
  that polled the watched tasks' `.output` files. They are the two tasks that
  pinned the session (`sdk-live-tasks:2` / `stop-hook-background-tasks:2`).

Damning detail: each watcher was **born orphaned**. `brgjloujy` went terminal at
~10:59:17; its watcher `b90xh2vn6` started at 10:59:24 — **7 seconds after its
target had already completed**. Same for the other pair. At the instant each
watcher registered, the sentinel it waited for was already unreachable.

## Outcome — resolved manually, not automatically

The wedge was **not** fixed by any server-side reaper or timeout. At 11:34:39 the
agent itself — driven by a human asking it to investigate — ran
`TaskStop b90xh2vn6` and `TaskStop bxusbln1j`, which emitted
`task_updated: killed` + `task_notification: stopped` and cleared retention. The
orphaned OS processes then exited.

Two consequences for the analysis:

- **The retention tracker had no bug.** Every one of the 20 tasks reached a
  terminal notification; the two watchers only settled *because* the agent
  `TaskStop`-ped them. Until that manual action the tracker was faithfully
  reporting two genuinely-alive background processes.
- **The idle reaper would never have saved it.** Per 015, provider-retention
  exists precisely to stop idle-reaping sessions with live background work, so
  `bg=2` pinned the session as not-reap-eligible *indefinitely*. Without the
  manual `TaskStop`, it does not time out — it spins until process/machine
  restart. The self-heal only happened because a human noticed; the agent had
  already crossed the turn boundary and gone idle leaving the orphans running.

## Root cause

This is *not* a wedge in model inference, and it is *not* the
`prompt_suggestion` false-wake described in 015. The retention tracker behaved
exactly as designed — it just never received a terminal signal, because the
background tasks themselves can never complete.

Two contributing layers:

### 1. Model authored unbounded watcher loops (agent-behavior)

The two retained background tasks were `Bash run_in_background` "wait-until-
condition" polling loops the agent launched, of the shape:

```sh
until grep -qE "HIT|SCAN COMPLETE" <task>.output; do sleep 4; done
```

```sh
until [ -f <screenshot>.png ] && grep -q "saved to" <task>.output; do sleep 4; done
```

Both loops only terminate on **success**. The commands they were monitoring did
finish — but they finished by *failing* (one ended in `test result: FAILED`, the
other in a `Cargo.toml does not exist` error) and therefore never printed the
sentinel strings (`HIT` / `SCAN COMPLETE` / `saved to`) the loops poll for. With
no exit-on-failure and no timeout, each loop `sleep 4`s forever at ~0% CPU. The
loop's own logic guaranteed an orphan the moment the monitored command took the
failure path.

### 2. Retention tracker has no liveness check (harness)

`ClaudeProviderRetentionTracker` is entirely message-driven: it counts
`background_tasks` from the Stop hook and `task_started`/`task_progress`
lifecycle messages, and only clears a task on a terminal `task_notification`
(`completed`/`failed`/`stopped`) or terminal `task_updated.patch.status`. An
orphaned `until`-loop emits **none** of those terminal signals until something
external stops it, so `stopBackgroundTaskCount` stays pinned at 2 and the session
is retained indefinitely. Note this is not a *bug* in the tracker — it correctly
reflected two genuinely-running processes; it simply has no way to tell a
wedged-forever watcher from a productively-waiting one, so both render identically
as `verified-waiting-provider` (the pulsing "thinking" indicator). And because
provider-retention deliberately blocks idle-reap (015), there is no timeout
backstop either: the only closeout is an explicit `TaskStop` — which, in this
incident, only a human-driven agent turn supplied.

## Why this is fixable server-side (join key exists)

The server already has everything needed to bridge an SDK task to a real OS
process:

- The SDK background **task_id == the on-disk `.output` filename**, and that same
  id/path appears verbatim in the watcher process's command line.
- The task working directory is deterministic:
  `…/claude-<uid>/<project-slug>/<sessionId>/tasks/`. The server already knows
  `<sessionId>` and the project slug.

So a `ps`/argv scan (or a walk of the SDK child process tree) can resolve each
retained task_id to a live PID with no new SDK surface.

## Primary detector: SDK task-correlation (no `ps`/CPU heuristics)

Before reaching for OS introspection, note that the tracker can classify these
orphans deterministically from data it *already holds*. A watcher's argv contains
`tasks/<watched-id>.output`, and the tracker already received that watched task's
terminal `task_notification` (`completed`/`failed`) — in this incident both
watched tasks (`brgjloujy`, `b9yss4f14`) fired terminal notifications that were
processed, while the two watchers referencing their `.output` files stayed pinned.

So the core rule is:

> for each retained background task, parse its argv for `tasks/<id>.output`; if
> that `<id>` has already reached a terminal state, the referencing task is
> orphaned.

This needs no `ps`, CPU sampling, or mtime window, and (confirmed against this
incident) would have fired almost immediately, since each watcher's target was
already terminal ~6–7s after the watcher started — no 50-minute wait required.
The conjunctive pure-sleep / stale-mtime / dead-PID heuristics below drop to a
**fallback** for watchers that poll *non-harness* state (an external file, a
foreign PID) where there is no SDK task to correlate.

Two caveats, though — the correlation detector is a strong *primary trigger* but
does not stand entirely alone:

- **The tracker does not currently hold the watcher's argv.** `task_started`
  carries only `description` + `tool_use_id`, not the command string. To extract
  `tasks/<id>.output` you must join `task_started.tool_use_id` → the assistant's
  `Bash` tool_use block → `input.command`. `ClaudeProviderRetentionTracker`
  discards `tool_use_id` today and never sees tool_use blocks, so this is new
  plumbing (capture the command per task), not literally free data.
- **Target-terminal alone can false-positive on "wait-then-act".** A loop of the
  form `until [target done]; do sleep; done; <do real work>` becomes *productive*
  exactly when its watched target goes terminal. So "watched task terminal" ≠
  "orphan" by itself. Keep a **minimal** liveness second-gate — "is the watcher
  still sitting in the sleep loop some seconds after the target settled?" — which
  is far cheaper than a CPU-sampling window but is not zero. This is the one part
  of the heuristic set that should stay a required gate, not a fallback.

Two riders:

- **Correcting detection is not enough — flip the rendered activity state.** The
  wedge disguises itself as the model thinking (`Conjuring…`, and see the
  `verified-waiting-provider` symptom above), so a passive Session-Info annotation
  won't be seen. Detection must move liveness out of `verified-waiting-provider`
  into e.g. `idle — retained by likely-orphaned background work`.
- **Prevent at authoring time.** The server sees the `Bash run_in_background`
  command string when it is issued; a cheap lint for a backgrounded
  `until …; do sleep …; done` with no timeout / no exit-on-failure can warn or
  annotate immediately, rather than reaping ~50m later.

## Proposed direction

A `BackgroundTaskReaper` companion that ticks only when a session is
`idle && retained` (cheap gate; skips healthy sessions), resolves each retained
task's PID, and classifies it. Suggested signals (conjunctive, to avoid killing
legitimately patient watchers):

- **pure-sleep**: ~0 CPU delta across a short sampling window + a live `sleep`
  child;
- **harness-monitor signature**: argv matches the `until …; do sleep …; done`
  + reads-a-`.output` scaffold;
- **no progress**: the monitored `.output` file mtime is stale for N minutes;
- **target dead**: the process/command the loop was watching has already exited
  (strongest signal).

Default to **surfacing, not killing** — replace the bare
`stop-hook-background-tasks:2` in Session Info with e.g. "2 background tasks —
no progress for 50m, likely orphaned" plus a manual **Reap** action. Optional
auto-reap only behind a generous hard cap (idle + stale + target-dead for well
over the normal build/test window). A healthy watcher — output still growing or
target still alive — must be left untouched, consistent with the 015 guardrail
that genuine provider-owned background work is not reaped.

## Guardrails (carried from 015)

- Do not kill a watcher whose monitored `.output` is still growing or whose
  target process is still alive.
- Do not treat a stale count alone as proof of orphaning; require the
  conjunctive idle + stale/dead-target evidence.
- Cross-platform PID walking: macOS `ps` vs Linux `/proc`; on Windows a captured
  spawn PID may be a shell wrapper (see 015).

## Open questions

- Should orphan classification live in `ClaudeProviderRetentionTracker` or a
  separate reaper that annotates the retention snapshot?
- Is there an SDK-native signal (or a Stop-hook enrichment) that would let the
  loop self-report a dead target, avoiding OS introspection entirely?
- Should the belt-and-suspenders model-side fix (watchers that also exit when
  the monitored PID dies or after a timeout) be encouraged via prompt guidance,
  given the harness cannot rely on it?
