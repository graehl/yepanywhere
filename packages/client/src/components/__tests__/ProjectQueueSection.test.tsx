// @vitest-environment jsdom

import type {
  ProjectQueueDispatchState,
  ProjectQueueItemSummary,
} from "@yep-anywhere/shared";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import type { Project } from "../../types";
import { ProjectQueueSection } from "../ProjectQueueSection";

const PROJECT_ID = "project-1" as ProjectQueueItemSummary["projectId"];

const project: Project = {
  id: PROJECT_ID,
  name: "Alpha",
  path: "/tmp/alpha",
  sessionCount: 2,
  activeOwnedCount: 0,
  activeExternalCount: 0,
  lastActivity: null,
};

function makeItem(
  id: string,
  status: ProjectQueueItemSummary["status"] = "queued",
): ProjectQueueItemSummary {
  return {
    id,
    projectId: PROJECT_ID,
    target: { type: "existing-session", sessionId: "session-abcdef" },
    messagePreview: `Queued message ${id}`,
    message: { text: `Queued message ${id}` },
    createdAt: "2026-06-27T00:00:00.000Z",
    updatedAt: "2026-06-27T00:00:00.000Z",
    status,
    attachmentCount: 0,
    ...(status === "failed" ? { lastError: "Provider unavailable" } : {}),
  };
}

function renderSection(
  items: ProjectQueueItemSummary[],
  handlers = {
    onPauseDispatch: vi.fn(),
    onResumeDispatch: vi.fn(),
    onDeleteItem: vi.fn(),
    onRetryItem: vi.fn(),
    onUpdateItem: vi.fn(),
  },
  highlightedItemId?: string,
  dispatchState: ProjectQueueDispatchState = { status: "running" },
) {
  render(
    <I18nProvider>
      <MemoryRouter>
        <ProjectQueueSection
          projects={[project]}
          items={items}
          loading={false}
          error={null}
          mutatingItemId={null}
          mutatingDispatchState={false}
          dispatchState={dispatchState}
          highlightedItemId={highlightedItemId}
          onPauseDispatch={handlers.onPauseDispatch}
          onResumeDispatch={handlers.onResumeDispatch}
          onDeleteItem={handlers.onDeleteItem}
          onRetryItem={handlers.onRetryItem}
          onUpdateItem={handlers.onUpdateItem}
        />
      </MemoryRouter>
    </I18nProvider>,
  );
  return handlers;
}

describe("ProjectQueueSection", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders queued items with project, target, and delete action", () => {
    const handlers = renderSection([makeItem("1")]);

    expect(screen.getByRole("heading", { name: "Project Queue" })).toBeTruthy();
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText("Queued message 1")).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Session session-" })
        .getAttribute("href"),
    ).toBe(
      "/projects/project-1/sessions/session-abcdef",
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(handlers.onDeleteItem).toHaveBeenCalledWith("project-1", "1");
  });

  it("pauses dispatch from the header", () => {
    const handlers = renderSection([makeItem("1")]);

    fireEvent.click(screen.getByRole("button", { name: "Pause" }));

    expect(handlers.onPauseDispatch).toHaveBeenCalledTimes(1);
  });

  it("resumes paused-after-restart dispatch from the header", () => {
    const handlers = renderSection(
      [makeItem("1")],
      undefined,
      undefined,
      {
        status: "paused",
        reason: "restart",
        pausedAt: "2026-06-30T00:00:00.000Z",
      },
    );

    expect(screen.getByText("Dispatch is paused after server restart."))
      .toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));

    expect(handlers.onResumeDispatch).toHaveBeenCalledTimes(1);
  });

  it("offers retry and shows errors for failed items", () => {
    const handlers = renderSection([makeItem("2", "failed")]);

    expect(screen.getByText("Provider unavailable")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(handlers.onRetryItem).toHaveBeenCalledWith("project-1", "2");
  });

  it("highlights a linked queue item", () => {
    renderSection([makeItem("1"), makeItem("2")], undefined, "2");

    const highlighted = document.querySelector(
      '[data-project-queue-item-id="2"]',
    );
    expect(highlighted?.classList.contains("project-queue-item--highlighted"))
      .toBe(true);
  });

  it("edits queued item text", async () => {
    const handlers = renderSection([makeItem("4")]);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Project Queue message"), {
      target: { value: "Edited queued work" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(handlers.onUpdateItem).toHaveBeenCalledWith(
        "project-1",
        "4",
        { text: "Edited queued work" },
      ),
    );
  });

  it("disables cancellation while dispatching", () => {
    renderSection([makeItem("3", "dispatching")]);

    expect(
      (screen.getByRole("button", { name: "Delete" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.getByText("Sending")).toBeTruthy();
  });
});
