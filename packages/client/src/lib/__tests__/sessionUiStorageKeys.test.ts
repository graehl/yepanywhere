import { describe, expect, it } from "vitest";
import { createClientSummaryHostSourceKey } from "../clientSummaryStore";
import { createPendingElsewhereDismissKey } from "../sessionUiStorageKeys";

describe("sessionUiStorageKeys", () => {
  it("keys pending-elsewhere dismissals by source and session", () => {
    const macbook = createClientSummaryHostSourceKey("macbook");
    const winnative = createClientSummaryHostSourceKey("winnative");

    expect(createPendingElsewhereDismissKey(macbook, "session:1")).toBe(
      "yepanywhere:pending-elsewhere-dismissed:host%3Amacbook:session%3A1",
    );
    expect(createPendingElsewhereDismissKey(winnative, "session:1")).toBe(
      "yepanywhere:pending-elsewhere-dismissed:host%3Awinnative:session%3A1",
    );
  });
});
