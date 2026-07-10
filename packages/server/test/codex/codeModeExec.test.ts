import { describe, expect, it } from "vitest";
import {
  extractCodexCodeModeCalls,
  extractCodexCodeModeTextOutput,
} from "../../src/codex/codeModeExec.js";

describe("extractCodexCodeModeCalls", () => {
  it("extracts a literal exec_command input", () => {
    const calls = extractCodexCodeModeCalls(`
      const r = await tools.exec_command({"cmd":"pwd","workdir":"/repo"});
      text(r.output);
    `);

    expect(calls).toMatchObject([
      {
        toolName: "exec_command",
        input: { cmd: "pwd", workdir: "/repo" },
      },
    ]);
  });

  it("resolves a simple const string passed to apply_patch", () => {
    const calls = extractCodexCodeModeCalls(`
      const patch = "*** Begin Patch\\n*** End Patch";
      text(await tools.apply_patch(patch));
    `);

    expect(calls).toMatchObject([
      {
        toolName: "apply_patch",
        input: { _rawPatch: "*** Begin Patch\n*** End Patch" },
      },
    ]);
  });

  it("extracts multiple literal calls without interpreting Promise.all", () => {
    const calls = extractCodexCodeModeCalls(`
      const results = await Promise.all([
        tools.exec_command({"cmd":"pnpm lint"}),
        tools.exec_command({"cmd":"pnpm typecheck"})
      ]);
      text(results.length);
    `);

    expect(calls.map((call) => call.input)).toEqual([
      { cmd: "pnpm lint" },
      { cmd: "pnpm typecheck" },
    ]);
  });

  it("ignores calls in strings and comments", () => {
    const calls = extractCodexCodeModeCalls(`
      // tools.exec_command({"cmd":"comment"})
      const example = "tools.exec_command({\\\"cmd\\\":\\\"string\\\"})";
      text(example);
    `);

    expect(calls).toEqual([]);
  });

  it("fails closed for expressions and multi-argument calls", () => {
    const calls = extractCodexCodeModeCalls(`
      await tools.exec_command(makeOptions());
      await tools.exec_command({"cmd":"pwd"}, extra);
    `);

    expect(calls).toEqual([]);
  });
});

describe("extractCodexCodeModeTextOutput", () => {
  it("joins text-only code-mode result blocks", () => {
    expect(
      extractCodexCodeModeTextOutput([
        { type: "input_text", text: "Script completed\nOutput:\n" },
        { type: "input_text", text: "hello\n" },
      ]),
    ).toBe("Script completed\nOutput:\nhello\n");
  });

  it("preserves mixed-media results for the generic normalizer", () => {
    expect(
      extractCodexCodeModeTextOutput([
        { type: "input_text", text: "image" },
        { type: "input_image", image_url: "data:image/png;base64,AA==" },
      ]),
    ).toBeUndefined();
  });
});
