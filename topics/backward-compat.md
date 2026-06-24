# Backward compatibility decisions

Durable decisions for observable or persisted surfaces whose compatibility
handling is not obvious from the implementation alone.

Topic: backward-compat

## Decisions

2026-06-23 `session-metadata.json` — add optional transcript display objects in
schema version 2 while retaining all version-1 session metadata; the additive
migration preserves existing configured state, and interrupted generating
objects recover as errors because their in-memory jobs cannot survive restart.

2026-06-24 `PI_PATH` — rename the pi provider executable override to
`PI_EXECUTABLE` because the value is a full binary path, not a search directory;
keep `PI_PATH` as a startup-normalized legacy alias so existing launches still
resolve the same executable.
