import { describe, expect, it } from "vitest";
import { parseCodexSessionEntry } from "../codex-schema/session.js";

describe("Codex persisted session schema", () => {
  it("retains paginated lineage metadata and entry ordinals", () => {
    const parsed = parseCodexSessionEntry(
      JSON.stringify({
        timestamp: "2026-09-03T00:00:00.000Z",
        ordinal: 42,
        type: "session_meta",
        payload: {
          id: "22222222-2222-7222-8222-222222222222",
          session_id: "22222222-2222-7222-8222-222222222222",
          timestamp: "2026-09-03T00:00:00.000Z",
          cwd: "/test/project",
          forked_from_id: "11111111-1111-7111-8111-111111111111",
          forked_from_ordinal_exclusive: 42,
          history_mode: "paginated",
          history_base: {
            thread_id: "11111111-1111-7111-8111-111111111111",
            end_ordinal_exclusive: 42,
            end_byte_offset: 4096,
          },
        },
      }),
    );

    expect(parsed).toMatchObject({
      ordinal: 42,
      type: "session_meta",
      payload: {
        history_mode: "paginated",
        forked_from_ordinal_exclusive: 42,
        history_base: {
          thread_id: "11111111-1111-7111-8111-111111111111",
          end_ordinal_exclusive: 42,
          end_byte_offset: 4096,
        },
      },
    });
  });
});
