# Provider-Agnostic /btw Asides

This topic covers YA-owned `/btw` side sessions: short side requests that
should run beside a parent session without being treated as active-turn
steering, patient queueing, or provider-native slash-command pass-through.

## Contracts

- `/btw` is a YA routing command. It starts or focuses an aside session when
  YA has an explicit capability path for the provider; unsupported providers
  should not silently receive `/btw` as ordinary prompt text.
- Parent and aside sessions are separate work streams. The parent agent should
  not see aside prompts or results unless the user explicitly injects them.
- Result injection is a separate user action. It may insert into the composer,
  steer an active parent turn, or queue into the parent only through the normal
  parent-session delivery controls.
- Focused aside mode changes composer routing, not parent ownership. Parent
  liveness, queue state, and ongoing output must remain visible enough that the
  user can tell which work stream is active.
- Aside capability is provider-specific but the product model is
  provider-neutral: provider-fork, storage clone, native subagent, or
  resume-with-summary paths must all satisfy the same parent/child contract.

## Invariants

- `/btw` must not be a synonym for `turn/steer`, deferred queue, or patient
  queue. Those are separate delivery intents.
- A child aside must persist a parent link, and parent views must be able to
  hydrate visible child-aside state after reload.
- UI affordances should show routing state before submission. If the composer
  is focused on an aside, the user should not have to infer that from a
  truncated title or hidden URL parameter.
- Completed or hidden asides remain findable in the parent timeline or aside
  list; they should not disappear solely because the child process ended.
- Provider-specific context cloning must be bounded and explicit. If a provider
  cannot fork cheaply, YA should expose that as a capability gap rather than
  replaying unbounded parent context by accident.

## Representative Change Types

- Adding provider capability flags or fork/clone orchestration.
- Changing `/btw` slash parsing, keyboard shortcuts, or composer routing.
- Changing aside parent/child persistence or hydration.
- Changing aside card/timeline rendering and focused-aside controls.
- Adding result insertion, steering, or queue-to-parent actions.

## Tests That Should Fail On Contract Regressions

- `/btw` on an unsupported provider does not silently enter the parent prompt.
- A focused aside routes composer sends to the child until explicitly exited.
- Parent-result injection requires an explicit user action.
- Reloading the parent session restores visible linked aside state.
- Patient queue and `/btw` launch paths remain distinct.
