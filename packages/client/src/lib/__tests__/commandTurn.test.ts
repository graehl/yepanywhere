import { describe, expect, it } from "vitest";
import { parseCommandTurn } from "../commandTurn";

describe("parseCommandTurn", () => {
  it("extracts the command from a wrapped no-arg turn", () => {
    const text =
      "<command-name>/model</command-name>\n" +
      "<command-message>model</command-message>\n" +
      "<command-args></command-args>";
    expect(parseCommandTurn(text)).toEqual({ command: "/model", args: "" });
  });

  it("extracts the command and its args", () => {
    const text =
      "<command-name>/harsh-review</command-name>\n" +
      "<command-message>harsh-review</command-message>\n" +
      "<command-args>the 4 kzahel commits</command-args>";
    expect(parseCommandTurn(text)).toEqual({
      command: "/harsh-review",
      args: "the 4 kzahel commits",
    });
  });

  it("returns null for an ordinary prose turn", () => {
    expect(parseCommandTurn("please review the diff")).toBeNull();
  });

  it("returns null when the command name is empty", () => {
    expect(
      parseCommandTurn(
        "<command-name></command-name><command-args></command-args>",
      ),
    ).toBeNull();
  });

  it("trims surrounding whitespace in name and args", () => {
    const text =
      "<command-name>  /foo  </command-name><command-args>  bar baz  </command-args>";
    expect(parseCommandTurn(text)).toEqual({
      command: "/foo",
      args: "bar baz",
    });
  });
});
