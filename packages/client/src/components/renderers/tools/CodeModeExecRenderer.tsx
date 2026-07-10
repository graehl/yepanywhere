import type { ToolRenderer } from "./types";

interface CodeModeCall {
  input: unknown;
  toolName: string;
}

interface CodeModeExecInput {
  calls: CodeModeCall[];
  source: string;
}

function isCodeModeExecInput(input: unknown): input is CodeModeExecInput {
  return (
    !!input &&
    typeof input === "object" &&
    Array.isArray((input as CodeModeExecInput).calls)
  );
}

function getCallPreview(call: CodeModeCall): string {
  if (
    call.toolName === "exec_command" &&
    call.input &&
    typeof call.input === "object"
  ) {
    const command = (call.input as Record<string, unknown>).cmd;
    if (typeof command === "string" && command.trim()) {
      return command.trim();
    }
  }
  return call.toolName;
}

function getCallCountSummary(input: unknown): string {
  if (!isCodeModeExecInput(input) || input.calls.length === 0) {
    return "done";
  }
  const noun = input.calls.every((call) => call.toolName === "exec_command")
    ? "commands"
    : "tool calls";
  return `${input.calls.length} ${noun}`;
}

export const codeModeExecRenderer: ToolRenderer = {
  tool: "Exec",
  displayName: "Exec",

  renderToolUse(input) {
    if (!isCodeModeExecInput(input)) return null;
    return (
      <pre className="tool-fallback">
        <code>{input.calls.map(getCallPreview).join("\n")}</code>
      </pre>
    );
  },

  renderToolResult(result, isError) {
    const text =
      typeof result === "string" ? result : JSON.stringify(result, null, 2);
    return (
      <pre className={`tool-fallback ${isError ? "tool-fallback-error" : ""}`}>
        <code>{text}</code>
      </pre>
    );
  },

  getUseSummary(input) {
    return getCallCountSummary(input);
  },

  getResultSummary(_result, isError, input) {
    return isError ? "failed" : getCallCountSummary(input);
  },
};
