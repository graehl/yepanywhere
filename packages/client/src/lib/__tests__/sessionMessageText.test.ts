import { describe, expect, it } from "vitest";
import {
  messageContentToPlainText,
  turnContentText,
} from "../sessionMessageText";

describe("session message text helpers", () => {
  it("extracts turn text from strings and text blocks only", () => {
    expect(turnContentText("hello")).toBe("hello");
    expect(
      turnContentText([
        { type: "text", text: "one" },
        { type: "tool_use", name: "Read" },
        { type: "text", text: "two" },
      ]),
    ).toBe("one\ntwo");
  });

  it("extracts text, thinking, and content fields for message previews", () => {
    expect(
      messageContentToPlainText([
        { type: "text", text: "visible" },
        { type: "thinking", thinking: "hidden reasoning" },
        { type: "unknown", content: "fallback" },
        null,
      ]),
    ).toBe("visible\nhidden reasoning\nfallback");
  });
});
