import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LEGACY_KEYS } from "../../lib/storageKeys";

const mocks = vi.hoisted(() => ({
  updateServerSettings: vi.fn(async () => ({ settings: {} })),
  version: null as unknown,
  installId: undefined as string | undefined,
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

vi.mock("../../contexts/InstallIdContext", () => ({
  useInstallId: () => ({ installId: mocks.installId, isLoading: false }),
}));

describe("useModelSettings speech defaults", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    mocks.version = null;
    mocks.installId = undefined;
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
    window.localStorage.setItem(LEGACY_KEYS.speechMethod, "browser-native");
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

    expect(window.localStorage.getItem(LEGACY_KEYS.speechMethod)).toBe(
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

  it("re-reads the server-scoped showThinking once installId arrives", async () => {
    // Repro of the reload race: the synchronous useState(loadShowThinking) at
    // mount runs before installId is known, so a stored "on" reads back as
    // "default" until the install-id re-sync effect fires.
    const { setCurrentInstallId } = await import("../../lib/storageKeys");
    window.localStorage.setItem("yep-anywhere-inst-1-show-thinking", "on");

    mocks.installId = undefined;
    const { useModelSettings } = await import("../useModelSettings");
    const { result, rerender } = renderHook(() => useModelSettings());

    // Mount before installId: scoped read misses -> "default".
    expect(result.current.showThinking).toBe("default");

    // InstallIdProvider resolves: sets the module-global id and context value.
    act(() => {
      setCurrentInstallId("inst-1");
      mocks.installId = "inst-1";
    });
    rerender();

    expect(result.current.showThinking).toBe("on");
  });

  it("does not clobber an in-session showThinking change when installId arrives", async () => {
    const { setCurrentInstallId } = await import("../../lib/storageKeys");
    window.localStorage.setItem("yep-anywhere-inst-1-show-thinking", "on");

    mocks.installId = undefined;
    const { useModelSettings } = await import("../useModelSettings");
    const { result, rerender } = renderHook(() => useModelSettings());

    act(() => result.current.setShowThinking("off"));
    expect(result.current.showThinking).toBe("off");

    act(() => {
      setCurrentInstallId("inst-1");
      mocks.installId = "inst-1";
    });
    rerender();

    // User's explicit "off" wins over the stored "on".
    expect(result.current.showThinking).toBe("off");
    expect(
      window.localStorage.getItem("yep-anywhere-inst-1-show-thinking"),
    ).toBe("off");
  });

  it("stores showThinking clicks before installId under the legacy fallback", async () => {
    const { setCurrentInstallId } = await import("../../lib/storageKeys");
    const { useModelSettings } = await import("../useModelSettings");
    const { result, rerender } = renderHook(() => useModelSettings());

    act(() => result.current.setShowThinking("on"));

    expect(result.current.showThinking).toBe("on");
    expect(window.localStorage.getItem(LEGACY_KEYS.showThinking)).toBe("on");

    act(() => {
      setCurrentInstallId("inst-1");
      mocks.installId = "inst-1";
    });
    rerender();

    expect(
      window.localStorage.getItem("yep-anywhere-inst-1-show-thinking"),
    ).toBe("on");
  });

  it("stores the Parakeet model as a browser-local STT choice", async () => {
    const { useModelSettings } = await import("../useModelSettings");
    const { result } = renderHook(() => useModelSettings());

    act(() =>
      result.current.setParakeetSpeechModel("nvidia/parakeet-ctc-1.1b"),
    );

    expect(window.localStorage.getItem(LEGACY_KEYS.parakeetSpeechModel)).toBe(
      "nvidia/parakeet-ctc-1.1b",
    );
    expect(mocks.updateServerSettings).not.toHaveBeenCalledWith({
      clientDefaults: {
        speech: {
          parakeetSpeechModel: "nvidia/parakeet-ctc-1.1b",
        },
      },
    });
  });
});
