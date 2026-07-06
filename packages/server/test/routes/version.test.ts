import { describe, expect, it } from "vitest";
import { APPROVAL_AUDIT_LOG_CAPABILITY } from "@yep-anywhere/shared";
import { getServerCapabilities } from "../../src/routes/version.js";

describe("Version Routes", () => {
  it("advertises approval audit log control", () => {
    expect(getServerCapabilities()).toContain(APPROVAL_AUDIT_LOG_CAPABILITY);
  });
});
