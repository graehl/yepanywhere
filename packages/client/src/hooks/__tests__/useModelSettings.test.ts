import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BROWSER_LOCAL_KEYS } from "../../lib/storageKeys";

const mocks = vi.hoisted(() => ({
  updateServerSettings: vi.fn(async () => ({ settings: {} })),
  version: null as unknown,
}));

vi.mock("../../api/client", () => ({
  api: {
    updateServerSettings: mocks.updateServerSettings,
  },
}));

vi.mock("../useVersion", () => ({
  useVersion: () => ({
    version: mocks.version,
  }),
}));

describe("useModelSettings speech defaults", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    mocks.version = null;
    mocks.updateServerSettings.mockClear();
    vi.resetModules();
  });

  it("uses server speech defaults while local settings are unset", async () => {
    mocks.version = {
      clientDefaults: {
        speech: {
          voiceInputEnabled: false,
          speechMethod: "ya-grok",
        },
      },
    };
    const { useModelSettings } = await import("../useModelSettings");

    const { result } = renderHook(() => useModelSettings());

    expect(result.current.voiceInputEnabled).toBe(false);
    expect(result.current.speechMethod).toBe("ya-grok");
    expect(result.current.hasStoredSpeechMethod).toBe(true);
  });

  it("keeps local explicit speech choices over server defaults", async () => {
    window.localStorage.setItem(
      BROWSER_LOCAL_KEYS.speechMethod,
      "browser-native",
    );
    mocks.version = {
      clientDefaults: {
        speech: {
          speechMethod: "ya-grok",
        },
      },
    };
    const { useModelSettings } = await import("../useModelSettings");

    const { result } = renderHook(() => useModelSettings());

    expect(result.current.speechMethod).toBe("browser-native");
    expect(result.current.hasStoredSpeechMethod).toBe(true);
  });

  it("stores speech selections as local choices and server defaults", async () => {
    const { useModelSettings } = await import("../useModelSettings");
    const { result } = renderHook(() => useModelSettings());

    act(() => result.current.setSpeechMethod("ya-grok"));

    expect(window.localStorage.getItem(BROWSER_LOCAL_KEYS.speechMethod)).toBe(
      "ya-grok",
    );
    expect(mocks.updateServerSettings).toHaveBeenCalledWith({
      clientDefaults: {
        speech: {
          speechMethod: "ya-grok",
        },
      },
    });
  });

  it("loads model and thinking settings from browser-local keys", async () => {
    window.localStorage.setItem(BROWSER_LOCAL_KEYS.model, "opus");
    window.localStorage.setItem(BROWSER_LOCAL_KEYS.thinkingLevel, "medium");
    window.localStorage.setItem(BROWSER_LOCAL_KEYS.thinkingMode, "auto");
    window.localStorage.setItem(BROWSER_LOCAL_KEYS.showThinking, "on");
    const { useModelSettings } = await import("../useModelSettings");
    const { result } = renderHook(() => useModelSettings());

    expect(result.current.model).toBe("opus");
    expect(result.current.effortLevel).toBe("medium");
    expect(result.current.thinkingMode).toBe("auto");
    expect(result.current.showThinking).toBe("on");
  });

  it("stores model and thinking settings as browser-local choices", async () => {
    const { useModelSettings } = await import("../useModelSettings");
    const { result } = renderHook(() => useModelSettings());

    act(() => {
      result.current.setModel("sonnet");
      result.current.setEffortLevel("low");
      result.current.setThinkingMode("on");
      result.current.setShowThinking("off");
    });

    expect(window.localStorage.getItem(BROWSER_LOCAL_KEYS.model)).toBe(
      "sonnet",
    );
    expect(window.localStorage.getItem(BROWSER_LOCAL_KEYS.thinkingLevel)).toBe(
      "low",
    );
    expect(window.localStorage.getItem(BROWSER_LOCAL_KEYS.thinkingMode)).toBe(
      "on",
    );
    expect(window.localStorage.getItem(BROWSER_LOCAL_KEYS.showThinking)).toBe(
      "off",
    );
  });

  it("stores the Parakeet model as a browser-local STT choice", async () => {
    const { useModelSettings } = await import("../useModelSettings");
    const { result } = renderHook(() => useModelSettings());

    act(() =>
      result.current.setParakeetSpeechModel("nvidia/parakeet-ctc-1.1b"),
    );

    expect(
      window.localStorage.getItem(BROWSER_LOCAL_KEYS.parakeetSpeechModel),
    ).toBe("nvidia/parakeet-ctc-1.1b");
    expect(mocks.updateServerSettings).not.toHaveBeenCalledWith({
      clientDefaults: {
        speech: {
          parakeetSpeechModel: "nvidia/parakeet-ctc-1.1b",
        },
      },
    });
  });
});
