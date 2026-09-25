import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { SessionRightPane } from "../SessionRightPane";

type Pane = ComponentProps<typeof SessionRightPane>["pane"];

function artifactPane(artifactToken?: string): Pane {
  return {
    selected: {
      url: "https://artifact.example.org/review.html",
      sourceUrl: "https://artifact.example.org/review.html",
      label: "review.html",
      announcementId: "play:review",
      artifactToken,
    },
    paneViewer: undefined,
    copyUrl: "https://artifact.example.org/review.html",
    onFrameLoad: vi.fn(),
    frameKey: "vhost:key:review",
    appStatus: undefined,
    expanded: true,
    canKill: true,
    killing: false,
    hide: vi.fn(),
    close: vi.fn(),
    kill: vi.fn(),
  } as unknown as Pane;
}

describe("session right pane", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("reloads an artifact by remounting its frame", () => {
    const { container } = render(
      <I18nProvider>
        <SessionRightPane pane={artifactPane("token")} wide />
      </I18nProvider>,
    );
    const before = container.querySelector("iframe");
    expect(before).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reload from disk" }));
    const after = container.querySelector("iframe");
    expect(after).toBeTruthy();
    expect(after).not.toBe(before);
    expect(after?.getAttribute("src")).toBe(
      "https://artifact.example.org/review.html",
    );
  });

  it("names the reload for a live app rather than a file", () => {
    render(
      <I18nProvider>
        <SessionRightPane pane={artifactPane()} wide />
      </I18nProvider>,
    );
    expect(screen.getByRole("button", { name: "Reload app" })).toBeTruthy();
  });
});
