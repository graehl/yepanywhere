import { toolDisplayContracts } from "./toolDisplayContracts";
import { defineTool } from "./defineTool";
import {
  CodeModeOutput,
  getCallPreview,
  getCallCountSummary,
  isCodeModeExecInput,
  getSkillRead,
} from "./CodeModeOutput";
import styles from "./CodeModeOutput.module.css";

export const codeModeExecRenderer = defineTool(toolDisplayContracts.Exec, {
  tool: "Exec",
  displayName: "Exec",

  displayNameForCall(input, status) {
    if (
      isCodeModeExecInput(input) &&
      input.calls.length > 0 &&
      input.calls.every((call) => getSkillRead(call)?.onlyRead)
    ) {
      return status === "pending" ? "Loading skill" : "Skill load";
    }
    return undefined;
  },

  renderToolUse(input) {
    if (!isCodeModeExecInput(input)) return null;
    return (
      <pre className={styles.text}>
        <code>{input.calls.map(getCallPreview).join("\n")}</code>
      </pre>
    );
  },

  renderToolResult(result, isError, _context, input) {
    return <CodeModeOutput result={result} isError={isError} input={input} />;
  },

  getUseSummary(input) {
    return getCallCountSummary(input);
  },

  getResultSummary(_result, isError, input) {
    return isError ? "failed" : getCallCountSummary(input);
  },
});
