import { describe, expect, it } from "vitest";
import {
  APPROVAL_AUDIT_LOG_CAPABILITY,
  BROWSER_SETTINGS_BACKUP_CAPABILITY,
} from "@yep-anywhere/shared";
import { getServerCapabilities } from "../../src/routes/version.js";

describe("Version Routes", () => {
  it("advertises approval audit log control", () => {
    expect(getServerCapabilities()).toContain(APPROVAL_AUDIT_LOG_CAPABILITY);
  });

  it("advertises browser settings backup storage", () => {
    expect(
      getServerCapabilities({ browserSettingsBackupAvailable: true }),
    ).toContain(BROWSER_SETTINGS_BACKUP_CAPABILITY);
    expect(getServerCapabilities()).not.toContain(
      BROWSER_SETTINGS_BACKUP_CAPABILITY,
    );
  });
});
