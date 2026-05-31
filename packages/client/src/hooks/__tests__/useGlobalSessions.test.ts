import type { UrlProjectId } from "@yep-anywhere/shared";
import { describe, expect, it } from "vitest";
import type { GlobalSessionItem } from "../../api/client";
import type { ProcessStateEvent } from "../../lib/activityBus";
import {
  reconcileGlobalSessionsProcessState,
  shouldRefetchGlobalSessionsAfterProcessState,
} from "../useGlobalSessions";

const PROJECT_ID = "project-1" as UrlProjectId;

function session(
  overrides: Partial<GlobalSessionItem> = {},
): GlobalSessionItem {
  return {
    id: "session-1",
    title: "Test session",
    fullTitle: "Test session",
    createdAt: "2026-05-31T13:28:57.157Z",
    updatedAt: "2026-05-31T13:28:59.588Z",
    messageCount: 3,
    provider: "claude",
    projectId: PROJECT_ID,
    projectName: "yepanywhere",
    ownership: {
      owner: "self",
      processId: "process-1",
      permissionMode: "bypassPermissions",
      modeVersion: 1,
    },
    ...overrides,
  };
}

function processStateEvent(
  overrides: Partial<ProcessStateEvent> = {},
): ProcessStateEvent {
  return {
    type: "process-state-changed",
    sessionId: "session-1",
    projectId: PROJECT_ID,
    activity: "idle",
    timestamp: "2026-05-31T13:28:59.493Z",
    ...overrides,
  };
}

describe("global session process-state reconciliation", () => {
  it("clears sidebar activity for an owned idle Claude process", () => {
    const activeSession = session({
      activity: "in-turn",
      pendingInputType: "tool-approval",
    });

    const result = reconcileGlobalSessionsProcessState(
      [activeSession],
      processStateEvent({ activity: "idle" }),
    );

    expect(result.matched).toBe(true);
    expect(result.sessions[0]?.ownership).toEqual(activeSession.ownership);
    expect(result.sessions[0]?.activity).toBeUndefined();
    expect(result.sessions[0]?.pendingInputType).toBeUndefined();
  });

  it("sets waiting-input details from process-state events", () => {
    const result = reconcileGlobalSessionsProcessState(
      [session({ activity: "in-turn" })],
      processStateEvent({
        activity: "waiting-input",
        pendingInputType: "user-question",
      }),
    );

    expect(result.sessions[0]?.activity).toBe("waiting-input");
    expect(result.sessions[0]?.pendingInputType).toBe("user-question");
  });

  it("clears stale pending input when a process resumes in-turn", () => {
    const result = reconcileGlobalSessionsProcessState(
      [
        session({
          activity: "waiting-input",
          pendingInputType: "tool-approval",
        }),
      ],
      processStateEvent({ activity: "in-turn" }),
    );

    expect(result.sessions[0]?.activity).toBe("in-turn");
    expect(result.sessions[0]?.pendingInputType).toBeUndefined();
  });

  it("reports missed rows so callers can refetch from the server snapshot", () => {
    const existingSession = session({ id: "other-session" });

    const result = reconcileGlobalSessionsProcessState(
      [existingSession],
      processStateEvent(),
    );

    expect(result.matched).toBe(false);
    expect(result.sessions).toEqual([existingSession]);
  });

  it("requests authoritative refetches for missed or inactive transitions", () => {
    expect(
      shouldRefetchGlobalSessionsAfterProcessState(
        processStateEvent({ activity: "in-turn" }),
        true,
      ),
    ).toBe(false);
    expect(
      shouldRefetchGlobalSessionsAfterProcessState(
        processStateEvent({ activity: "idle" }),
        true,
      ),
    ).toBe(true);
    expect(
      shouldRefetchGlobalSessionsAfterProcessState(
        processStateEvent({ activity: "in-turn" }),
        false,
      ),
    ).toBe(true);
  });
});
