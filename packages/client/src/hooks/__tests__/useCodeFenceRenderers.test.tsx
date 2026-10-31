import {
  render as renderComponent,
  screen,
  waitFor,
} from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { RenderModeGlyph } from "../../components/ui/RenderModeGlyph";
import { UI_KEYS } from "../../lib/storageKeys";
import {
  codeFenceRootClass,
  useCodeFenceRenderers,
} from "../useCodeFenceRenderers";
import { initializeTheme } from "../useTheme";
import { I18nProvider } from "../../i18n";

const render = (
  ui: Parameters<typeof renderComponent>[0],
  options?: Parameters<typeof renderComponent>[1],
) => renderComponent(ui, { wrapper: I18nProvider, ...options });

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async (_id: string, source: string) => {
      if (!source.includes("-->")) {
        throw new Error("incomplete diagram");
      }
      return { svg: `<svg aria-label="diagram">${source}</svg>` };
    }),
  },
}));

function Harness({ html }: { html: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useCodeFenceRenderers(ref);
  return (
    <div
      data-testid="root"
      className={codeFenceRootClass}
      ref={ref}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: test fixture stands in for server-rendered markup
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function codeBlock(language: string, source: string): string {
  return `<pre class="shiki"><code class="language-${language}">${source}</code></pre>`;
}

describe("useCodeFenceRenderers", () => {
  describe("copy control", () => {
    it("copies the fence content verbatim, labeled or not", async () => {
      const writeText = vi.fn(async () => {});
      vi.stubGlobal("navigator", {
        ...navigator,
        language: navigator.language,
        clipboard: { writeText },
      });
      try {
        render(
          <Harness
            html={`${codeBlock(
              "text",
              "  indented line\n\nsecond &lt;line&gt;",
            )}<pre class="shiki"><code>bare fence</code></pre>`}
          />,
        );
        const buttons = screen.getAllByRole("button", { name: "Copy code" });
        expect(buttons).toHaveLength(2);
        // The control adds no text to the block it sits in.
        expect(
          screen.getByTestId("root").querySelector("pre")?.textContent,
        ).toBe("  indented line\n\nsecond <line>");

        buttons[0]?.click();
        await waitFor(() =>
          expect(writeText).toHaveBeenCalledWith(
            "  indented line\n\nsecond <line>",
          ),
        );
        await waitFor(() =>
          expect(buttons[0]?.dataset.yaCodeCopied).toBe("true"),
        );
        buttons[1]?.click();
        await waitFor(() =>
          expect(writeText).toHaveBeenLastCalledWith("bare fence"),
        );
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });

  describe("language label", () => {
    it("labels a block with its language", () => {
      render(<Harness html={codeBlock("typescript", "const a = 1;")} />);

      const pre = screen.getByTestId("root").querySelector("pre");
      expect(pre?.dataset.yaCodeLanguage).toBe("typescript");
      expect(pre?.getAttribute("aria-label")).toBe("typescript code block");
      // The stylesheet shows the label; a native tooltip would duplicate it.
      expect(pre?.hasAttribute("title")).toBe(false);
    });

    it("leaves a block with no language class alone", () => {
      render(<Harness html='<pre class="shiki"><code>plain</code></pre>' />);

      const pre = screen.getByTestId("root").querySelector("pre");
      expect(pre?.dataset.yaCodeLanguage).toBeUndefined();
      expect(pre?.hasAttribute("title")).toBe(false);
    });

    it("reveals the label on tap and hides it again", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        render(<Harness html={codeBlock("python", "x = 1")} />);
        const pre = screen.getByTestId("root").querySelector("pre");
        if (!pre) throw new Error("missing pre");

        pre.click();
        expect(pre.dataset.yaCodeLanguageShown).toBe("1");

        vi.advanceTimersByTime(3000);
        expect(pre.dataset.yaCodeLanguageShown).toBeUndefined();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("mermaid blocks", () => {
    it("renders a diagram and hides the source", async () => {
      render(<Harness html={codeBlock("mermaid", "graph TD\nA --&gt; B")} />);

      const block = await waitFor(() => {
        const found = screen
          .getByTestId("root")
          .querySelector("[data-ya-code-block]");
        if (!found) throw new Error("not mounted yet");
        return found as HTMLElement;
      });

      expect(block.dataset.yaCodeView).toBe("rendered");
      expect(block.querySelector("[data-ya-code-rendered] svg")).not.toBeNull();
      // The source is still present, just not the visible view.
      expect(block.querySelector("pre")).not.toBeNull();
    });

    it("toggles between the diagram and its source", async () => {
      render(
        <Harness html={codeBlock("mermaid", "graph LR\nToggle --&gt; Me")} />,
      );

      const toggle = await screen.findByRole("button", {
        name: "Show diagram source",
      });
      expect(toggle.getAttribute("aria-pressed")).toBe("true");

      toggle.click();
      const block = toggle.closest("[data-ya-code-block]") as HTMLElement;
      expect(block.dataset.yaCodeView).toBe("source");
      expect(toggle.getAttribute("aria-pressed")).toBe("false");
      expect(toggle.getAttribute("aria-label")).toBe("Show diagram");

      toggle.click();
      expect(block.dataset.yaCodeView).toBe("rendered");
      expect(toggle.getAttribute("aria-pressed")).toBe("true");
    });

    it("draws the same glyph a React render-mode toggle draws", async () => {
      render(
        <Harness html={codeBlock("mermaid", "graph LR\nGlyph --&gt; Me")} />,
      );
      const toggle = await screen.findByRole("button", {
        name: "Show diagram source",
      });

      const { container } = render(<RenderModeGlyph />);

      expect(toggle.querySelector("svg")?.outerHTML).toBe(
        container.querySelector("svg")?.outerHTML,
      );
    });

    it("leaves source in place when the diagram does not parse", async () => {
      render(<Harness html={codeBlock("mermaid", "graph TD")} />);

      const root = screen.getByTestId("root");
      await waitFor(() => {
        expect(
          root.querySelector("pre")?.dataset.yaRenderAttempt,
        ).toBeDefined();
      });

      expect(root.querySelector("[data-ya-code-block]")).toBeNull();
      expect(root.querySelector("pre")).not.toBeNull();
      // Still labelled, so the language remains discoverable.
      expect(root.querySelector("pre")?.dataset.yaCodeLanguage).toBe("mermaid");
    });

    it("retries when a streaming block's source grows into a valid diagram", async () => {
      const { rerender } = render(
        <Harness html={codeBlock("mermaid", "graph TD\nStream")} />,
      );

      const root = screen.getByTestId("root");
      await waitFor(() => {
        expect(
          root.querySelector("pre")?.dataset.yaRenderAttempt,
        ).toBeDefined();
      });
      expect(root.querySelector("[data-ya-code-block]")).toBeNull();

      rerender(
        <Harness html={codeBlock("mermaid", "graph TD\nStream --&gt; Done")} />,
      );

      await waitFor(() => {
        expect(
          screen.getByTestId("root").querySelector("[data-ya-code-rendered]"),
        ).not.toBeNull();
      });
    });

    it("redraws in the page's appearance when another tab switches theme", async () => {
      localStorage.setItem(UI_KEYS.theme, "dark");
      initializeTheme();
      render(
        <Harness html={codeBlock("mermaid", "graph LR\nOther --&gt; Tab")} />,
      );
      const block = await waitFor(() => {
        const found = screen
          .getByTestId("root")
          .querySelector<HTMLElement>("[data-ya-code-block]");
        if (!found) throw new Error("not mounted yet");
        return found;
      });
      expect(block.dataset.yaRenderKey).toContain("|dark|");

      localStorage.setItem(UI_KEYS.theme, "light");
      window.dispatchEvent(
        new StorageEvent("storage", { key: UI_KEYS.theme, newValue: "light" }),
      );

      expect(document.documentElement.getAttribute("data-theme")).toBe("light");
      await waitFor(() => {
        expect(block.dataset.yaRenderKey).toContain("|light|");
      });
    });
  });
});
