import { describe, expect, it } from "vitest";
import {
  liveThinkingSelectionFromProcess,
  thinkingOptionFromProcess,
  thinkingOptionFromSelection,
} from "../liveThinkingConfig";

describe("liveThinkingConfig", () => {
  it("keeps adaptive process thinking as auto when no effort is set", () => {
    expect(thinkingOptionFromProcess({ type: "adaptive" })).toBe("auto");
    expect(liveThinkingSelectionFromProcess({ type: "adaptive" })).toEqual({
      mode: "auto",
      effortLevel: "high",
    });
  });

  it("keeps adaptive process thinking with effort as on:effort", () => {
    expect(thinkingOptionFromProcess({ type: "adaptive" }, "xhigh")).toBe(
      "on:xhigh",
    );
    expect(
      liveThinkingSelectionFromProcess({ type: "adaptive" }, "xhigh"),
    ).toEqual({
      mode: "on",
      effortLevel: "xhigh",
    });
  });

  it("keeps disabled process thinking as off", () => {
    expect(thinkingOptionFromProcess({ type: "disabled" }, "xhigh")).toBe(
      "off",
    );
  });

  it("normalizes provider-specific effort while preserving live thinking", () => {
    expect(
      thinkingOptionFromProcess({ type: "adaptive" }, "max", "codex"),
    ).toBe("on:xhigh");
  });

  it("builds explicit options from toolbar selections", () => {
    expect(thinkingOptionFromSelection("off", "high")).toBe("off");
    expect(thinkingOptionFromSelection("auto", "high")).toBe("auto");
    expect(thinkingOptionFromSelection("on", "low")).toBe("on:low");
  });
});
