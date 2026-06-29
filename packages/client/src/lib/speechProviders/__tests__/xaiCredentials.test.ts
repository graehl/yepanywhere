// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { BROWSER_LOCAL_KEYS } from "../../storageKeys";
import {
  getBrowserXaiSttApiKey,
  hasBrowserXaiSttApiKey,
  setBrowserXaiSttApiKey,
} from "../xaiCredentials";

describe("browser xAI STT credentials", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("stores the browser-local key under the production xAI STT key", () => {
    setBrowserXaiSttApiKey("  xai-key  ");

    expect(localStorage.getItem(BROWSER_LOCAL_KEYS.xaiSttApiKey)).toBe(
      "xai-key",
    );
    expect(getBrowserXaiSttApiKey()).toBe("xai-key");
    expect(hasBrowserXaiSttApiKey()).toBe(true);
  });
});
