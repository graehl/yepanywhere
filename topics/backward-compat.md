# Backward compatibility decisions

Durable decisions for observable or persisted surfaces whose compatibility
handling is not obvious from the implementation alone.

Topic: backward-compat

## Decisions

2026-06-23 `session-metadata.json` — add optional transcript display objects in
schema version 2 while retaining all version-1 session metadata; the additive
migration preserves existing configured state, and interrupted generating
objects recover as errors because their in-memory jobs cannot survive restart.
