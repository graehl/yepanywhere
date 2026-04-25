import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionMetadataProvider } from "../../../../contexts/SessionMetadataContext";
import { editRenderer } from "../EditRenderer";

vi.mock("../../../../contexts/SchemaValidationContext", () => ({
  useSchemaValidationContext: () => ({
    enabled: false,
    reportValidationError: vi.fn(),
    isToolIgnored: vi.fn(() => false),
    ignoreToolErrors: vi.fn(),
    clearIgnoredTools: vi.fn(),
    ignoredTools: [],
  }),
}));

const renderContext = {
  isStreaming: false,
  theme: "dark" as const,
};
if (!editRenderer.renderCollapsedPreview) {
  throw new Error("Edit renderer must provide collapsed preview");
}
const renderCollapsedPreview = editRenderer.renderCollapsedPreview;

describe("EditRenderer collapsed preview fallback", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders raw patch text for completed rows when structured patch is missing", () => {
    const input = {
      _rawPatch: [
        "*** Begin Patch",
        "*** Update File: src/example.ts",
        "@@",
        "-const x = 1;",
        "+const x = 2;",
        "*** End Patch",
      ].join("\n"),
    };

    render(
      <div>
        {renderCollapsedPreview(
          input as never,
          { ok: true } as never,
          false,
          renderContext,
        )}
      </div>,
    );

    expect(screen.queryByText("Computing diff...")).toBeNull();
    expect(screen.getByText(/\*\*\* Begin Patch/)).toBeDefined();
  });

  it("keeps pending classic Edit rows on Computing diff...", () => {
    const input = {
      file_path: "src/example.ts",
      old_string: "const x = 1;",
      new_string: "const x = 2;",
    };

    render(
      <div>
        {renderCollapsedPreview(
          input as never,
          undefined,
          false,
          renderContext,
        )}
      </div>,
    );

    expect(screen.getByText("Computing diff...")).toBeDefined();
  });

  it("keeps structured diff rendering unchanged when structured patch exists", () => {
    const input = {
      _structuredPatch: [
        {
          oldStart: 1,
          oldLines: 1,
          newStart: 1,
          newLines: 1,
          lines: ["-const x = 1;", "+const x = 2;"],
        },
      ],
    };

    render(
      <div>
        {renderCollapsedPreview(
          input as never,
          undefined,
          false,
          renderContext,
        )}
      </div>,
    );

    expect(screen.queryByText("Computing diff...")).toBeNull();
    expect(screen.getByText("-const x = 1;")).toBeDefined();
    expect(screen.getByText("+const x = 2;")).toBeDefined();
  });

  it("renders completed markdown table edits through the render toggle", () => {
    const structuredPatch = [
      {
        oldStart: 1,
        oldLines: 3,
        newStart: 1,
        newLines: 3,
        lines: [
          " | name | value |",
          " | --- | --- |",
          "-| old | $x^2$ |",
          "+| new | $y^2$ |",
        ],
      },
    ];

    const { container } = render(
      <div>
        {renderCollapsedPreview(
          {
            _structuredPatch: structuredPatch,
          } as never,
          {
            filePath: "notes.md",
            structuredPatch,
          } as never,
          false,
          renderContext,
        )}
      </div>,
    );

    expect(screen.getByRole("table")).toBeDefined();
    expect(screen.getByText("old")).toBeDefined();
    expect(screen.getByText("new")).toBeDefined();
    expect(container.querySelector(".katex")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Show source" }));

    expect(container.textContent).toContain("-| old | $x^2$ |");
  });

  it("renders markdown headings and inline markup in completed edits", () => {
    const structuredPatch = [
      {
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 2,
        lines: ["-old text", "+## Findings", "+- **win** in `dev`"],
      },
    ];

    const { container } = render(
      <div>
        {renderCollapsedPreview(
          {
            _structuredPatch: structuredPatch,
          } as never,
          {
            filePath: "notes.md",
            structuredPatch,
          } as never,
          false,
          renderContext,
        )}
      </div>,
    );

    expect(screen.getByText("Findings")).toBeDefined();
    expect(container.querySelector(".fixed-font-markdown-heading")).toBeTruthy();
    expect(container.querySelector("strong")?.textContent).toBe("win");
    expect(container.querySelector("code")?.textContent).toBe("dev");
    const gutters = Array.from(
      container.querySelectorAll(".fixed-font-diff-gutter"),
    ).map((node) => node.textContent);
    expect(gutters).toContain("+");
    expect(gutters).toContain("-");
  });

  it("renders headerless markdown table edit hunks", () => {
    const structuredPatch = [
      {
        oldStart: 1,
        oldLines: 2,
        newStart: 1,
        newLines: 3,
        lines: [
          "@@ -1,2 +1,3 @@",
          "-| `POL-E2P-Q35-BASE` | `en->pl` | Qwen3.5-4B base | 200 | 3.1581 | 290.64 tok/s / 7,598 tok |",
          "-| `POL-E2P-TG4B-BASE` | `en->pl` | TranslateGemma-4B base | 200 | **2.7577** | 235.79 tok/s / 7,726 tok |",
          "+| `POL-E2P-EURO-BASE` | `en->pl` | EuroLLM-9B base | 200 | **2.5526** | 98.89 tok/s / 6,527 tok |",
          "+| `POL-E2P-Q35-BASE` | `en->pl` | Qwen3.5-4B base | 200 | 3.1581 | 290.64 tok/s / 7,598 tok |",
          "+| `POL-E2P-TG4B-BASE` | `en->pl` | TranslateGemma-4B base | 200 | 2.7577 | 235.79 tok/s / 7,726 tok |",
        ],
      },
    ];

    const { container } = render(
      <div>
        {renderCollapsedPreview(
          {
            _structuredPatch: structuredPatch,
          } as never,
          {
            filePath: "research/conditioned-diversity.md",
            structuredPatch,
          } as never,
          false,
          renderContext,
        )}
      </div>,
    );

    expect(screen.getByRole("table")).toBeDefined();
    expect(screen.getByText("POL-E2P-EURO-BASE")).toBeDefined();
    expect(
      Array.from(container.querySelectorAll("strong")).map(
        (node) => node.textContent,
      ),
    ).toContain("2.5526");
    expect(container.querySelectorAll("tbody tr")).toHaveLength(5);
  });

  it("resolves markdown links in edit table cells relative to the edited file", () => {
    const structuredPatch = [
      {
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 3,
        lines: [
          "+| Ref | Artifacts |",
          "+| --- | --- |",
          "+| `PILOT` | [decode](../untracked/pilot.meta.md) |",
        ],
      },
    ];

    render(
      <SessionMetadataProvider
        projectId="project-1"
        projectPath="/repo"
        sessionId="session-1"
      >
        {renderCollapsedPreview(
          {
            _structuredPatch: structuredPatch,
          } as never,
          {
            filePath: "research/conditioned-diversity.md",
            structuredPatch,
          } as never,
          false,
          renderContext,
        )}
      </SessionMetadataProvider>,
    );

    const link = screen.getByRole("link", { name: "decode" });
    expect(link.getAttribute("data-fixed-font-file-path")).toBe(
      "untracked/pilot.meta.md",
    );
  });

  it("renders server-provided highlighted diff HTML when available", () => {
    const input = {
      _structuredPatch: [
        {
          oldStart: 1,
          oldLines: 1,
          newStart: 1,
          newLines: 1,
          lines: ["-const x = 1;", "+const x = 2;"],
        },
      ],
      _diffHtml:
        '<pre class="shiki"><code class="language-ts"><span class="line line-deleted"><span class="diff-prefix">-</span><span style="color:var(--shiki-token-keyword)">const</span> x = 1;</span>\n<span class="line line-inserted"><span class="diff-prefix">+</span><span style="color:var(--shiki-token-keyword)">const</span> x = 2;</span></code></pre>',
    };

    const { container } = render(
      <div>
        {renderCollapsedPreview(
          input as never,
          { ok: true } as never,
          false,
          renderContext,
        )}
      </div>,
    );

    expect(screen.queryByText("Computing diff...")).toBeNull();
    expect(
      container.querySelector(".highlighted-diff .line-inserted"),
    ).toBeTruthy();
    expect(screen.getAllByText(/const/)).toHaveLength(2);
  });

  it("renders stable fallback text when completed row has no patch data", () => {
    const input = {};

    render(
      <div>
        {renderCollapsedPreview(
          input as never,
          { ok: true } as never,
          false,
          renderContext,
        )}
      </div>,
    );

    expect(screen.queryByText("Computing diff...")).toBeNull();
    expect(screen.getByText("Patch preview unavailable")).toBeDefined();
  });

  it("derives filename from raw patch when file_path is missing", () => {
    const summary = editRenderer.getUseSummary?.({
      _rawPatch: [
        "*** Begin Patch",
        "*** Update File: packages/client/src/components/Foo.tsx",
        "@@",
        "-const x = 1;",
        "+const x = 2;",
        "*** End Patch",
      ].join("\n"),
    } as never);

    expect(summary).toBe("Foo.tsx");
  });

  it("shows raw patch filename in interactive summary when file_path is missing", () => {
    if (!editRenderer.renderInteractiveSummary) {
      throw new Error("Edit renderer must provide interactive summary");
    }

    render(
      <div>
        {editRenderer.renderInteractiveSummary(
          {
            _rawPatch: [
              "*** Begin Patch",
              "*** Update File: packages/client/src/components/Foo.tsx",
              "@@",
              "-const x = 1;",
              "+const x = 2;",
              "*** End Patch",
            ].join("\n"),
            _structuredPatch: [
              {
                oldStart: 1,
                oldLines: 1,
                newStart: 1,
                newLines: 1,
                lines: ["-const x = 1;", "+const x = 2;"],
              },
            ],
          } as never,
          undefined,
          false,
          renderContext,
        )}
      </div>,
    );

    expect(screen.getByRole("button", { name: /Foo\.tsx/i })).toBeDefined();
  });
});
