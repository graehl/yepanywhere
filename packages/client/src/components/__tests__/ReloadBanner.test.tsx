// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { ReloadBanner } from "../ReloadBanner";

function renderBanner(
  props: Partial<Parameters<typeof ReloadBanner>[0]> = {},
) {
  return render(
    <I18nProvider>
      <ReloadBanner
        target="backend"
        onReload={vi.fn()}
        onDismiss={vi.fn()}
        {...props}
      />
    </I18nProvider>,
  );
}

describe("ReloadBanner", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("requires confirmation before immediate reload", () => {
    const onReload = vi.fn();
    renderBanner({
      unsafeToRestart: true,
      interruptibleSessionCount: 1,
      onReload,
    });

    fireEvent.click(screen.getByRole("button", { name: "Reload Now" }));

    expect(onReload).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Tap again to confirm" }),
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Tap again to confirm" }),
    );

    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it("resets immediate reload confirmation after a short timeout", () => {
    vi.useFakeTimers();
    const onReload = vi.fn();
    renderBanner({
      unsafeToRestart: true,
      interruptibleSessionCount: 1,
      onReload,
    });

    fireEvent.click(screen.getByRole("button", { name: "Reload Now" }));

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(screen.getByRole("button", { name: "Reload Now" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Reload Now" }));

    expect(onReload).not.toHaveBeenCalled();
  });

  it("clears immediate reload confirmation when reload when safe is chosen", () => {
    const onReload = vi.fn();
    const onRestartWhenSafe = vi.fn();
    renderBanner({
      unsafeToRestart: true,
      interruptibleSessionCount: 1,
      onReload,
      onRestartWhenSafe,
    });

    fireEvent.click(screen.getByRole("button", { name: "Reload Now" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Reload When Safe" }),
    );

    expect(onRestartWhenSafe).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Reload Now" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Reload Now" }));

    expect(onReload).not.toHaveBeenCalled();
  });

  it("offers reload when safe for backend reloads", () => {
    const onRestartWhenSafe = vi.fn();
    renderBanner({
      unsafeToRestart: true,
      interruptibleSessionCount: 2,
      onRestartWhenSafe,
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Reload When Safe" }),
    );

    expect(onRestartWhenSafe).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText("2 active sessions will be interrupted"),
    ).toBeTruthy();
  });

  it("reloads immediately for safe backend reloads", () => {
    const onReload = vi.fn();
    renderBanner({
      onRestartWhenSafe: vi.fn(),
      onReload,
    });

    fireEvent.click(screen.getByRole("button", { name: "Reload Server" }));

    expect(onReload).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole("button", { name: "Reload When Safe" }),
    ).toBeNull();
  });

  it("shows scheduled drain status and cancel action", () => {
    const onCancelSafeRestart = vi.fn();
    renderBanner({
      onRestartWhenSafe: vi.fn(),
      onCancelSafeRestart,
      safeRestartState: {
        status: "scheduled",
        blockers: [
          { type: "active-sessions", count: 1 },
          { type: "session-queue", count: 2 },
        ],
        canRestartNow: false,
        scheduledAt: "2026-06-30T00:00:00.000Z",
        updatedAt: "2026-06-30T00:00:00.000Z",
      },
    });

    expect(
      screen.getByText(
        "Restart scheduled - waiting for 1 active session and 2 queued messages",
      ),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Cancel Restart" }));

    expect(onCancelSafeRestart).toHaveBeenCalledTimes(1);
  });

  it("shows preserved recovered queue status for scheduled restart", () => {
    renderBanner({
      onRestartWhenSafe: vi.fn(),
      safeRestartState: {
        status: "scheduled",
        blockers: [{ type: "active-sessions", count: 1 }],
        preserved: [{ type: "recovered-session-queue", count: 2 }],
        canRestartNow: false,
        scheduledAt: "2026-06-30T00:00:00.000Z",
        updatedAt: "2026-06-30T00:00:00.000Z",
      },
    });

    expect(
      screen.getByText(/2 recovered patient queued messages preserved/),
    ).toBeTruthy();
  });

  it("does not show reload when safe for frontend reloads", () => {
    renderBanner({
      target: "frontend",
      onRestartWhenSafe: vi.fn(),
    });

    expect(
      screen.queryByRole("button", { name: "Reload When Safe" }),
    ).toBeNull();
  });
});
