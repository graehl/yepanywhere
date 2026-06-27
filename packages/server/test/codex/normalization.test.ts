import { describe, expect, it } from "vitest";
import {
  normalizeCodexCommandActionInvocation,
  normalizeCodexToolInvocation,
  normalizeCodexToolOutputWithContext,
} from "../../src/codex/normalization.js";

const WINDOWS_PWSH_GET_CONTENT = String.raw`"C:\Users\sox\AppData\Local\Microsoft\WindowsApps\pwsh.exe" -Command 'Get-Content -Path CLAUDE.md -TotalCount 20'`;

describe("normalizeCodexToolInvocation", () => {
  it("normalizes PowerShell Get-Content wrappers to Read", () => {
    const normalized = normalizeCodexToolInvocation("Bash", {
      command: WINDOWS_PWSH_GET_CONTENT,
    });

    expect(normalized).toMatchObject({
      toolName: "Read",
      input: {
        file_path: "CLAUDE.md",
        offset: 1,
        limit: 20,
      },
      readShellInfo: {
        filePath: "CLAUDE.md",
        startLine: 1,
        endLine: 20,
        stripLineNumbers: false,
      },
    });
  });

  it("normalizes Get-Content piped into Select-Object -Skip -First to a partial Read", () => {
    const normalized = normalizeCodexToolInvocation("Bash", {
      command:
        "Get-Content -Path native/apps/mclone-web-client/scripts/browser-smoke.mjs | Select-Object -Skip 120 -First 175",
    });

    expect(normalized).toMatchObject({
      toolName: "Read",
      input: {
        file_path: "native/apps/mclone-web-client/scripts/browser-smoke.mjs",
        offset: 121,
        limit: 175,
      },
      readShellInfo: {
        filePath: "native/apps/mclone-web-client/scripts/browser-smoke.mjs",
        startLine: 121,
        endLine: 295,
        stripLineNumbers: false,
      },
    });
  });

  it("handles Select-Object -First without -Skip as a head read", () => {
    const normalized = normalizeCodexToolInvocation("Bash", {
      command: "Get-Content -Path CLAUDE.md | Select-Object -First 20",
    });

    expect(normalized).toMatchObject({
      toolName: "Read",
      input: { file_path: "CLAUDE.md", offset: 1, limit: 20 },
      readShellInfo: { filePath: "CLAUDE.md", startLine: 1, endLine: 20 },
    });
  });

  it("handles Select-Object -Skip without -First as an open-ended read", () => {
    const normalized = normalizeCodexToolInvocation("Bash", {
      command: "Get-Content -Path CLAUDE.md | Select-Object -Skip 40",
    });

    expect(normalized).toMatchObject({
      toolName: "Read",
      input: { file_path: "CLAUDE.md", offset: 41 },
      readShellInfo: { filePath: "CLAUDE.md", startLine: 41 },
    });
    expect((normalized.input as { limit?: number }).limit).toBeUndefined();
  });

  it("handles inline Select-Object -Skip:N -First:M flags", () => {
    const normalized = normalizeCodexToolInvocation("Bash", {
      command: "Get-Content -Path CLAUDE.md | Select-Object -Skip:295 -First:130",
    });

    expect(normalized).toMatchObject({
      toolName: "Read",
      input: { file_path: "CLAUDE.md", offset: 296, limit: 130 },
      readShellInfo: { filePath: "CLAUDE.md", startLine: 296, endLine: 425 },
    });
  });

  it("leaves Get-Content piped into a non-window Select-Object as Bash", () => {
    const normalized = normalizeCodexToolInvocation("Bash", {
      command:
        "Get-Content -Path CLAUDE.md | Select-Object -ExpandProperty Length",
    });

    expect(normalized.toolName).toBe("Bash");
  });

  it("leaves Get-Content piped into an unrelated command as Bash", () => {
    const normalized = normalizeCodexToolInvocation("Bash", {
      command: "Get-Content -Path CLAUDE.md | Measure-Object -Line",
    });

    expect(normalized.toolName).toBe("Bash");
  });

  it("uses Codex read commandActions while preserving parsed line limits", () => {
    const normalized = normalizeCodexCommandActionInvocation(
      WINDOWS_PWSH_GET_CONTENT,
      [
        {
          type: "read",
          command: "Get-Content -Path CLAUDE.md -TotalCount 20",
          name: "CLAUDE.md",
          path: String.raw`C:\Users\sox\Documents\code\yepanywhere\CLAUDE.md`,
        },
      ],
    );

    expect(normalized).toMatchObject({
      toolName: "Read",
      input: {
        file_path: String.raw`C:\Users\sox\Documents\code\yepanywhere\CLAUDE.md`,
        offset: 1,
        limit: 20,
      },
      readShellInfo: {
        filePath: String.raw`C:\Users\sox\Documents\code\yepanywhere\CLAUDE.md`,
        startLine: 1,
        endLine: 20,
      },
    });
  });
});

describe("normalizeCodexToolOutputWithContext", () => {
  it("omits inline image data from structured tool output", () => {
    const output = [
      {
        type: "input_image",
        image_url: `data:image/jpeg;base64,${"A".repeat(4096)}`,
      },
    ];

    const normalized = normalizeCodexToolOutputWithContext(output);

    expect(normalized.content).not.toContain("data:image");
    expect(JSON.stringify(normalized.structured)).not.toContain("data:image");
    expect(normalized.content).toContain("inline image/jpeg data omitted");
  });

  it("omits inline image data from JSON string tool output", () => {
    const output = JSON.stringify([
      {
        type: "input_image",
        image_url: `data:image/png;base64,${"A".repeat(4096)}`,
      },
    ]);

    const normalized = normalizeCodexToolOutputWithContext(output);

    expect(normalized.content).not.toContain("data:image");
    expect(JSON.stringify(normalized.structured)).not.toContain("data:image");
    expect(normalized.content).toContain("inline image/png data omitted");
  });
});
