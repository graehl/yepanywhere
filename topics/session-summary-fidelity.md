# Session Summary Fidelity

> Session list projections are bounded, partial facts. They may enrich list
> surfaces and normalized client records, but they must never masquerade as a
> complete transcript summary or advance the full-summary cache's freshness.

Topic: session-summary-fidelity

See also:

- [`client-global-store.md`](client-global-store.md)
- [`inbox.md`](inbox.md)
- [`session-index-validation.md`](session-index-validation.md)
- [`codex-metadata-scanner.md`](codex-metadata-scanner.md)

## Summary classes

`SessionSummary` is the complete server summary contract for one transcript
version. Required fields such as `messageCount` describe the whole transcript;
tail-derived fields such as context usage, current model, and recent agent text
are present when the provider can derive them.

`SessionListSummary` is a bounded projection for collection routes that need
only identity, title, and recency:

- `id`;
- `projectId`;
- `title`;
- `updatedAt`.

Unknown full-summary values are absent from the list type. A list reader must
not manufacture placeholder counts or expose an early model as though it were
the current model. Providers may obtain the projection from native metadata, a
bounded transcript-head read, or a complete summary that is already known
fresh.

## Reader and index contract

A provider that implements a lightweight list-summary reader must bound its
work independently of transcript tail size. Reading enough head data to find
stable metadata and the first user title is allowed; scanning to EOF merely to
populate fields outside `SessionListSummary` is not.

The persisted session-summary index remains a complete-summary cache:

- a fresh complete row may be projected down to `SessionListSummary`;
- a dirty or stat-mismatched row may fall back to the lightweight reader;
- a lightweight result must not replace the complete row;
- a lightweight result must not update the row's indexed byte count, file
  mtime, or any equivalent "fully summarized through here" marker;
- serving a lightweight collection must not clear watcher dirty state needed
  by a later complete-summary consumer.

Providers without a lightweight reader retain their existing complete-summary
fallback. This preserves provider behavior while allowing providers with large
append-only transcripts to opt into bounded list work.

## Partial observation contract

REST collection projections and activity events are field patches when reduced
into the client summary store:

- an omitted field preserves an existing value;
- `undefined` means "not observed", not "clear this field";
- an explicit nullable value may clear only a field whose event or snapshot
  contract defines that meaning;
- a newer low-fidelity observation must not replace a known complete value with
  a placeholder or approximation;
- observing a newer `updatedAt` does not imply that message count, model,
  context usage, or recent-agent text were observed at the same fidelity.

Producers must therefore construct patches by selecting known fields. They must
not spread a list projection over a complete summary and must not copy values
from a compatibility-shaped head result into complete-summary event fields.

## Inbox behavior

Inbox needs title and transcript recency for filtering, tiering, sorting, and
unread checks. It does not require message count, model, context usage, or
recent-agent text.

For providers with a lightweight list reader, an Inbox refresh:

- reuses a complete indexed row only when that row is still fresh;
- otherwise reads the bounded list projection;
- does not wait for a full parse of a changed large transcript;
- does not alter what later complete-summary consumers receive.

Global Sessions, project session lists, process enrichment, session detail, and
other complete-summary consumers keep using the complete index path.

## Cleanup ledger

| Area | Current compatibility | Desired direction | Trigger |
| --- | --- | --- | --- |
| Head reads | Some callers request `readMode: "head"` while receiving the full `SessionSummary` TypeScript shape. | Move bounded consumers to a separately typed list-summary method, then retire compatibility-shaped head results. | Touching a head-mode caller or reader. |
| Activity events | `session-updated` is structurally partial, but producers can still forward approximate defined values. | Emit only fields observed at full fidelity; use dedicated discovery/list events where a full created row is unavailable. | Changing external-session tracking or event summary derivation. |
| Client freshness | Content fields currently share a coarse observation timestamp. | Split freshness by field or fidelity if independent producers begin updating overlapping content fields at materially different precision. | Evidence of a newer partial field blocking a valid richer update. |
