// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelSwitchModal } from "../ModelSwitchModal";

vi.mock("../../hooks/useModelSettings", () => ({
  getEffortLevel: () => "high",
  getShowThinkingSetting: () => true,
  getThinkingMode: () => "off",
  useModelSettings: () => ({
    setEffortLevel: vi.fn(),
    setThinkingMode: vi.fn(),
  }),
}));

vi.mock("../../i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

describe("ModelSwitchModal", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("resets the shared modal scroller when switching tabs", () => {
    render(
      <ModelSwitchModal
        sessionId="session-1"
        currentModel="model-1"
        infoPane={<div>Session details</div>}
        initialTab="info"
        onModelChanged={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const modalContent = document.querySelector(".modal-content");
    expect(modalContent).toBeInstanceOf(HTMLElement);
    const scrollTo = vi.fn();
    Object.defineProperty(modalContent, "scrollTo", { value: scrollTo });

    fireEvent.click(
      screen.getByRole("tab", { name: "newSessionModelTitle" }),
    );

    expect(scrollTo).toHaveBeenCalledWith({ top: 0 });
    expect(screen.queryByText("Session details")).toBeNull();
  });
});
