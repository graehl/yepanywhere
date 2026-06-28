// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { createClientSummaryHostSourceKey } from "../clientSummaryStore";
import {
  clearNewSessionPrefill,
  createNewSessionPrefillKey,
  getNewSessionPrefill,
  setNewSessionPrefill,
} from "../newSessionPrefill";

afterEach(() => {
  sessionStorage.clear();
});

describe("newSessionPrefill", () => {
  it("keeps prefills isolated by source", () => {
    const macbook = createClientSummaryHostSourceKey("macbook");
    const winnative = createClientSummaryHostSourceKey("winnative");

    setNewSessionPrefill(macbook, "mac prompt");

    expect(getNewSessionPrefill(winnative)).toBeNull();

    setNewSessionPrefill(winnative, "win prompt");

    expect(getNewSessionPrefill(macbook)).toBe("mac prompt");
    expect(getNewSessionPrefill(winnative)).toBe("win prompt");

    clearNewSessionPrefill(winnative);

    expect(getNewSessionPrefill(macbook)).toBe("mac prompt");
    expect(getNewSessionPrefill(winnative)).toBeNull();
  });

  it("builds encoded source keys", () => {
    const macbook = createClientSummaryHostSourceKey("macbook");

    expect(createNewSessionPrefillKey(macbook)).toBe(
      "new-session-prefill:host%3Amacbook",
    );
  });
});
