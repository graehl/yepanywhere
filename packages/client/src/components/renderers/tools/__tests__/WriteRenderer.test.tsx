import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UI_KEYS } from "../../../../lib/storageKeys";
import { writeRenderer } from "../WriteRenderer";

vi.mock("../../../../contexts/SchemaValidationContext", () => ({
  useSchemaValidationContext: () => ({
    enabled: false,
    reportValidationError: vi.fn(),
    isToolIgnored: vi.fn(() => false),
  }),
}));

const renderContext = {
  isStreaming: false,
  theme: "dark" as const,
};

describe("WriteRenderer", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.removeItem(UI_KEYS.tooltipMode);
  });

  it("reveals the omitted tail from a faded Write preview", () => {
    const content = ["line 1", "line 2", "line 3", "line 4", "line 5"].join(
      "\n",
    );
    const { container } = render(
      <div>
        {writeRenderer.renderCollapsedPreview?.(
          { file_path: "notes.txt", content },
          undefined,
          false,
          renderContext,
        )}
      </div>,
    );

    const fadedPreview = container.querySelector(".write-preview-content");
    expect(fadedPreview?.getAttribute("data-tooltip")).toBe(
      "...\nline 3\nline 4\nline 5",
    );
    expect(fadedPreview?.getAttribute("title")).toBeNull();
  });

  it("shows full unfaded file content when its preview is off-screen", () => {
    const content = "one short line";
    const { container } = render(
      <div>
        {writeRenderer.renderCollapsedPreview?.(
          { file_path: "notes.txt", content },
          undefined,
          false,
          renderContext,
        )}
      </div>,
    );

    const preview = container.querySelector<HTMLElement>(
      ".write-preview-content",
    );
    expect(preview).toBeTruthy();
    expect(preview?.classList).not.toContain("write-preview-truncated");
    Object.defineProperties(preview, {
      clientWidth: { configurable: true, value: 300 },
      clientHeight: { configurable: true, value: 20 },
      scrollWidth: { configurable: true, value: 300 },
      scrollHeight: { configurable: true, value: 20 },
      getBoundingClientRect: {
        configurable: true,
        value: () => ({
          x: 0,
          y: window.innerHeight - 10,
          left: 0,
          top: window.innerHeight - 10,
          right: 300,
          bottom: window.innerHeight + 10,
          width: 300,
          height: 20,
          toJSON: () => ({}),
        }),
      },
    });

    fireEvent.pointerEnter(preview as HTMLElement);

    expect(preview?.getAttribute("data-tooltip")).toBe(content);
    expect(preview?.getAttribute("title")).toBeNull();
  });
});
