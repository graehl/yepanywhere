// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetDeveloperModeForTest } from "../../../hooks/useDeveloperMode";
import { DevelopmentSettings } from "../DevelopmentSettings";

vi.mock("../../../contexts/SchemaValidationContext", () => ({
  useSchemaValidationContext: () => ({
    ignoredTools: [],
    clearIgnoredTools: vi.fn(),
  }),
}));

vi.mock("../../../hooks/useReloadNotifications", () => ({
  useReloadNotifications: () => ({
    isManualReloadMode: true,
    pendingReloads: { backend: false },
    connected: true,
    reloadBackend: vi.fn(),
    unsafeToRestart: false,
    interruptibleSessionCount: 0,
  }),
}));

vi.mock("../../../hooks/useSchemaValidation", () => ({
  useSchemaValidation: () => ({
    settings: { enabled: false },
    setEnabled: vi.fn(),
  }),
}));

vi.mock("../../../hooks/useServerSettings", () => ({
  useServerSettings: () => ({
    settings: { serviceWorkerEnabled: true },
    updateSetting: vi.fn(),
  }),
}));

vi.mock("../../../i18n", () => ({
  useI18n: () => ({
    t: (key: string) =>
      (
        ({
          developmentSectionTitle: "Development",
          developmentSchemaTitle: "Schema Validation",
          developmentSchemaDescription: "Validate tool results",
          developmentDiagnosticsTitle: "Browser Diagnostics",
          developmentDiagnosticsDescription: "Capture browser logs",
          developmentStoreMessagesTitle: "Store-Backed Session Messages",
          developmentStoreMessagesDescription:
            "Return session messages from the session detail store. Turn off to compare against the legacy hook-local mirror.",
          developmentServiceWorkerTitle: "Service Worker",
          developmentServiceWorkerDescription: "Enable service worker",
          developmentRestartTitle: "Restart Server",
          developmentRestartDescription: "Restart the backend server",
          developmentRestart: "Restart Server",
        }) as Record<string, string>
      )[key] ?? key,
  }),
}));

vi.mock("../SettingsPaneTitleContext", () => ({
  useSettingsPaneTitle: vi.fn(),
}));

vi.mock("../SettingsUndoContext", () => ({
  useSettingsUndoBaseline: vi.fn(),
}));

describe("DevelopmentSettings", () => {
  beforeEach(() => {
    window.localStorage.clear();
    __resetDeveloperModeForTest();
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    __resetDeveloperModeForTest();
  });

  it("shows the store-backed session messages debug setting", () => {
    render(<DevelopmentSettings />);

    expect(screen.getByText("Store-Backed Session Messages")).toBeTruthy();
    expect(
      screen.getByText(
        "Return session messages from the session detail store. Turn off to compare against the legacy hook-local mirror.",
      ),
    ).toBeTruthy();
  });
});
