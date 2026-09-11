import { afterEach, describe, expect, it } from "vitest";
import {
  isProviderHostDegraded,
  resetProviderHostDegradedForTests,
  setProviderHostDegraded,
} from "../../../src/sdk/providers/provider-host-status.js";

describe("Linux provider-host degraded notice", () => {
  afterEach(() => {
    resetProviderHostDegradedForTests();
  });

  it("stays off until Linux boot records a failed ensure", () => {
    expect(isProviderHostDegraded()).toBe(false);
    setProviderHostDegraded(true);
    expect(isProviderHostDegraded()).toBe(
      process.platform === "linux" || process.platform === "darwin",
    );
    setProviderHostDegraded(false);
    expect(isProviderHostDegraded()).toBe(false);
  });
});
