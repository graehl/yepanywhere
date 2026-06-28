// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import {
  asClientSummarySourceKey,
  createClientSummaryHostSourceKey,
  LOCAL_CLIENT_SUMMARY_SOURCE_KEY,
} from "../clientSummaryStore";
import {
  createSessionDraftStorageKey,
  saveSessionDraft,
  scanSessionDraftIds,
} from "../sessionDraftStorage";

function readStoredText(key: string): string | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  return (JSON.parse(raw) as { text?: string }).text ?? null;
}

afterEach(() => {
  localStorage.clear();
});

describe("sessionDraftStorage", () => {
  it("keeps local drafts on the legacy key and backfills the index", () => {
    saveSessionDraft(
      {
        sourceKey: LOCAL_CLIENT_SUMMARY_SOURCE_KEY,
        sessionId: "session-a",
      },
      "draft text",
    );

    expect(readStoredText("draft-message-session-a")).toBe("draft text");
    expect([...scanSessionDraftIds(LOCAL_CLIENT_SUMMARY_SOURCE_KEY)]).toEqual([
      "session-a",
    ]);
    expect(localStorage.getItem("draft-index-message:local")).toBe(
      '["session-a"]',
    );
  });

  it("discovers remote drafts from only the source index", () => {
    const macbook = createClientSummaryHostSourceKey("macbook");
    const winnative = createClientSummaryHostSourceKey("winnative");

    saveSessionDraft({ sourceKey: macbook, sessionId: "mac-session" }, "mac");
    saveSessionDraft({ sourceKey: winnative, sessionId: "win-session" }, "win");
    localStorage.setItem("draft-message-legacy-session", "legacy");

    expect([...scanSessionDraftIds(macbook)]).toEqual(["mac-session"]);
    expect([...scanSessionDraftIds(winnative)]).toEqual(["win-session"]);
    expect([...scanSessionDraftIds(LOCAL_CLIENT_SUMMARY_SOURCE_KEY)]).toEqual([
      "legacy-session",
    ]);
  });

  it("removes empty drafts from the index", () => {
    const sourceKey = asClientSummarySourceKey("direct:ws://example/ws");
    const reference = { sourceKey, sessionId: "session-a" };

    saveSessionDraft(reference, "draft text");
    saveSessionDraft(reference, "");

    expect([...scanSessionDraftIds(sourceKey)]).toEqual([]);
    expect(localStorage.getItem("draft-index-message:direct%3Aws%3A%2F%2Fexample%2Fws")).toBe(
      null,
    );
  });

  it("keeps attachment-only envelopes in the index", () => {
    const sourceKey = asClientSummarySourceKey("direct:ws://example/ws");
    const key = createSessionDraftStorageKey({
      sourceKey,
      sessionId: "session-a",
    });
    localStorage.setItem(
      key,
      JSON.stringify({
        version: 1,
        text: "",
        attachments: {
          batchId: "batch-a",
          updatedAt: "2026-06-28T00:00:00.000Z",
          refs: [
            {
              id: "file-a",
              batchId: "batch-a",
              originalName: "screenshot.png",
              name: "uuid_screenshot.png",
              size: 123,
              mimeType: "image/png",
              createdAt: "2026-06-28T00:00:00.000Z",
              updatedAt: "2026-06-28T00:00:00.000Z",
            },
          ],
        },
      }),
    );
    localStorage.setItem(
      "draft-index-message:direct%3Aws%3A%2F%2Fexample%2Fws",
      '["session-a"]',
    );

    expect([...scanSessionDraftIds(sourceKey)]).toEqual(["session-a"]);
  });

  it("builds encoded remote body keys", () => {
    const sourceKey = asClientSummarySourceKey("direct:ws://example/ws");

    expect(
      createSessionDraftStorageKey({ sourceKey, sessionId: "session/a" }),
    ).toBe("draft-message:direct%3Aws%3A%2F%2Fexample%2Fws:session%2Fa");
  });
});
