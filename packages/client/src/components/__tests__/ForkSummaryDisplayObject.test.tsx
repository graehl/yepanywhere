// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { TranscriptDisplayObject } from "@yep-anywhere/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ForkSummaryDisplayObject } from "../ForkSummaryDisplayObject";

vi.mock("../../i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

afterEach(cleanup);

function renderObject(
  object: TranscriptDisplayObject,
  overrides: Partial<{
    onCancel: () => void;
    onToggleAutoOpen: (v: boolean) => void;
    onFollow: () => void;
  }> = {},
) {
  return render(
    <ForkSummaryDisplayObject
      object={object}
      targetHref="https://example.test/projects/p/sessions/s2"
      onCancel={overrides.onCancel ?? vi.fn()}
      onToggleAutoOpen={overrides.onToggleAutoOpen ?? vi.fn()}
      onFollow={overrides.onFollow ?? vi.fn()}
    />,
  );
}

const baseObject = {
  id: "display-1",
  kind: "fork-summary",
  createdAt: new Date().toISOString(),
  placementAfterMessageId: "tail-1",
  sourceMessageId: "user-1",
  retainedThroughMessageId: "assistant-1",
} satisfies Omit<TranscriptDisplayObject, "status">;

describe("ForkSummaryDisplayObject", () => {
  it("shows progress, an auto-open toggle, and cancels while generating", () => {
    const onCancel = vi.fn();
    const onToggleAutoOpen = vi.fn();
    renderObject(
      { ...baseObject, status: "generating", autoOpenWhenReady: false },
      { onCancel, onToggleAutoOpen },
    );
    expect(screen.getByText("forkSummaryProgress")).toBeTruthy();

    fireEvent.click(screen.getByRole("checkbox"));
    expect(onToggleAutoOpen).toHaveBeenCalledWith(true);

    fireEvent.click(
      screen.getByRole("button", { name: "forkSummaryCancelInFlight" }),
    );
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("keeps the ready link and records a follow click", () => {
    const onFollow = vi.fn();
    const object: TranscriptDisplayObject = {
      ...baseObject,
      status: "ready",
      title: "Resume zh-en eval",
      targetSessionId: "s2",
    };
    renderObject(object, { onFollow });
    expect(screen.getByText("forkSummaryReadyPrefix")).toBeTruthy();
    const link = screen.getByRole("link", { name: /Resume zh-en eval/ });
    expect(link.getAttribute("href")).toBe(
      "https://example.test/projects/p/sessions/s2",
    );
    expect(link.getAttribute("target")).toBe("_blank");
    expect(screen.queryByRole("button")).toBeNull();
    fireEvent.click(link);
    expect(onFollow).toHaveBeenCalledTimes(1);
  });

  it("keeps persisted opened and clicked markers", () => {
    renderObject({
      ...baseObject,
      status: "ready",
      title: "T",
      targetSessionId: "s2",
      openedAt: new Date().toISOString(),
    });
    expect(screen.getByText("forkSummaryOpenedMarker")).toBeTruthy();

    cleanup();
    renderObject({
      ...baseObject,
      status: "ready",
      title: "T",
      targetSessionId: "s2",
      clickedAt: new Date().toISOString(),
    });
    expect(screen.getByText("forkSummaryClicked")).toBeTruthy();
  });

  it("shows the error and dismisses", () => {
    const onCancel = vi.fn();
    renderObject(
      { ...baseObject, status: "error", error: "boom" },
      { onCancel },
    );
    expect(screen.getByText(/forkSummaryFailed: boom/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "forkSummaryDismiss" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
