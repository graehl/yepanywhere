// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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
  it("offers restart when safe for backend reloads", () => {
    const onRestartWhenSafe = vi.fn();
    renderBanner({
      unsafeToRestart: true,
      interruptibleSessionCount: 2,
      onRestartWhenSafe,
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Restart When Safe" }),
    );

    expect(onRestartWhenSafe).toHaveBeenCalledTimes(1);
    expect(screen.getByText("2 active sessions will be interrupted")).toBeTruthy();
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

  it("does not show restart when safe for frontend reloads", () => {
    renderBanner({
      target: "frontend",
      onRestartWhenSafe: vi.fn(),
    });

    expect(
      screen.queryByRole("button", { name: "Restart When Safe" }),
    ).toBeNull();
  });
});
