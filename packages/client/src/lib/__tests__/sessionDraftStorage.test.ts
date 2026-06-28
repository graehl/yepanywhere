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

    expect(localStorage.getItem("draft-message-session-a")).toBe("draft text");
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

  it("builds encoded remote body keys", () => {
    const sourceKey = asClientSummarySourceKey("direct:ws://example/ws");

    expect(
      createSessionDraftStorageKey({ sourceKey, sessionId: "session/a" }),
    ).toBe("draft-message:direct%3Aws%3A%2F%2Fexample%2Fws:session%2Fa");
  });
});
