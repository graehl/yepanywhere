// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RecapAfterSecondsControl } from "../RecapAfterSecondsControl";

vi.mock("../../i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

afterEach(() => {
  cleanup();
});

describe("RecapAfterSecondsControl", () => {
  it("updates the numeric draft while dragging the slider without committing", () => {
    const onCommit = vi.fn();
    render(<RecapAfterSecondsControl value={300} onCommit={onCommit} />);

    const slider = screen.getByRole<HTMLInputElement>("slider", {
      name: "recapAfterSecondsAria",
    });
    const input = screen.getByRole<HTMLInputElement>("spinbutton", {
      name: "recapAfterSecondsAria",
    });

    fireEvent.change(slider, { target: { value: "42" } });

    expect(input.value).toBe("42");
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.pointerUp(slider);

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(42);
  });

  it("normalizes and commits the numeric input on blur and Enter once", () => {
    const onCommit = vi.fn();
    render(<RecapAfterSecondsControl value={300} onCommit={onCommit} />);

    const input = screen.getByRole<HTMLInputElement>("spinbutton", {
      name: "recapAfterSecondsAria",
    });

    fireEvent.change(input, { target: { value: "0" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.blur(input);

    expect(input.value).toBe("1");
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(1);
  });

  it("restores the committed value on Escape", () => {
    const onCommit = vi.fn();
    render(<RecapAfterSecondsControl value={300} onCommit={onCommit} />);

    const input = screen.getByRole<HTMLInputElement>("spinbutton", {
      name: "recapAfterSecondsAria",
    });

    fireEvent.change(input, { target: { value: "12" } });
    expect(input.value).toBe("12");

    fireEvent.keyDown(input, { key: "Escape" });

    expect(input.value).toBe("300");
    expect(onCommit).not.toHaveBeenCalled();
  });
});
