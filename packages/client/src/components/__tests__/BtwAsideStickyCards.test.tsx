// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import {
  BtwAsideStickyCards,
  type BtwAsideStickyCardItem,
} from "../BtwAsideStickyCards";

function aside(
  overrides: Partial<BtwAsideStickyCardItem> = {},
): BtwAsideStickyCardItem {
  return {
    id: "aside-1",
    request: "check side state",
    followUps: [],
    status: "running",
    responses: ["first answer"],
    ...overrides,
  };
}

function renderCards({
  asides = [aside()],
  focusedAsideId = null,
}: {
  asides?: BtwAsideStickyCardItem[];
  focusedAsideId?: string | null;
} = {}) {
  const onFocusAside = vi.fn();
  const onToggleAsideExpanded = vi.fn();
  const onDoneAside = vi.fn();
  const onHideAside = vi.fn();
  const onStopAside = vi.fn();
  const onTransferToComposer = vi.fn();

  render(
    <I18nProvider>
      <BtwAsideStickyCards
        asides={asides}
        focusedAsideId={focusedAsideId}
        onFocusAside={onFocusAside}
        onToggleAsideExpanded={onToggleAsideExpanded}
        onDoneAside={onDoneAside}
        onHideAside={onHideAside}
        onStopAside={onStopAside}
        onTransferToComposer={onTransferToComposer}
      />
    </I18nProvider>,
  );

  return {
    onFocusAside,
    onToggleAsideExpanded,
    onDoneAside,
    onHideAside,
    onStopAside,
    onTransferToComposer,
  };
}

describe("BtwAsideStickyCards", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders nothing for an empty aside list", () => {
    renderCards({ asides: [] });

    expect(screen.queryByRole("region", { name: "/btw asides" })).toBeNull();
  });

  it("wires focus, expand, done, hide, and stop actions", () => {
    const callbacks = renderCards({ focusedAsideId: "aside-1" });

    fireEvent.click(screen.getByRole("button", { name: /check side state/ }));
    expect(callbacks.onFocusAside).toHaveBeenCalledWith("aside-1");

    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    expect(callbacks.onToggleAsideExpanded).toHaveBeenCalledWith("aside-1");

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(callbacks.onDoneAside).toHaveBeenCalledWith("aside-1");

    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(callbacks.onStopAside).toHaveBeenCalledWith("aside-1");

    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(callbacks.onHideAside).toHaveBeenCalledWith("aside-1");
  });

  it("renders expanded transcript and transfers turns to Mother composer", () => {
    const callbacks = renderCards({
      asides: [
        aside({
          expanded: true,
          turns: [
            { id: "request", role: "user", text: "inspect this" },
            { id: "answer", role: "assistant", text: "use this answer" },
          ],
        }),
      ],
    });

    expect(screen.getByText("inspect this")).toBeTruthy();
    expect(screen.getByText("use this answer")).toBeTruthy();

    fireEvent.click(
      screen.getByLabelText("Insert assistant /btw turn into Mother composer"),
    );
    expect(callbacks.onTransferToComposer).toHaveBeenCalledWith(
      "use this answer",
    );
  });
});
