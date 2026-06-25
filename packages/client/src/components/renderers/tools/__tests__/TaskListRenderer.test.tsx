// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { taskCreateRenderer, taskUpdateRenderer } from "../TaskListRenderer";

const renderContext = {
  isStreaming: false,
  theme: "dark" as const,
};

describe("TaskListRenderer", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders an injected task snapshot as a checklist", () => {
    const snapshot = {
      version: 1,
      sourceToolUseId: "tool-update-2",
      currentTaskId: "2",
      tasks: [
        { id: "1", subject: "Inspect session jsonl", status: "completed" },
        { id: "2", subject: "Update renderer docs", status: "in_progress" },
      ],
    };

    if (!taskUpdateRenderer.renderInline) {
      throw new Error("TaskUpdate renderer must provide inline rendering");
    }

    render(
      <div>
        {taskUpdateRenderer.renderInline(
          { taskId: "2", status: "in_progress" },
          { success: true, _taskSnapshot: snapshot },
          false,
          "complete",
          renderContext,
        )}
      </div>,
    );

    expect(screen.getByText("1 out of 2 tasks completed")).toBeDefined();
    expect(screen.getByText("Inspect session jsonl")).toBeDefined();
    expect(screen.getByText("Update renderer docs")).toBeDefined();
  });

  it("falls back to a concise create event without a snapshot", () => {
    if (!taskCreateRenderer.renderInline) {
      throw new Error("TaskCreate renderer must provide inline rendering");
    }

    render(
      <div>
        {taskCreateRenderer.renderInline(
          { subject: "Check current task state" },
          "Task #1 created successfully: Check current task state",
          false,
          "complete",
          renderContext,
        )}
      </div>,
    );

    expect(screen.getByText("Check current task state")).toBeDefined();
  });
});
