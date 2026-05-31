// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerSettings } from "../../../api/client";
import { AdvancedSettings } from "../AdvancedSettings";

const {
  developerModeState,
  mockSetExperimentalFeaturesEnabled,
  mockSetExperimentalFeatureEnabled,
} = vi.hoisted(() => ({
  developerModeState: {
    experimentalFeaturesEnabled: false,
    experimentalFeatures: {
      patientQueueMode: true,
    },
  },
  mockSetExperimentalFeaturesEnabled: vi.fn(),
  mockSetExperimentalFeatureEnabled: vi.fn(),
}));

vi.mock("../../../hooks/useDeveloperMode", () => ({
  useDeveloperMode: () => ({
    experimentalFeaturesEnabled: developerModeState.experimentalFeaturesEnabled,
    experimentalFeatures: developerModeState.experimentalFeatures,
    setExperimentalFeaturesEnabled: mockSetExperimentalFeaturesEnabled,
    setExperimentalFeatureEnabled: mockSetExperimentalFeatureEnabled,
  }),
}));

vi.mock("../../../hooks/useServerSettings", () => ({
  useServerSettings: () => ({
    settings: {
      publicSharesEnabled: false,
    } as ServerSettings,
    isLoading: false,
    error: null,
    updateSetting: vi.fn(),
  }),
}));

vi.mock("../../../hooks/usePublicShareStatus", () => ({
  usePublicShareStatus: () => ({
    status: null,
  }),
}));

vi.mock("../../../i18n", () => ({
  useI18n: () => ({
    t: (key: string, values?: Record<string, string>) =>
      values?.url ? `${key} ${values.url}` : key,
  }),
}));

describe("AdvancedSettings experimental features", () => {
  beforeEach(() => {
    developerModeState.experimentalFeaturesEnabled = false;
    developerModeState.experimentalFeatures.patientQueueMode = true;
    mockSetExperimentalFeaturesEnabled.mockReset();
    mockSetExperimentalFeatureEnabled.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("hides per-feature options until the master switch is enabled", () => {
    render(<AdvancedSettings />);

    expect(
      screen.queryByLabelText("advancedExperimentalFeatureListLabel"),
    ).toBeNull();
    expect(
      screen.queryByLabelText("advancedExperimentalPatientQueueTitle"),
    ).toBeNull();
  });

  it("shows specific feature toggles with topic links when enabled", () => {
    developerModeState.experimentalFeaturesEnabled = true;
    render(<AdvancedSettings />);

    const patientToggle = screen.getByLabelText(
      "advancedExperimentalPatientQueueTitle",
    ) as HTMLInputElement;
    expect(patientToggle.checked).toBe(true);

    const topicLink = screen.getByRole("link", {
      name: "advancedExperimentalFeatureTopicLink",
    });
    expect(topicLink.getAttribute("href")).toContain(
      "topics/message-control-steer-queue-btw-later-interrupt.md",
    );

    fireEvent.click(patientToggle);

    expect(mockSetExperimentalFeatureEnabled).toHaveBeenCalledWith(
      "patientQueueMode",
      false,
    );
  });
});
