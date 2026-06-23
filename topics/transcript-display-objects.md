# Persisted transcript display objects (pseudo-turns)

Topic: transcript-display-objects

Status: first kind implemented. Fork-after-summary progress/follow state is a
server-persisted display object placed in the source transcript. The schema is
deliberately a tagged union so later comments/status chips can share the
placement mechanism without entering provider context.

See also:
[fork-from-turn](fork-from-turn.md) (the motivating instance — the
"Forking…/Forked link" object),
[synthetic-turn-injection](synthetic-turn-injection.md) (the deliberate contrast
— that is about putting turns *into* model context; these are explicitly *not*
in context),
[scrollback-view-stability](scrollback-view-stability.md) (the transcript window
/ placement-anchoring concerns these inherit).

## What they are (and are not)

A **transcript display object** is a saved display-only item with a **placement**
in a session's transcript — a comment, a status chip, a follow link. Crucially:

- **Not a turn.** Nothing here enters the provider/model context. It is never
  sent to the model, never replayed on resume, never counted in tokens. Calling
  them "synthetic turns" is shorthand; they are *saved display objects/comments
  with a placement*, not conversation turns.
- **Distinct from [synthetic-turn-injection](synthetic-turn-injection.md).** That
  topic is the opposite operation — materializing items the model *does* treat
  as context. These never touch context; the only thing they share is "not a
  real provider-generated turn."
- **Placed, not pinned.** The object is anchored at a transcript position
  (placed at the end as of when it was created) and **scrolls with content**. It
  is not a permanent float; if the session sees continued use it scrolls off,
  which is desirable — a float that stayed forever would be annoying.

## Behavior (from the fork-after-summary instance)

The fork-send follow link is the first such object (see
[fork-from-turn](fork-from-turn.md)). Its lifecycle generalizes:

- Created and placed at-end at creation time.
- **Updates in place**: e.g. gains `(tab opened)` if auto-open is detected to
  have succeeded.
- **Click marks it `(clicked)`** (clicked in any way), but the object — and its
  link — **stay in any case**; clicking does not remove it.
- A transient companion **float** near the composer may give immediate
  attention, then **animate/fade out on a terminal event** (`(clicked)` or
  `(tab opened)`); the preferred end state is that it **transitions into the
  durable pseudo-turn** in the session outline rather than just vanishing.

## Persistence

The objects should survive **two** things, and that pair is the whole rationale
for the storage choice:

1. **Migrating the view to a new device** — open the same session on another
   client and the objects are still there, in place.
2. **A YA (server) restart** — they reappear in the same transcript position
   after the server bounces.

- **Implemented server-side.** Objects live in `session-metadata.json`,
  associated with the source YA session. Metadata REST responses and
  `session-metadata-changed` events carry the complete current object set, so
  clients converge across tabs and devices.
- Schema version 2 is additive over existing metadata. Version-1 files migrate
  in place. A persisted `generating` object cannot resume after a server
  restart, so initialization deterministically marks it `error` with an
  interrupted-by-restart message.

## Implemented schema and placement

- `kind: "fork-summary"` identifies the first object variant.
- `placementAfterMessageId` anchors the object after the source transcript tail
  observed when the job is accepted. Later turns render below it. A client with
  a compact scrollback window omits the object until that anchor is loaded.
- Immutable provenance records the selected source request and the completed
  turn boundary retained by the target fork.
- Mutable state records `generating | ready | error`, target session/title,
  per-job auto-open choice, and persisted `openedAt` / `clickedAt` timestamps.
- The stored target is a YA session id, not an origin-qualified URL. Each client
  constructs its own route using its deployment base path.

## Open design questions

- **Authorship scope.** System-generated objects are implemented. User-authored
  comments may share the mechanism, but need editing/deletion and authorization
  rules first.
- **Placement repair.** Message-id anchoring is stable for append-only
  transcripts. A future transcript rewrite that removes the anchor needs an
  explicit re-anchoring or orphan-display policy.
