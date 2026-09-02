# Claude background MCP task resource links are not presented

Claude Agent SDK 0.3.258 adds `resource_links` to live
`system/task_notification` messages for files returned by a backgrounded MCP
task. `ClaudeProvider` passes the field through, but
`packages/client/src/lib/transcriptProjection/messageProjection.ts` skips that
system subtype and YA does not correlate the links back to the originating tool
call by `tool_use_id`. A user can therefore miss the referenced files even
though the live SDK event carries them.

This was not folded into the provider refresh because resource URIs need an
explicit safety and presentation contract, and the live-only event must be
reconciled with the persisted task notification rather than creating a second
transcript truth. The likely fix is a provider-neutral resource-link type at the
normalization seam, correlation by tool-call id, safe URI rendering, and a
stream/persisted parity fixture covering a background MCP completion.

Found 2026-09-02 while refreshing Claude Code 2.1.258 / Agent SDK 0.3.258.
