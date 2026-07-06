import { describe, expect, it } from "vitest";
import {
  composeGeneratedRetitle,
  createSessionRetitleSubmittedTurnText,
  resolveSessionPageTitle,
} from "../sessionTitleHelpers";

describe("session title helpers", () => {
  it("prefers local and full-title values for the session page header", () => {
    expect(
      resolveSessionPageTitle({
        localCustomTitle: undefined,
        initialTitle: "Optimistic",
        untitledTitle: "Untitled",
        session: {
          title: "Short list title",
          fullTitle: "Full title for the wide header",
        },
      }),
    ).toMatchObject({
      displayTitle: "Full title for the wide header",
      titleTooltip: "Full title for the wide header",
    });

    expect(
      resolveSessionPageTitle({
        localCustomTitle: "Local rename",
        initialTitle: "Optimistic",
        untitledTitle: "Untitled",
        session: {
          customTitle: "Persisted rename",
          title: "Short list title",
          fullTitle: "Full title",
        },
      }),
    ).toMatchObject({
      displayTitle: "Local rename",
      titleTooltip: "Local rename",
    });
  });

  it("builds retitle prompt text and applies generated title insertions", () => {
    expect(createSessionRetitleSubmittedTurnText("  Current task  ", 80)).toBe(
      [
        "What is a good new title for this session?",
        "",
        "Target length: under 80 characters.",
        "Current title: Current task",
        "Prefer a concrete task/result phrase over a generic chat title.",
        "Return only the title. Do not quote it. Do not add a trailing period.",
      ].join("\n"),
    );

    expect(
      composeGeneratedRetitle("Generated", {
        prefix: "before ",
        suffix: " after",
      }),
    ).toBe("before Generated after");
  });
});
