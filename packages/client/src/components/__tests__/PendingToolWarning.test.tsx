// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { PendingToolWarning } from "../PendingToolWarning";

afterEach(cleanup);

function renderBanner(props: {
  toolName?: string;
  pendingSinceMs?: number | null;
  onDismiss?: () => void;
}) {
  return render(
    <I18nProvider>
      <PendingToolWarning
        toolName={props.toolName ?? "Bash"}
        pendingSinceMs={props.pendingSinceMs ?? Date.now() - 5000}
        onDismiss={props.onDismiss ?? (() => {})}
      />
    </I18nProvider>,
  );
}

describe("PendingToolWarning", () => {
  it("names the pending tool in the waiting copy when recent", () => {
    renderBanner({ toolName: "Edit", pendingSinceMs: Date.now() - 5000 });
    expect(screen.getByText(/Waiting on a Edit approval/)).toBeTruthy();
  });

  it("switches to the discard-risk copy once the call is stale", () => {
    renderBanner({ pendingSinceMs: Date.now() - 20 * 60 * 1000 });
    expect(
      screen.getByText(/previous run left a Bash call unanswered/),
    ).toBeTruthy();
  });

  it("calls onDismiss when the close button is clicked", () => {
    const onDismiss = vi.fn();
    renderBanner({ onDismiss });
    fireEvent.click(screen.getByRole("button", { name: /Dismiss warning/ }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("opens the risk explanation modal from the what's-the-risk affordance", () => {
    renderBanner({});
    // The modal title only renders inside the Modal, not the always-present
    // hover tooltip, so it is an unambiguous signal the modal opened.
    expect(screen.queryByText(/Why check the other process/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /What's the risk/ }));
    expect(screen.getByText(/Why check the other process/)).toBeTruthy();
  });
});
