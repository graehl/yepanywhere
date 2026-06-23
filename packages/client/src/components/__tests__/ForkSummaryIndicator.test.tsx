// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ForkSummaryIndicator,
  type ForkSummaryJob,
} from "../ForkSummaryIndicator";

vi.mock("../../i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

afterEach(cleanup);

function renderIndicator(
  job: ForkSummaryJob,
  overrides: Partial<{
    onCancel: () => void;
    onDismiss: () => void;
    onToggleAutoOpen: (v: boolean) => void;
  }> = {},
) {
  return render(
    <ForkSummaryIndicator
      job={job}
      onCancel={overrides.onCancel ?? vi.fn()}
      onDismiss={overrides.onDismiss ?? vi.fn()}
      onToggleAutoOpen={overrides.onToggleAutoOpen ?? vi.fn()}
    />,
  );
}

describe("ForkSummaryIndicator", () => {
  it("shows progress, an auto-open toggle, and cancels while generating", () => {
    const onCancel = vi.fn();
    const onToggleAutoOpen = vi.fn();
    renderIndicator(
      { status: "generating", startedAt: Date.now(), autoOpenWhenReady: false },
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

  it("links to the forked session and fades out (dismisses) on click", async () => {
    const onDismiss = vi.fn();
    const job: ForkSummaryJob = {
      status: "ready",
      startedAt: Date.now(),
      title: "Resume zh-en eval",
      targetHref: "https://example.test/projects/p/sessions/s2",
      targetUrl: "/projects/p/sessions/s2",
      autoOpened: false,
    };
    renderIndicator(job, { onDismiss });
    expect(screen.getByText("forkSummaryReadyOpen")).toBeTruthy();
    const link = screen.getByRole("link", { name: /Resume zh-en eval/ });
    expect(link.getAttribute("href")).toBe(job.targetHref);
    expect(link.getAttribute("target")).toBe("_blank");
    // No manual dismiss button in the ready state — it fades on the terminal
    // click event instead.
    expect(screen.queryByRole("button")).toBeNull();
    fireEvent.click(link);
    await waitFor(() => expect(onDismiss).toHaveBeenCalledTimes(1));
  });

  it("notes auto-open when the new tab opened", () => {
    renderIndicator({
      status: "ready",
      startedAt: Date.now(),
      title: "T",
      targetHref: "https://example.test/x",
      autoOpened: true,
    });
    expect(screen.getByText("forkSummaryOpenedNewTab")).toBeTruthy();
  });

  it("shows the error and dismisses", () => {
    const onDismiss = vi.fn();
    renderIndicator(
      { status: "error", startedAt: Date.now(), error: "boom" },
      { onDismiss },
    );
    expect(screen.getByText(/forkSummaryFailed: boom/)).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "forkSummaryDismiss" }),
    );
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
