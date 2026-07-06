import { describe, expect, it } from "vitest";
import {
  getPublicShareInitialPrompt,
  normalizePublicShareInitialPrompt,
} from "../sessionPublicSharePrompt";

describe("session public share prompt helpers", () => {
  it("normalizes the first user prompt and skips setup turns", () => {
    expect(
      getPublicShareInitialPrompt([
        { type: "system", content: "ignored" },
        { type: "user", content: "# AGENTS.md instructions\nUse repo rules" },
        {
          type: "user",
          message: {
            content: [
              { type: "text", text: " Build   the thing\ncarefully " },
            ],
          },
        },
      ]),
    ).toBe("Build the thing carefully");
  });

  it("returns null for empty or environment setup prompts", () => {
    expect(normalizePublicShareInitialPrompt("   ")).toBeNull();
    expect(
      normalizePublicShareInitialPrompt("<environment_context>\n<cwd />"),
    ).toBeNull();
  });

  it("caps long prompts with an ellipsis", () => {
    const normalized = normalizePublicShareInitialPrompt("x".repeat(710));

    expect(normalized).toHaveLength(700);
    expect(normalized?.endsWith("...")).toBe(true);
  });
});
