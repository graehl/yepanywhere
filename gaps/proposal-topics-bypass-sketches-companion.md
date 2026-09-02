# Proposal-only topics bypass the sketches companion convention

`topics/new-session-agent-tooling.md`, `topics/agent-session-access.md`, and
`topics/yacron.md` identify themselves as unimplemented proposals or candidate
work, but remain ordinary topic docs. Routine topic reads therefore still mix
future design with current contracts after the new agent-command proposal was
correctly moved to `topics/agent-command-runtime.sketches.md`.

This was not folded into the blocker repair because the three established
documents have 31 incoming references and include positively reviewed product
direction alongside unresolved mechanics. A focused pass should separate any
approved current decision surface into concise main topics, move candidate
mechanics to `.sketches.md` companions, and sweep every citation without
discarding the yacron review record.

Found 2026-09-02 while fixing harsh-review candidate-design placement.
