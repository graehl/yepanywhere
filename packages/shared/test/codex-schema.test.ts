import { describe, expect, it } from "vitest";
import { CodexSessionEntrySchema } from "../src/codex-schema/session.js";

describe("CodexSessionEntrySchema", () => {
  it.each([
    {
      timestamp: "2026-07-10T00:00:00Z",
      type: "world_state",
      payload: { full: true, state: { agents_md: {} } },
    },
    {
      timestamp: "2026-07-10T00:00:00Z",
      type: "event_msg",
      payload: {
        type: "patch_apply_end",
        call_id: "exec-1",
        success: true,
        changes: { "/repo/a.txt": { type: "add", content: "hello" } },
      },
    },
    {
      timestamp: "2026-07-10T00:00:00Z",
      type: "event_msg",
      payload: { type: "thread_settings_applied", thread_settings: {} },
    },
    {
      timestamp: "2026-07-10T00:00:00Z",
      type: "event_msg",
      payload: { type: "thread_rolled_back", num_turns: 1 },
    },
    {
      timestamp: "2026-07-10T00:00:00Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: null,
        rate_limits: { primary: null },
      },
    },
    {
      timestamp: "2026-07-10T00:00:00Z",
      type: "response_item",
      payload: {
        type: "tool_search_call",
        call_id: "search-1",
        execution: "list tools",
        arguments: {},
      },
    },
  ])("accepts a current persisted %# entry", (entry) => {
    expect(CodexSessionEntrySchema.safeParse(entry).success).toBe(true);
  });
});
