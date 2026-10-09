import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  readNewSessionDisplayDefaults,
  writeNewSessionDisplayDefaults,
} from "../newSessionDisplayDefaults";

beforeEach(() => localStorage.clear());

describe("new session display defaults", () => {
  it("isolates server sources and excludes launch/configuration fields", () => {
    writeNewSessionDisplayDefaults("host:one", {
      provider: "claude",
      permissionMode: "bypassPermissions",
      sandboxLevel: "none",
      providers: {
        claude: {
          model: "sonnet",
          thinkingMode: "on",
          effortLevel: "high",
          serviceTier: "fast",
          helperSideModel: "private-helper",
        },
      },
    });
    expect(readNewSessionDisplayDefaults("host:two")).toBeUndefined();
    expect(readNewSessionDisplayDefaults("host:one")).toEqual({
      provider: "claude",
      providers: {
        claude: { model: "sonnet", thinkingMode: "on", effortLevel: "high" },
      },
    });
    const stored = localStorage.getItem("ya:new-session-display:host:one");
    expect(stored).not.toMatch(
      /permissionMode|sandboxLevel|serviceTier|private-helper/,
    );
  });

  it("expires old display defaults and removes cleared settings", () => {
    vi.useFakeTimers();
    try {
      writeNewSessionDisplayDefaults("local", { provider: "codex" });
      vi.advanceTimersByTime(8 * 24 * 60 * 60_000);
      expect(readNewSessionDisplayDefaults("local")).toBeUndefined();
      writeNewSessionDisplayDefaults("local", { provider: "claude" });
      writeNewSessionDisplayDefaults("local", undefined);
      expect(readNewSessionDisplayDefaults("local")).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    "broken JSON",
    "null",
    '{"version":2}',
    '{"version":1,"savedAt":"today"}',
  ])("ignores invalid storage: %s", (raw) => {
    localStorage.setItem("ya:new-session-display:local", raw);
    expect(readNewSessionDisplayDefaults("local")).toBeUndefined();
  });
});
