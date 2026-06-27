import { describe, expect, it } from "vitest";
import {
  PROJECT_QUEUE_CAPABILITY,
  serverSupportsProjectQueue,
  shouldShowProjectQueueAffordance,
} from "../projectQueueVisibility";

describe("serverSupportsProjectQueue", () => {
  it("requires the explicit server capability", () => {
    expect(serverSupportsProjectQueue(null)).toBe(false);
    expect(serverSupportsProjectQueue({ capabilities: [] })).toBe(false);
    expect(
      serverSupportsProjectQueue({
        capabilities: [PROJECT_QUEUE_CAPABILITY],
      }),
    ).toBe(true);
  });
});

describe("shouldShowProjectQueueAffordance", () => {
  it("hides without a known project", () => {
    expect(shouldShowProjectQueueAffordance({ projectId: null })).toBe(false);
  });

  it("shows when project queue backlog exists", () => {
    expect(
      shouldShowProjectQueueAffordance({
        projectId: "project-1",
        projectQueueItemCount: 1,
      }),
    ).toBe(true);
  });

  it("hides when normal send is equivalent", () => {
    expect(
      shouldShowProjectQueueAffordance({
        projectId: "project-1",
        currentSessionId: "session-1",
        activeProjectSessionIds: [],
      }),
    ).toBe(false);
  });

  it("hides when normal session queue is equivalent", () => {
    expect(
      shouldShowProjectQueueAffordance({
        projectId: "project-1",
        currentSessionId: "session-1",
        activeProjectSessionIds: ["session-1"],
      }),
    ).toBe(false);
  });

  it("hides when project active count only reflects the current active session", () => {
    expect(
      shouldShowProjectQueueAffordance({
        projectId: "project-1",
        currentSessionId: "session-1",
        currentSessionIsActive: true,
        projectActiveSessionCount: 1,
      }),
    ).toBe(false);
  });

  it("shows when the current active session already has backlog", () => {
    expect(
      shouldShowProjectQueueAffordance({
        projectId: "project-1",
        currentSessionId: "session-1",
        currentSessionHasSessionQueueBacklog: true,
        activeProjectSessionIds: ["session-1"],
      }),
    ).toBe(true);
  });

  it("shows when project active count indicates another active session", () => {
    expect(
      shouldShowProjectQueueAffordance({
        projectId: "project-1",
        currentSessionId: "session-1",
        currentSessionIsActive: false,
        projectActiveSessionCount: 1,
      }),
    ).toBe(true);
    expect(
      shouldShowProjectQueueAffordance({
        projectId: "project-1",
        currentSessionId: "session-1",
        currentSessionIsActive: true,
        projectActiveSessionCount: 2,
      }),
    ).toBe(true);
  });

  it("shows when other project sessions are active", () => {
    expect(
      shouldShowProjectQueueAffordance({
        projectId: "project-1",
        currentSessionId: "session-1",
        activeProjectSessionIds: ["session-2"],
      }),
    ).toBe(true);
  });
});
