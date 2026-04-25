import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToolCallRow } from "../ToolCallRow";

vi.mock("../../../contexts/SchemaValidationContext", () => ({
  useSchemaValidationContext: () => ({
    enabled: false,
    reportValidationError: vi.fn(),
    isToolIgnored: vi.fn(() => false),
  }),
}));

describe("ToolCallRow", () => {
  afterEach(() => {
    cleanup();
  });

  it("keeps pending Codex Bash rows collapsed without IN/OUT preview cards", () => {
    const { container } = render(
      <ToolCallRow
        id="tool-1"
        toolName="Bash"
        toolInput={{ command: "npm run test:e2e:pipeline-v2" }}
        status="pending"
        sessionProvider="codex"
      />,
    );

    expect(screen.getByText("Bash")).toBeDefined();
    expect(screen.getByText("npm run test:e2e:pipeline-v2")).toBeDefined();
    expect(container.querySelector(".tool-row-collapsed-preview")).toBeNull();
    expect(container.querySelector(".tool-use-expanded")).toBeNull();
  });

  it("shows completed Codex Bash markdown output as a renderable preview", () => {
    const output = [
      "diff --git a/notes.md b/notes.md",
      "@@ -1,2 +1,2 @@",
      "-## Old",
      "+## New",
      "+- **done** in `dev`",
    ].join("\n");

    const { container } = render(
      <ToolCallRow
        id="tool-markdown-bash"
        toolName="Bash"
        toolInput={{ command: "git diff -- notes.md" }}
        toolResult={{
          structured: {
            stdout: output,
            stderr: "",
            interrupted: false,
            isImage: false,
          },
          content: output,
          isError: false,
        }}
        status="complete"
        sessionProvider="codex"
      />,
    );

    expect(container.querySelector(".tool-row-collapsed-preview")).not.toBeNull();
    expect(screen.getByText("New")).toBeDefined();
    expect(container.querySelector(".fixed-font-markdown-heading")).toBeTruthy();
    expect(container.querySelector("strong")?.textContent).toBe("done");
    expect(
      container.querySelector(".fixed-font-rendered__content code")?.textContent,
    ).toBe("dev");
    expect(container.querySelector(".expand-chevron")).toBeNull();
  });

  it("shows PTY-backed read shell rows inline without requiring expansion", () => {
    const { container } = render(
      <ToolCallRow
        id="tool-pty-read"
        toolName="WriteStdin"
        toolInput={{
          session_id: 37863,
          chars: "",
          linked_tool_name: "Read",
          linked_file_path: "packages/client/src/hooks/useGlobalSessions.ts",
        }}
        toolResult={{
          content:
            "Chunk ID: ff710e\nWall time: 0.0518 seconds\nProcess exited with code 0\nOutput:\nline 1\nline 2\n",
          isError: false,
        }}
        status="complete"
      />,
    );

    expect(screen.getByText("Shell")).toBeDefined();
    expect(
      screen.getByRole("button", { name: /useGlobalSessions\.ts/i }),
    ).toBeDefined();
    expect(screen.getByText(/2 lines/)).toBeDefined();
    expect(container.querySelector(".expand-chevron")).toBeNull();
  });

  it("keeps generic shell rows expandable when no inline PTY summary applies", () => {
    const { container } = render(
      <ToolCallRow
        id="tool-pty-generic"
        toolName="WriteStdin"
        toolInput={{ session_id: 37863, chars: "" }}
        toolResult={{
          content:
            "Chunk ID: ff710e\nWall time: 0.0518 seconds\nProcess exited with code 0\nOutput:\nline 1\nline 2\n",
          isError: false,
        }}
        status="complete"
      />,
    );

    expect(container.querySelector(".expand-chevron")).not.toBeNull();
  });
});
