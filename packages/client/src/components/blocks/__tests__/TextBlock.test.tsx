import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TextBlock } from "../TextBlock";

describe("TextBlock", () => {
  afterEach(() => {
    cleanup();
  });

  it("defers local math rendering until streaming text completes", () => {
    const { container, rerender } = render(
      <TextBlock text="Streaming $x^2$ now" isStreaming={true} />,
    );

    expect(container.querySelector(".text-block-toggle")).toBeNull();
    expect(container.querySelector(".text-block-local-rendered")).toBeNull();
    expect(screen.getByText("Streaming $x^2$ now")).toBeDefined();

    rerender(<TextBlock text="Streaming $x^2$ now" isStreaming={false} />);

    expect(container.querySelector(".text-block-toggle")).toBeTruthy();
    expect(container.querySelector(".text-block-local-rendered")).toBeTruthy();
    expect(container.querySelector(".katex")).toBeTruthy();
  });
});
