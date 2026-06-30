# Sidebar Created Session Membership

## Problem

New YA-created sessions can appear in the sidebar briefly, then disappear until
a manual browser refresh or a later authoritative scan.

The important distinction is between two client facts:

- the session entity exists in the shared summary store;
- the sidebar global-sessions query membership contains that session id.

The `session-created` activity event gives the client enough data to create the
entity immediately and prepend it into matching global-session query results.
The `/sessions` REST response is authoritative for indexed transcript rows, but
it can lag newly created provider JSONL files. A later `replace` snapshot can
therefore omit the brand-new id and overwrite the sidebar query id list, even
though the entity is still present.

## Event Sources

YA-owned sessions are created by the in-process `Supervisor`. The optimistic
`session-created` event includes the YA-visible session id and is sent to every
connected activity subscriber.

The JSONL/external session tracker is a different path. For a session currently
owned by the supervisor it intentionally does not emit another
`session-created`; it emits `session-updated` when parsed title/count/model data
becomes available. For sessions created outside YA, the tracker can emit
`session-created` with `ownership: external`.

This means an open second browser tab should receive the same supervisor
`session-created` event. A tab that was closed or offline during creation relies
on `/sessions` and will not see the row until the indexer/reader catches up.

## Why Not Just Delay A Fetch?

A delayed refetch can be useful as reconciliation, but it is not a correctness
mechanism:

- client query caching can skip non-forced fetches while data is fresh;
- compatible consumers coalesce around shared query coverage;
- future query-controller changes may alter when an actual request is sent;
- even a real request can still race the provider's durable transcript write.

The sidebar should stay stable after receiving the create event even if no
immediate authoritative fetch happens.

## Chosen Client-Side Rule

For `global-sessions` replace snapshots, preserve existing query ids for
recently event-created records that still match the query shape. The TTL is
short and explicit: one minute.

Matching is intentionally conservative:

- project-filtered queries keep only records with the same project id;
- starred queries keep only records still known to be starred;
- default non-archived queries do not keep archived records;
- search queries do not do optimistic matching and should refetch instead.

An authoritative response that includes the session naturally keeps it in the
query and refreshes its fields. If the response continues to omit it past the
TTL, the optimistic membership expires and the sidebar converges on the server
list.

This is a no-backend change. It preserves the first-party-looking behavior users
expect after starting a session without changing server indexing, scanner, or
transport timing.

## Tests

Cover the reducer behavior directly:

- a newer `replace` snapshot that omits a just-created matching session keeps
  the id in the query;
- the same protection expires after the TTL;
- non-matching filters such as starred/search do not keep the row.
