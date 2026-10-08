import { afterEach, describe, expect, it } from "vitest";
import { UI_KEYS } from "../storageKeys";
import {
  initializeUnicodeProseMath,
  unicodeProseMathSetting,
} from "../unicodeProseMath";

describe("unicode prose math setting", () => {
  afterEach(() => {
    unicodeProseMathSetting.reset();
    delete document.documentElement.dataset.unicodeMath;
    localStorage.clear();
  });

  it("defaults off and leaves the root unmarked", () => {
    initializeUnicodeProseMath();
    expect(unicodeProseMathSetting.read()).toBe(false);
    expect(document.documentElement.dataset.unicodeMath).toBeUndefined();
  });

  it("marks the root while enabled and clears it when disabled", () => {
    initializeUnicodeProseMath();
    unicodeProseMathSetting.set(true);
    expect(document.documentElement.dataset.unicodeMath).toBe("on");
    expect(localStorage.getItem(UI_KEYS.unicodeProseMath)).toBe("true");
    unicodeProseMathSetting.set(false);
    expect(document.documentElement.dataset.unicodeMath).toBeUndefined();
  });
});
