# Transcript Projection Ownership

This directory owns the pure, browser-free transformation from the current
client-internal `Message[]` input to the current client-internal `RenderItem[]`
model. These types are an implementation boundary, not a public package ABI or
a versioned mobile/server contract.

## Ownership map

| Concern | Owner |
|---|---|
| Ordered stage orchestration | `compiler.ts` |
| Per-message and per-block projection | `messageProjection.ts` |
| Agent result parsing | `agentResults.ts` |
| Compact-boundary coalescing | `compactBoundaries.ts` |
| Slash-command body coalescing | `slashCommandBodies.ts` |
| Shell, write, wait, and background folding | `shellFolding.ts` |
| Session-setup run collapsing | `sessionSetup.ts` |
| Platform-neutral input types | `types.ts` |
| Same-input identity cache | `cache.ts` |
| Browser diagnostics and cached web assembly | `../webTranscriptProjection.ts` |
| Display objects and previous-row stabilization | Existing web adapters outside this directory |
| Grouping, selectors, React components, and DOM behavior | Existing web renderer outside this directory |
| Provider storage and server normalization | Server provider/session modules |

## Adding behavior

- Put provider-visible semantic interpretation in the narrowest matching
  module above. Add a new domain module when no existing owner fits.
- Wire each new semantic stage into `compiler.ts` exactly once. Do not add a
  second web compilation pipeline or call the compiler directly from a
  production React consumer.
- Route production web projection through
  `getCachedWebTranscriptProjection`. Tests and browser-free parity tooling may
  call the pure compiler directly when they are testing semantic output.
- When adding a projection augment, define its identity semantics in
  `cache.ts`; the exhaustive cache-key map makes an omission a type error.
- Keep React, browser globals, stores, transport, timers, server APIs, layout,
  and interaction state outside this directory.
- Import from the owning module. Do not restore `preprocessMessages.ts`, add a
  compatibility re-export, or create a barrel that hides ownership.
- Preserve behavior unless a separately reviewed semantic change updates its
  fixtures and architecture record.

The source-level boundary tests in
`../__tests__/transcriptProjectionBoundary.test.ts` enforce the most important
parts of this map.
