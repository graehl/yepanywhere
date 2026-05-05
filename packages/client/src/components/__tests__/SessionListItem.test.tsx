// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionListItem } from "../SessionListItem";

const mockWindowOpen = vi.fn();

describe("SessionListItem links", () => {
  beforeEach(() => {
    mockWindowOpen.mockReset();
    vi.stubGlobal("open", mockWindowOpen);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  function renderItem(onNavigate = vi.fn()) {
    render(
      <MemoryRouter>
        <ul>
          <SessionListItem
            sessionId="session-1"
            projectId="project-1"
            title="Build logs"
            mode="compact"
            onNavigate={onNavigate}
            basePath="/remote/test"
          />
        </ul>
      </MemoryRouter>,
    );
    return {
      link: screen.getByRole("link", { name: /Build logs/ }),
      onNavigate,
    };
  }

  it("opens the session in a new window on middle click", () => {
    const { link, onNavigate } = renderItem();

    fireEvent.mouseDown(link, { button: 1 });
    link.dispatchEvent(
      new MouseEvent("auxclick", {
        bubbles: true,
        cancelable: true,
        button: 1,
      }),
    );

    expect(onNavigate).not.toHaveBeenCalled();
    expect(mockWindowOpen).toHaveBeenCalledWith(
      "/remote/test/projects/project-1/sessions/session-1",
      "_blank",
      "noopener",
    );
  });

  it("opens a new window on modified clicks without closing the current view", () => {
    const { link, onNavigate } = renderItem();

    fireEvent.click(link, { ctrlKey: true });

    expect(onNavigate).not.toHaveBeenCalled();
    expect(mockWindowOpen).toHaveBeenCalledWith(
      "/remote/test/projects/project-1/sessions/session-1",
      "_blank",
      "noopener",
    );
  });

  it("labels /btw aside sessions separately from their truncated title text", () => {
    render(
      <MemoryRouter>
        <ul>
          <SessionListItem
            sessionId="aside-1"
            projectId="project-1"
            title="/btw check the side path"
            mode="compact"
          />
        </ul>
      </MemoryRouter>,
    );

    expect(screen.getByText("/btw")).toBeTruthy();
    expect(screen.getByText("check the side path")).toBeTruthy();
  });
});
