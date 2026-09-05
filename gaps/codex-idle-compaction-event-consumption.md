# Codex idle manual compaction needs an event-consumption regression

Code-path review found that Codex `runProviderCommand("compact")` sends
`thread/compact/start` out of band and returns after acceptance, while the
idle `runSession` generator is waiting on its user-message queue.
`consumeTurn` owns notification consumption and is normally entered after a
queued message starts a turn. The manual command does not connect its native
turn to that consumer, so compaction progress/completion may remain buffered
until another user message arrives.

Both paths are in `packages/server/src/sdk/providers/codex.ts`. Add a
subprocess regression that finishes an ordinary turn, requests compaction
while idle, and requires compact status, boundary, and completion without
another user message. Then connect native command turns to the existing
consumer without adding an idle poll or sending `/compact` as model text.

The goal-continuation fix now observes `turn/started` while idle and connects
provider-started turns to the event consumer. The compaction-specific status,
boundary, and completion sequence still needs the regression described above
before this gap can be closed; it has not been exercised by the goal tests.

This remains a static finding, not a reproduced live failure. The reported
foreground-wait rejection was instead the intentional active-turn guard;
that work surfaces the rejection reason and warns before submission.

Found 2026-09-04 while investigating manual compaction during a tool wait.
