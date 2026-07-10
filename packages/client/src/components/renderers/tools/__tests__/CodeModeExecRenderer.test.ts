import { describe, expect, it } from "vitest";
import { getToolSummary } from "../../../tools/summaries";

describe("CodeModeExecRenderer", () => {
  it("summarizes grouped shell calls without showing generic done", () => {
    const summary = getToolSummary(
      "Exec",
      {
        source: "",
        calls: [
          { toolName: "exec_command", input: { cmd: "pnpm lint" } },
          { toolName: "exec_command", input: { cmd: "pnpm typecheck" } },
        ],
      },
      { content: "ok", isError: false },
      "complete",
    );

    expect(summary).toBe("2 commands");
  });
});
