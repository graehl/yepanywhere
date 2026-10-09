# Session-path Download waits before appearing in the browser

Right-clicking a session file path and choosing Download reportedly leaves
the browser showing no download for about 15 seconds, then completes. This is
a download-start delay, not a reported slow transfer. The user sees it across
PDF, TGZ and ZIP files below 200 MB; SCP of the same files takes about a second.

Example supplied by the user:
`/local/graehl/trtllm-speculative/draft/research/pii/frontier/papers/multilingual-pii-redaction/_build/preprint/arxiv-source.zip`.
The file exists and was 7,338,936 bytes at inspection. The affected browser
origin and transport have not yet been established. No faithful timed browser
reproduction has been completed; the cause remains unresolved.

## Current paths and discriminating checks

The owning contract is [media rendering and routing](../topics/media-rendering-and-routing.md),
especially Relay transfer size and download consumers.

- `packages/client/src/components/FilePathLink.tsx` supplies a raw attachment
  URL and a transport-backed Blob loader to `useSaveResourceDownload` in
  `packages/client/src/components/FileResourceActions.tsx`.
- On a same-origin transport, the browser receives the attachment URL directly.
  Measure menu selection, request start and response headers separately. The
  raw handler in `packages/server/src/routes/files.ts` awaits project lookup
  before opening the file, though it permits an existing stale project snapshot.
- Otherwise, when streaming and service-worker control are available, the
  client awaits transport response headers and then registers a one-time
  download through `packages/client/src/lib/streamedDownload.ts` and
  `packages/client/public/sw.js`. Separate response-header delay from worker
  registration, frame navigation and the browser download event.
- The fallback collects the entire Blob before opening the download. That
  mechanism can produce the reported presentation, but its use in the affected
  tab is unverified. Record transport capabilities, service-worker control and
  whether response streaming was negotiated before attributing the delay.

The worker's 60-second unclaimed-download fallback and 10-second keepalive
are not evidence of a 15-second startup timer. At 20:32 UTC on 2026-10-09,
the host had 70.1% available RAM; this does not rule out CPU/I/O contention or
pressure during the reported incident.

No behavior patch was made: the immediate inspection did not identify a
demonstrated cause. Next reproduce the supplied file through the affected
transport and capture the stage timestamps above. A fix must let the browser
acknowledge the download promptly without requiring the complete file body,
while preserving streaming, cancellation and error handling.

Found 2026-10-09 while fixing New Session and Settings tab startup.
Contributing-model: 6-astra.
