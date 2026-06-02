import { cleanup, render, waitFor } from "@testing-library/react";
import type { FileContentResponse } from "@yep-anywhere/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { FileViewer, type FileViewerSource } from "../FileViewer";

const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;

describe("FileViewer", () => {
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    if (originalScrollIntoView) {
      Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
        configurable: true,
        value: originalScrollIntoView,
      });
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
    }
  });

  it("marks and scrolls a line range in highlighted source", async () => {
    const fileResponse: FileContentResponse = {
      metadata: {
        path: "src/App.ts",
        size: 64,
        mimeType: "text/typescript",
        isText: true,
      },
      rawUrl: "",
      content: "one\ntwo\nthree\nfour\n",
      highlightedHtml:
        '<pre class="shiki"><code><span class="line">one</span>\n<span class="line">two</span>\n<span class="line">three</span>\n<span class="line">four</span></code></pre>',
      highlightedLanguage: "typescript",
    };
    const source: FileViewerSource = {
      loadFile: vi.fn(async () => fileResponse),
    };

    const { container } = render(
      <I18nProvider>
        <FileViewer
          projectId="project-id"
          filePath="src/App.ts"
          lineNumber={2}
          lineEnd={3}
          source={source}
        />
      </I18nProvider>,
    );

    await waitFor(() => {
      expect(container.querySelector(".highlighted-line-start")).not.toBeNull();
    });

    expect(
      container
        .querySelector(".highlighted-line-start")
        ?.getAttribute("data-line"),
    ).toBe("2");
    expect(
      container
        .querySelector(".highlighted-line-end")
        ?.getAttribute("data-line"),
    ).toBe("3");
    const code = container.querySelector(".shiki-container code");
    expect(
      Array.from(code?.childNodes ?? []).some(
        (node) => node.nodeType === Node.TEXT_NODE && node.textContent === "\n",
      ),
    ).toBe(false);
    expect(container.querySelector(".highlighted-line")).toBeNull();
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it("paints a single highlighted line", async () => {
    const fileResponse: FileContentResponse = {
      metadata: {
        path: "src/App.ts",
        size: 64,
        mimeType: "text/typescript",
        isText: true,
      },
      rawUrl: "",
      content: "one\ntwo\nthree\n",
      contentStartLine: 40,
      highlightedHtml:
        '<pre class="shiki"><code><span class="line">one</span>\n<span class="line">two</span>\n<span class="line">three</span></code></pre>',
      highlightedLanguage: "typescript",
    };
    const source: FileViewerSource = {
      loadFile: vi.fn(async () => fileResponse),
    };

    const { container } = render(
      <I18nProvider>
        <FileViewer
          projectId="project-id"
          filePath="src/App.ts"
          lineNumber={41}
          source={source}
        />
      </I18nProvider>,
    );

    await waitFor(() => {
      expect(container.querySelector(".highlighted-line")).not.toBeNull();
    });

    expect(
      container.querySelector(".highlighted-line")?.getAttribute("data-line"),
    ).toBe("41");
    expect(container.querySelector(".highlighted-line-start")).not.toBeNull();
    expect(container.querySelector(".highlighted-line-end")).not.toBeNull();
  });

  it("shows actual file line numbers in plain range windows", async () => {
    const fileResponse: FileContentResponse = {
      metadata: {
        path: "logs/session.txt",
        size: 64,
        mimeType: "text/plain",
        isText: true,
      },
      rawUrl: "",
      content: "alpha\nbeta\ngamma",
      contentStartLine: 40,
      contentEndLine: 42,
    };
    const source: FileViewerSource = {
      loadFile: vi.fn(async () => fileResponse),
    };

    const { container } = render(
      <I18nProvider>
        <FileViewer
          projectId="project-id"
          filePath="logs/session.txt"
          lineNumber={41}
          lineEnd={42}
          viewMode="range"
          source={source}
        />
      </I18nProvider>,
    );

    await waitFor(() => {
      expect(container.querySelector(".code-highlighter-plain")).not.toBeNull();
    });

    const gutter = Array.from(
      container.querySelectorAll(".code-line-numbers > div"),
    ).map((node) => node.textContent);
    expect(gutter).toEqual(["40", "41", "42"]);
    expect(
      container
        .querySelector(".highlighted-line-start")
        ?.getAttribute("data-line"),
    ).toBe("41");
    expect(
      container
        .querySelector(".highlighted-line-end")
        ?.getAttribute("data-line"),
    ).toBe("42");
  });
});
