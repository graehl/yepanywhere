// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import {
  AUTOMATION_BROWSER_PROFILE_ID,
  BROWSER_LOCAL_KEYS,
  getOrCreateBrowserProfileId,
} from "../storageKeys";

function setNavigatorWebdriver(value: boolean): void {
  Object.defineProperty(navigator, "webdriver", {
    configurable: true,
    get: () => value,
  });
}

describe("browser-local storage keys", () => {
  afterEach(() => {
    localStorage.clear();
    delete (navigator as { webdriver?: boolean }).webdriver;
  });

  it("reuses the existing browser profile id from the production device key", () => {
    localStorage.setItem(BROWSER_LOCAL_KEYS.browserProfileId, "device-1");

    expect(getOrCreateBrowserProfileId()).toBe("device-1");
  });

  it("stores a generated browser profile id under the production device key", () => {
    const browserProfileId = getOrCreateBrowserProfileId();

    expect(browserProfileId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(localStorage.getItem(BROWSER_LOCAL_KEYS.browserProfileId)).toBe(
      browserProfileId,
    );
  });

  it("uses one stable browser profile id for automated browsers", () => {
    setNavigatorWebdriver(true);

    expect(getOrCreateBrowserProfileId()).toBe(AUTOMATION_BROWSER_PROFILE_ID);
    expect(
      localStorage.getItem(BROWSER_LOCAL_KEYS.browserProfileId),
    ).toBeNull();
  });

  it("does not let automated browsers reuse a real browser profile id", () => {
    localStorage.setItem(BROWSER_LOCAL_KEYS.browserProfileId, "device-1");
    setNavigatorWebdriver(true);

    expect(getOrCreateBrowserProfileId()).toBe(AUTOMATION_BROWSER_PROFILE_ID);
    expect(localStorage.getItem(BROWSER_LOCAL_KEYS.browserProfileId)).toBe(
      "device-1",
    );
  });
});
