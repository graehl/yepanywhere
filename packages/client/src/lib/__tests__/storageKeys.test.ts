// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { BROWSER_LOCAL_KEYS, getOrCreateBrowserProfileId } from "../storageKeys";

describe("browser-local storage keys", () => {
  afterEach(() => {
    localStorage.clear();
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
});
