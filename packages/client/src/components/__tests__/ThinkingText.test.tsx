import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ThinkingText } from "../ThinkingText";

describe("ThinkingText", () => {
  afterEach(() => {
    cleanup();
  });

  it("keeps existing outline sections mounted while streaming new headings", () => {
    const firstText = ["**First step**", "", "Read `AGENTS.md`."].join("\n");
    const { container, rerender } = render(
      <ThinkingText text={firstText} isStreaming={true} />,
    );
    const firstSection = container.querySelector(".thinking-outline-section");

    rerender(
      <ThinkingText
        text={[
          firstText,
          "",
          "**Second step**",
          "",
          "Measure the append path.",
        ].join("\n")}
        isStreaming={true}
      />,
    );

    expect(screen.getByText("Second step")).toBeDefined();
    expect(container.querySelector(".thinking-inline-code")?.textContent).toBe(
      "AGENTS.md",
    );
    expect(container.querySelector(".thinking-outline-section")).toBe(
      firstSection,
    );
  });
});
