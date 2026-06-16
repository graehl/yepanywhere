// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { UI_KEYS } from "../../lib/storageKeys";
import { getBrowserXaiSttApiKey } from "../../lib/speechProviders/xaiCredentials";
import { SpeechControlMenu } from "../SpeechControlMenu";

function installMediaDevices(devices: MediaDeviceInfo[]) {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      enumerateDevices: vi.fn(async () => devices),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  });
}

function renderSpeechControlMenu(
  props: React.ComponentProps<typeof SpeechControlMenu>,
) {
  return render(
    <I18nProvider>
      <SpeechControlMenu {...props} />
    </I18nProvider>,
  );
}

describe("SpeechControlMenu", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("persists a selected microphone device for server STT capture", async () => {
    installMediaDevices([
      {
        kind: "audioinput",
        deviceId: "default",
        label: "Default microphone",
      } as MediaDeviceInfo,
      {
        kind: "audioinput",
        deviceId: "usb-mic",
        label: "USB microphone",
      } as MediaDeviceInfo,
      {
        kind: "videoinput",
        deviceId: "camera",
        label: "Camera",
      } as MediaDeviceInfo,
    ]);

    renderSpeechControlMenu({
      trigger: <button type="button">voice</button>,
      showMethodSelector: false,
      methodOptions: [],
      selectedMethod: "ya-grok",
      onMethodChange: vi.fn(),
    });

    fireEvent.contextMenu(screen.getByRole("button", { name: "voice" }));
    const select = await screen.findByRole("combobox", {
      name: "Microphone",
    });
    await waitFor(() =>
      expect(screen.getByText("USB microphone")).toBeDefined(),
    );

    fireEvent.change(select, { target: { value: "usb-mic" } });

    expect(localStorage.getItem(UI_KEYS.speechMicDeviceId)).toBe("usb-mic");
  });

  it("prewarms once while the mouse remains near the trigger margin", () => {
    installMediaDevices([]);
    const prewarm = vi.fn();

    renderSpeechControlMenu({
      trigger: <button type="button">voice</button>,
      showMethodSelector: false,
      methodOptions: [],
      selectedMethod: "ya-grok",
      onMethodChange: vi.fn(),
      onPointerNearTrigger: prewarm,
    });

    window.dispatchEvent(
      new MouseEvent("pointermove", { clientX: 1, clientY: 1 }),
    );
    window.dispatchEvent(
      new MouseEvent("pointermove", { clientX: 2, clientY: 2 }),
    );
    window.dispatchEvent(
      new MouseEvent("pointermove", { clientX: 100, clientY: 100 }),
    );
    window.dispatchEvent(
      new MouseEvent("pointermove", { clientX: 1, clientY: 1 }),
    );

    expect(prewarm).toHaveBeenCalledTimes(2);
  });

  it("stops active capture before opening speech options", () => {
    installMediaDevices([]);
    const onBeforeOpen = vi.fn();

    renderSpeechControlMenu({
      trigger: <button type="button">voice</button>,
      showMethodSelector: false,
      methodOptions: [],
      selectedMethod: "ya-grok",
      onMethodChange: vi.fn(),
      onBeforeOpen,
    });

    fireEvent.contextMenu(screen.getByRole("button", { name: "voice" }));

    expect(onBeforeOpen).toHaveBeenCalledTimes(1);
  });

  it("stops active capture before changing speech backend", () => {
    installMediaDevices([]);
    const onBeforeCaptureChange = vi.fn();
    const onMethodChange = vi.fn();

    renderSpeechControlMenu({
      trigger: <button type="button">voice</button>,
      showMethodSelector: true,
      methodOptions: [
        { value: "browser-native", label: "Browser" },
        { value: "xai-grok-direct-streaming", label: "Grok direct" },
      ],
      selectedMethod: "browser-native",
      onMethodChange,
      onBeforeCaptureChange,
    });

    fireEvent.contextMenu(screen.getByRole("button", { name: "voice" }));
    fireEvent.click(screen.getByRole("radio", { name: "Grok direct" }));

    expect(onBeforeCaptureChange).toHaveBeenCalledTimes(1);
    expect(onMethodChange).toHaveBeenCalledWith(["xai-grok-direct-streaming"]);
  });

  it("saves the browser xAI STT key from the mic options", () => {
    installMediaDevices([]);

    renderSpeechControlMenu({
      trigger: <button type="button">voice</button>,
      showMethodSelector: false,
      methodOptions: [],
      selectedMethod: "browser-native",
      onMethodChange: vi.fn(),
    });

    fireEvent.contextMenu(screen.getByRole("button", { name: "voice" }));
    fireEvent.change(screen.getByLabelText("Browser xAI STT Key"), {
      target: { value: " xai-browser-key " },
    });

    expect(getBrowserXaiSttApiKey()).toBe("xai-browser-key");
  });
});
