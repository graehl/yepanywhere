# Session Media Handles

> Inline base64 media in transcript messages should become server-owned media
> handles before it enters retained session-detail state. The public handle is
> stable and opaque; row, line, byte offset, and JSON pointer locations are
> internal lookup details.

Topic: session-media-handles

Status: Problem statement / latent proposal. This is not scheduled work. Use
this document before changing provider message normalization, session detail
REST payloads, transcript media renderers, `Read` image result rendering, public
share transcript capture, or the session-detail data-layer ingest boundary.

## Problem

Provider transcripts legitimately store binary media as JSON strings. Codex
uses `data:image/...;base64,...` URLs in session JSONL; Claude-style messages
can carry `{ type: "image", source: { type: "base64", data } }`; structured
`Read` image results can carry `file.base64`. That is a provider interchange
format, not a good retained UI state format.

When inline base64 crosses into YA's session detail API and browser state:

- the REST response pays full image size even if the user never expands the
  image;
- relay users receive that payload over the encrypted request channel as part
  of the JSON body instead of fetching bytes only when needed;
- the client retains UTF-16 base64 strings in transcript caches, which is much
  heavier than retaining a `Blob` URL while visible;
- render behavior differs across providers because Codex durable input images
  are already partially stripped while Claude image blocks and some `Read`
  results still ride through;
- auto-expanded inline image previews can shift old transcript rows unless the
  server supplies enough metadata to reserve layout.

This is a performance feature with security implications. A media URL is not
authorization by itself. Any fetched media must use the same authenticated
session access check as the transcript, work through direct and relay
transports, avoid client-supplied filesystem paths, and serve untrusted bytes
with safe content headers.

## Current Evidence

Measured locally on 2026-07-04:

| Provider / session | JSONL size | Image bytes in JSONL | Live full API response |
| --- | ---: | ---: | ---: |
| Codex `webvam / 019d2bd5-...` | 173.3 MB | 164.9 MB, 95.2% | 14.20 MB |
| Codex `webvam / 019d2fd3-...` | 125.2 MB | 119.8 MB, 95.7% | 5.63 MB |
| Codex `playbox / 019e3998-...` | 86.8 MB | 77.4 MB, 89.1% | 14.67 MB |
| Claude `jstorrent / 06a8e997-...` | 61.6 MB | 0 MB | 61.76 MB |
| Claude `jstorrent / fe23a2d9-...` | 20.6 MB | 17.3 MB, 84.2% | 22.96 MB |
| Claude `webvam / ebcf36f3-...` | 19.6 MB | 7.2 MB, 36.8% | 21.87 MB |

The Codex rows show the local JSONL problem clearly: large files are often
image-dominated, including repeated `payload.content.0.image_url`,
`payload.images.0`, `payload.replacement_history...image_url`, and generated
image `payload.output.0.image_url` strings. YA's current Codex durable
normalization already strips the image URL from the session API for many input
image cases, so the live API payload is much smaller than the JSONL.

The Claude rows show the remaining API problem. The largest sampled Claude
JSONL was not image-driven; it was a huge `toolUseResult.stdout`. But the next
large Claude image sessions still returned inline base64 in the live API body
(`"base64"` keys were present in the response).

## Target Shape

Session detail responses should contain metadata and handles, not bytes:

```ts
interface TranscriptMediaRef {
  id: string;
  url: string;
  mimeType: string;
  byteLength: number;
  width?: number;
  height?: number;
  filename?: string;
  source: "transcript";
}

interface InputImageBlock {
  type: "input_image";
  file_path?: string;
  media?: TranscriptMediaRef;
}
```

The exact block names can follow existing provider-specific shapes, but the
principle should hold: the transcript row has enough metadata to render the
same collapsed chip, reserve expanded layout, and fetch bytes lazily. It does
not keep base64 payload text.

The fetch route should be an authenticated API path, for example:

```text
GET /api/projects/:projectId/sessions/:sessionId/media/:mediaId
```

The client should fetch through the existing connection abstraction:

- direct mode: credentialed HTTP fetch;
- relay mode: `connection.fetchBlob(path)`, then `URL.createObjectURL(blob)`.

Do not render a bare `/api/...` URL directly in an `<img>`; relay-origin pages
do not have the local server's API.

## Media ID And Lookup Model

The public `mediaId` should be opaque. It may be deterministic, but clients
must not parse it. A reasonable internal seed is:

```text
sha256(provider + sessionId + messageId + blockPath + contentHash)
```

The server maintains a media catalog entry:

```ts
interface SessionMediaCatalogEntry {
  mediaId: string;
  provider: string;
  sessionId: string;
  messageId: string;
  blockPath: string;
  mimeType: string;
  byteLength: number;
  width?: number;
  height?: number;
  contentHash: string;
  locator: TranscriptMediaLocator;
}

type TranscriptMediaLocator =
  | {
      kind: "jsonl-line";
      path: string;
      mtimeMs: number;
      size: number;
      byteOffset: number;
      lineNumber: number;
      jsonPointer: string;
    }
  | {
      kind: "active-process";
      processId: string;
      expiresAt: number;
    };
```

Line number, byte offset, and JSON pointer are an optimization. They should not
be part of the public API because they are brittle across pagination,
compaction overlays, forks, provider normalization changes, and line rewriting.

### Building The Catalog

The best first implementation is opportunistic:

1. During normal session load/normalization, when YA already scans the JSONL,
   detect inline media and populate a catalog for that session file.
2. Cache that catalog in memory keyed by provider/session plus source file
   `path + size + mtimeMs`.
3. Return media refs in the same pass that returns normalized messages.
4. On media fetch, look up the cached catalog entry, seek to the JSONL line,
   parse the line, follow the JSON pointer, verify the content hash, decode,
   and stream bytes.

If the media route is hit cold, rebuild the catalog by scanning the transcript
once. That should be acceptable for rare direct media URLs. If profiles later
show repeated cold scans are expensive, add a persistent index under the YA
data directory. Do not build a persistent index as the first step unless the
scan cost is already observed in practice.

### Active Process Media

Live messages can arrive before provider JSONL persistence catches up. For
those, the provider seam or `Process` layer should store decoded media in a
bounded temporary media store and return the same `mediaId` shape. Once the
durable transcript exists, the catalog can resolve the same logical media from
JSONL. The temporary store needs ordinary session/process cleanup so an idle
provider session or closed tab cannot keep media bytes forever.

## Metadata Extraction

The server should extract cheap metadata while replacing the payload:

- MIME type from the provider field or data URL header;
- decoded byte length from base64 length;
- content hash from decoded bytes or normalized base64 payload;
- dimensions for PNG, JPEG, GIF, and WebP using header parsing when practical;
- filename from provider path or a stable synthetic name such as
  `pasted-image-1.png`.

Dimensions matter because historical transcript rows must not change height
unexpectedly. If width and height are known, the client can reserve the expanded
preview box before fetching bytes. If dimensions are unknown, default-expanded
settings should not auto-expand historical rows, or the renderer should use a
fixed bounded placeholder that will not jump.

## Client Rendering Contract

Collapsed media chips should render from metadata only. Expanded media should
fetch the blob lazily and render an object URL.

The existing "inline media expanded by default" setting defaults off. If this
setting is applied to transcript media handles later, it must respect the
layout-stability rule from `packages/client/RENDERING_PERFORMANCE.md`: old
rows should not automatically change height unless the dimensions were known
and space was reserved, or the change was directly user-initiated.

## Security Contract

Media handle fetches must:

- use the same authenticated/local session authorization as the transcript;
- never accept a client-supplied filesystem path;
- use opaque IDs mapped server-side;
- send accurate `Content-Type`;
- include `X-Content-Type-Options: nosniff`;
- neutralize or refuse script-capable formats such as SVG unless there is an
  explicit safe rendering path;
- work over relay by riding the encrypted request channel.

Public shares need a separate share-scoped media manifest. Do not let a public
share fetch arbitrary session media by raw session ID plus media ID unless the
media was part of the shared transcript snapshot or live-share visibility set.

## Non-Goals

- Do not rewrite provider-owned JSONL as the first implementation.
- Do not expose row numbers, line numbers, byte offsets, or JSON pointers as
  public media addresses.
- Do not move this conversion to the browser as a client-only cleanup. That
  still transfers and retains the base64 payload.
- Do not make image auto-expansion default-on as part of the media handle work.
- Do not solve huge non-media payloads such as giant stdout in this proposal.
  Those need separate output truncation/windowing rules.

## Triggers

This becomes worth implementing when one of these is true:

- Claude or another provider produces repeated session API responses above a
  few MB due mostly to inline base64;
- mobile/relay session opens are measurably slow because of image-bearing
  transcript payloads;
- the session-detail data-layer ingest boundary is being touched anyway;
- public share snapshotting needs a manifest for transcript-visible media;
- a provider adds more generated-image output to durable transcripts.

Until then, keep the proposal recorded and avoid ad hoc per-renderer fixes that
leave the base64 in the API payload.
