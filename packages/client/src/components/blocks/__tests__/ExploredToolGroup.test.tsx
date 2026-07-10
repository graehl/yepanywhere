import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { toUrlProjectId } from "@yep-anywhere/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionMetadataProvider } from "../../../contexts/SessionMetadataContext";
import { I18nProvider } from "../../../i18n";
import { buildAssistantRenderSegments } from "../../../lib/sessionDetail/renderSelectors";
import type { Message } from "../../../types";
import type { RenderItem, ToolCallItem } from "../../../types/renderItems";
import { ExploredToolGroup } from "../ExploredToolGroup";

vi.mock("../../../contexts/SchemaValidationContext", () => ({
  useSchemaValidationContext: () => ({
    enabled: false,
    reportValidationError: vi.fn(),
    isToolIgnored: vi.fn(() => false),
  }),
}));

const projectRoot = "/local/graehl/yepanywhere";
const projectId = toUrlProjectId(projectRoot);

function sourceMessage(id: string, timestamp: string): Message {
  return {
    type: "assistant",
    uuid: id,
    timestamp,
    message: { role: "assistant", content: "" },
  };
}

function toolCall(
  id: string,
  toolName: string,
  toolInput: unknown,
  timestamp = "2026-05-28T00:00:00.000Z",
  toolResult?: ToolCallItem["toolResult"],
): ToolCallItem {
  return {
    type: "tool_call",
    id,
    toolName,
    toolInput,
    toolResult,
    status: toolResult ? "complete" : "pending",
    sourceMessages: [sourceMessage(`msg-${id}`, timestamp)],
  };
}

function projectionFor(items: ToolCallItem[]) {
  const segment = buildAssistantRenderSegments(items).find(
    (candidate) => candidate.kind === "explored",
  );
  if (segment?.kind !== "explored") {
    throw new Error("Expected explored projection");
  }
  return segment.projection;
}

describe("ExploredToolGroup", () => {
  afterEach(() => {
    cleanup();
  });

  it("groups adjacent read/search/list calls but not distant ones", () => {
    const read = toolCall("read-1", "Read", { file_path: "README.md" });
    const grep = toolCall("grep-1", "Grep", { pattern: "needle" });
    const text: RenderItem = {
      type: "text",
      id: "text-1",
      text: "done",
      sourceMessages: [sourceMessage("msg-text", "2026-05-28T00:00:02.000Z")],
    };
    const oldGlob = toolCall(
      "glob-1",
      "Glob",
      { pattern: "*.ts" },
      "2026-05-28T00:10:00.000Z",
    );
    const lateLs = toolCall(
      "ls-1",
      "LS",
      { path: "packages/client" },
      "2026-05-28T00:20:30.000Z",
    );

    const segments = buildAssistantRenderSegments([
      read,
      grep,
      text,
      oldGlob,
      lateLs,
    ]);

    expect(segments.map((segment) => segment.kind)).toEqual([
      "explored",
      "item",
      "item",
      "item",
    ]);
    expect(segments[0]?.kind === "explored" && segments[0].items).toEqual([
      read,
      grep,
    ]);
  });

  it("renders compact labels and keeps read summaries clickable", () => {
    const read = toolCall(
      "read-1",
      "Read",
      { file_path: "topics/rich-text-rendering.md" },
      "2026-05-28T00:00:00.000Z",
      {
        content: "file contents",
        isError: false,
        structured: {
          type: "text",
          file: {
            filePath: "topics/rich-text-rendering.md",
            content: "line\n".repeat(141),
            numLines: 141,
            startLine: 1,
            totalLines: 141,
          },
        },
      },
    );
    const search = toolCall(
      "grep-1",
      "Grep",
      {
        pattern: "tool|bash",
        path: "packages/client/src",
      },
      "2026-05-28T00:00:00.000Z",
      {
        content: "",
        isError: false,
        structured: {
          mode: "files_with_matches",
          filenames: [],
          numFiles: 0,
        },
      },
    );
    const list = toolCall("ls-1", "list_dir", {
      target_directory: "packages/client/src",
    });

    const { container } = render(
      <I18nProvider>
        <SessionMetadataProvider
          projectId={projectId}
          projectPath={projectRoot}
          sessionId="session-1"
        >
          <ExploredToolGroup
            id="explored-test"
            projection={projectionFor([read, search, list])}
          />
        </SessionMetadataProvider>
      </I18nProvider>,
    );

    expect(screen.getByText("Exploring")).toBeDefined();
    expect(screen.getByText("Read")).toBeDefined();
    expect(screen.getByText("Grep")).toBeDefined();
    expect(screen.getByText("List")).toBeDefined();
    const readLink = screen.getByRole("link", {
      name: /rich-text-rendering\.md/i,
    });
    expect(readLink.getAttribute("href")).toBe(
      `/projects/${projectId}/file?path=topics%2Frich-text-rendering.md`,
    );
    const grepSummary = container.querySelector(
      '[data-render-id="grep-1"] .grep-inline-summary',
    );
    const grepPattern = grepSummary?.querySelector(
      ".grep-summary-pattern-clip",
    );
    expect(grepPattern?.textContent).toBe("tool|bash");
    expect(grepPattern?.getAttribute("title")).toBe(
      "tool|bash in packages/client/src",
    );
    const grepScopeLink =
      grepSummary?.querySelector<HTMLAnchorElement>("a.file-path-link");
    expect(grepScopeLink?.textContent).toBe("src");
    expect(grepScopeLink?.getAttribute("href")).toBe(
      `/projects/${projectId}/file?path=packages%2Fclient%2Fsrc`,
    );
    expect(screen.getByText("0 matches")).toBeDefined();
    expect(screen.getByText("packages/client/src")).toBeDefined();

    fireEvent.click(
      screen.getByRole("button", { name: "Collapse explored tools" }),
    );

    expect(screen.queryByText("Grep")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Expand explored tools" }),
    ).toBeDefined();
  });

  it("compacts Windows project paths in pending explored rows", () => {
    const windowsProjectRoot = "C:\\Users\\user\\Documents\\code\\playbox";
    const windowsProjectId = toUrlProjectId(windowsProjectRoot);
    const read = toolCall("read-1", "Read", {
      file_path: `${windowsProjectRoot}\\docs\\tactical\\note.md`,
    });
    const search = toolCall("grep-1", "Grep", {
      pattern: "needle",
      path: `${windowsProjectRoot}\\src\\renderer`,
    });
    const list = toolCall("list-1", "list_dir", {
      target_directory: `${windowsProjectRoot}\\packages\\client`,
    });

    render(
      <I18nProvider>
        <SessionMetadataProvider
          projectId={windowsProjectId}
          projectPath={windowsProjectRoot}
          sessionId="session-1"
        >
          <ExploredToolGroup
            id="explored-test"
            projection={projectionFor([read, search, list])}
          />
        </SessionMetadataProvider>
      </I18nProvider>,
    );

    expect(screen.getByText("note.md")).toBeDefined();
    expect(screen.getByText("needle in src/renderer")).toBeDefined();
    expect(screen.getByText("packages/client")).toBeDefined();
    expect(screen.queryByText(/C:\\Users\\user/)).toBeNull();
  });

  it("lets explored grep match counts open a match table", () => {
    const read = toolCall(
      "read-1",
      "Read",
      { file_path: "README.md" },
      "2026-05-28T00:00:00.000Z",
      {
        content: "file contents",
        isError: false,
        structured: {
          type: "text",
          file: {
            filePath: "README.md",
            content: "line\n".repeat(3),
            numLines: 3,
            startLine: 1,
            totalLines: 3,
          },
        },
      },
    );
    const search = toolCall(
      "grep-1",
      "Grep",
      { pattern: "needle", path: "src", output_mode: "content" },
      "2026-05-28T00:00:00.000Z",
      {
        content: "",
        isError: false,
        structured: {
          mode: "content",
          filenames: [],
          numFiles: 2,
          content: "src/a.ts:12:const needle = true;\nsrc/b.ts:7:needle again",
          matches: [
            {
              filePath: "src/a.ts",
              lineNumber: 12,
              text: "const needle = true;",
              ranges: [{ start: 6, end: 12 }],
            },
            {
              filePath: "src/b.ts",
              lineNumber: 7,
              text: "needle again",
              ranges: [{ start: 0, end: 6 }],
            },
          ],
        },
      },
    );

    const { container } = render(
      <I18nProvider>
        <SessionMetadataProvider
          projectId={projectId}
          projectPath={projectRoot}
          sessionId="session-1"
        >
          <ExploredToolGroup
            id="explored-test"
            projection={projectionFor([read, search])}
          />
        </SessionMetadataProvider>
      </I18nProvider>,
    );

    const grepSummary = container.querySelector(
      '[data-render-id="grep-1"] .grep-inline-summary',
    );
    const grepPattern = grepSummary?.querySelector(
      ".grep-summary-pattern-clip",
    );
    expect(grepPattern?.textContent).toBe("needle");
    expect(grepPattern?.getAttribute("title")).toBe("needle in src");
    const grepScopeLink =
      grepSummary?.querySelector<HTMLAnchorElement>("a.file-path-link");
    expect(grepScopeLink?.textContent).toBe("src");
    expect(grepScopeLink?.getAttribute("href")).toBe(
      `/projects/${projectId}/file?path=src`,
    );
    fireEvent.click(screen.getByRole("button", { name: "2 matches" }));

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("src/a.ts")).toBeDefined();
    expect(screen.getByText("12")).toBeDefined();
    expect(document.querySelectorAll(".grep-match-highlight")).toHaveLength(2);
  });

  it("renders one multi-action parent compactly and reveals one raw result owner", () => {
    const command = [
      "sed -n '1,100p' src/session.ts",
      "sed -n '101,200p' src/session.ts",
      "sed -n '1,80p' src/driver.ts",
    ].join(" && ");
    const compound = {
      ...toolCall(
        "call-three-reads",
        "Bash",
        { command, cwd: projectRoot },
        "2026-05-28T00:00:00.000Z",
        {
          content: "combined output once",
          isError: false,
          structured: {
            stdout: "combined output once",
            stderr: "",
            interrupted: false,
            isImage: false,
          },
        },
      ),
      displayActions: [
        {
          kind: "read" as const,
          path: "src/session.ts",
          absolutePath: `${projectRoot}/src/session.ts`,
          name: "session.ts",
          startLine: 1,
          endLine: 100,
        },
        {
          kind: "read" as const,
          path: "src/session.ts",
          absolutePath: `${projectRoot}/src/session.ts`,
          name: "session.ts",
          startLine: 101,
          endLine: 200,
        },
        {
          kind: "read" as const,
          path: "src/driver.ts",
          absolutePath: `${projectRoot}/src/driver.ts`,
          name: "driver.ts",
          startLine: 1,
          endLine: 80,
        },
      ],
    } satisfies ToolCallItem;
    const projection = projectionFor([compound]);

    const { container } = render(
      <I18nProvider>
        <SessionMetadataProvider
          projectId={projectId}
          projectPath={projectRoot}
          sessionId="session-1"
        >
          <ExploredToolGroup
            id={projection.id}
            projection={projection}
            sessionProvider="codex"
          />
        </SessionMetadataProvider>
      </I18nProvider>,
    );

    expect(screen.getByText("Explored")).toBeDefined();
    expect(screen.getByText("3 items")).toBeDefined();
    expect(screen.getAllByText("Read")).toHaveLength(3);
    expect(screen.getByText("lines 1-100")).toBeDefined();
    expect(screen.getByText("lines 101-200")).toBeDefined();
    expect(screen.getByText("lines 1-80")).toBeDefined();
    expect(screen.queryByText(command)).toBeNull();
    expect(screen.queryByText("combined output once")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Show command details" }),
    );

    expect(screen.getByText("Ran")).toBeDefined();
    expect(screen.getAllByText(command)).toHaveLength(1);
    expect(screen.getAllByText("combined output once")).toHaveLength(1);
    expect(container.querySelectorAll(".explored-parent-raw")).toHaveLength(1);
  });
});
