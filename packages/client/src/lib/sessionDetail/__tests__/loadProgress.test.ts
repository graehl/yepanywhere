import { describe, expect, it } from "vitest";
import type { PaginationInfo } from "../../../api/client";
import {
  createSessionLoadProgress,
  createSessionLoadProgressForWindow,
} from "../loadProgress";

function pagination(overrides: Partial<PaginationInfo> = {}): PaginationInfo {
  return {
    hasOlderMessages: true,
    totalMessageCount: 10,
    returnedMessageCount: 3,
    totalCompactions: 1,
    ...overrides,
  };
}

describe("session load progress", () => {
  it("creates bare stage progress with an injectable timestamp", () => {
    expect(createSessionLoadProgress("fetching", {}, 123)).toEqual({
      stage: "fetching",
      updatedAtMs: 123,
    });
  });

  it("projects transcript-window pagination into progress details", () => {
    expect(
      createSessionLoadProgressForWindow("rendering", {
        messageCount: 3,
        pagination: pagination(),
        nowMs: 456,
      }),
    ).toEqual({
      stage: "rendering",
      messageCount: 3,
      totalMessageCount: 10,
      hasOlderMessages: true,
      updatedAtMs: 456,
    });
  });

  it("keeps an explicit message count separate from returnedMessageCount", () => {
    expect(
      createSessionLoadProgressForWindow("complete", {
        messageCount: 7,
        pagination: pagination({ returnedMessageCount: 3 }),
        nowMs: 789,
      }).messageCount,
    ).toBe(7);
  });
});
