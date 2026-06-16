# Session Reactivation (message-less resume)

> Reactivation is a planned server primitive that spawns a live harness process
> for an existing session id **without delivering a user turn**, flipping the
> session back to owned/`self` and idle so the client can read live process
> state (model options, config) before any message is sent.

Topic: session-reactivation

Status: **planned, not implemented** (2026-06-16). Blocked on coordination, not
design — see *Coordination* below.

Naming: the user-facing button label is **"Activate"** (from the client's point
of view a reaped session simply isn't active). The server primitive / this
topic is **reactivate**. Avoid "reattach" — there is no live process to attach
to; reactivation spawns a *fresh* harness process bound to the session id and
replays its history. "Revive" is an acceptable synonym. Candidate glossary row.
<!-- unconfirmed: 2026-06-16 -->

## Motivation

A YA-launched session whose harness process was reaped reports as not-owned
(ownership is purely "is there a live process right now":
`getProcessForSession` → `self`, else `external`/`none`,
`routes/sessions.ts:1965-1980`). On such a session the model panel can only
show **"No active process"**, because the full model options come from
`getProcessModels(processId)` — a *process*-level call (`client.ts:865`); there
is no provider-level model list. So today the only way to make a reaped session
configurable again is to **send a turn**, which is the wrong gesture when the
user just wants to change the model.

We want a button that brings the process live with no turn, then reveals the
full options once the process exists. The UI it plugs into is the unified model
panel in `ModelSwitchModal` (Model/Info tabs).

## The gap (current state)

- **Resume mandates a message.** `POST …/resume` rejects an empty body with
  `"Message is required"` (`routes/sessions.ts:2890`), and every `Supervisor`
  start path takes a `UserMessage` (`Supervisor.ts:581,659,1185,…`). There is no
  message-less spawn.
- **But idle live processes already exist.** YA is server-owned: a process stays
  alive and idle *between* turns. So the only missing capability is the
  **initial** spawn without a turn — the process would then sit in the same idle
  state it occupies after any completed turn.
- **No provider-level model list**, so a live process is genuinely required to
  populate the picker; this can't be sidestepped purely client-side.

## The plan

### Server primitive

Expose a message-less reactivate. Two shapes considered; pick at implementation:

- **`POST …/reactivate`** (new route), or
- **`warmOnly: true` flag on the existing resume route** that skips the
  `UserMessage` requirement and the turn delivery.

Behavior:

1. Start the harness process for the session id (provider resolved as resume
   does: metadata provider → reader), load history, **deliver no user turn**.
2. Leave it in the post-turn **idle** state; subject it to the **same reaping /
   idle-lifecycle** as any other idle owned process (don't leak an immortal
   idle process).
3. Return `{ processId }`; ownership for the session becomes
   `{ owner: "self", processId }`.

Server files this touches: `supervisor/Process.ts`, `supervisor/types.ts`, and a
route in `routes/sessions.ts` or `routes/processes.ts`.

### Client integration (the planned UI half)

In `ModelSwitchModal`, the `!processId` Model-tab branch becomes an **Activate**
button (replacing the static "No active process" note) with an in-flight
"Activating…" state; the modal stays open. `SessionPage` supplies an
`onActivate` that calls the reactivate endpoint and, on success, flips
`status` to `{ owner: "self", processId }`.

No extra client reveal logic is needed: `ModelSwitchModal`'s existing
`processId`-keyed `useEffect` fires when `processId` appears, fetches models, and
the full options replace the spinner. (Minor: set `loading = true` at the start
of that fetch so the transition shows a spinner rather than a flash.)

## Cost surfacing

[[provider-context-economics]] requires that **no session action hide a
full-replay price**. Clarify before shipping: a message-less reactivate spawns
the process but likely incurs **no provider billing until the first real turn**
(stateless providers replay+bill per turn; idling the process invokes no model).
If that holds, reactivation's marginal cost over "just send your next message"
is ~zero on the provider side (local process resources only). Confirm this
against the provider's resume/load path; if reactivation itself triggers any
billed provider call, the button must surface it per the economics rule.

## Open questions

- Endpoint shape: new `reactivate` route vs `warmOnly` flag on resume.
- Should reactivate optionally **apply pending config** (the model the user just
  picked) at spawn, or strictly spawn-then-configure via the normal model-switch
  path?
- Idle-process lifecycle: reaping timer parity with post-turn idle processes;
  what happens if the user reactivates then walks away.
- Sibling concern (task029): requested-model persistence may let a model choice
  take effect on the *next* natural turn without reactivating at all —
  reactivation is for users who want the process live *now*. Keep both; they
  serve different intents.

## Coordination

The server half lands in `supervisor/Process.ts` + `supervisor/types.ts` (both
in task029's **dirty** tree) and a route in task029's scope. Sequencing: do the
server primitive **after** task029's supervisor restructure lands (or have
task029 add it, since they're already in that lifecycle code), to avoid editing
`Process.ts` underneath them. The client half (`ModelSwitchModal`,
`SessionPage`) has no overlap and can be built against the agreed endpoint
contract once we commit to building. Decision per 2026-06-16: **wait** until the
need is confirmed.

## See also

- [[session-context-actions]] — the recovery/fork/handoff action family
  reactivation belongs to.
- [[session-ownership]] — why a reaped session reports not-owned; reactivation
  flips it back to `self`.
- [[provider-context-economics]] — the full-replay-price disclosure rule.
- [[resume-compaction]] — compact-before-resume; reactivation should respect the
  same resume-mode considerations.
