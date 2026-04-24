import { useEffect, useState } from "react";
import { useCodexUpdateStatus } from "../hooks/useCodexUpdateStatus";
import { useServerSettings } from "../hooks/useServerSettings";

const STORAGE_KEY = "codex-update-seen-tag";

function readSeenTag(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeSeenTag(tag: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, tag);
  } catch {
    // Storage denied / full: prompt will reappear next session.
  }
}

export function CodexUpdatePrompt() {
  const { status, isInstalling, install } = useCodexUpdateStatus();
  const { settings, updateSetting } = useServerSettings();
  const [seenTag, setSeenTag] = useState<string | null>(() => readSeenTag());
  const [autoUpdate, setAutoUpdate] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const policy = settings?.codexUpdatePolicy ?? "notify";

  useEffect(() => {
    setSeenTag(readSeenTag());
  }, []);

  const latestTag = status?.latest ?? null;
  const shouldShow =
    !dismissed &&
    policy === "notify" &&
    !!status &&
    status.updateAvailable &&
    status.updateMethod === "npm" &&
    !!latestTag &&
    latestTag !== seenTag;

  if (!shouldShow || !status || !latestTag) {
    return null;
  }

  const close = () => {
    writeSeenTag(latestTag);
    setSeenTag(latestTag);
    setDismissed(true);
  };

  const handleUpdate = async () => {
    if (autoUpdate) {
      try {
        await updateSetting("codexUpdatePolicy", "auto");
      } catch {
        // Setting failure shouldn't block the install; surface via toast elsewhere.
      }
    }
    await install();
    close();
  };

  const handleNotNow = () => {
    close();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="codex-update-prompt-title"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <div
        style={{
          background: "var(--color-surface, #fff)",
          color: "var(--color-text, #111)",
          padding: "var(--space-4, 20px)",
          borderRadius: 8,
          maxWidth: 440,
          width: "90%",
          boxShadow: "0 10px 30px rgba(0,0,0,0.2)",
        }}
      >
        <h3 id="codex-update-prompt-title" style={{ marginTop: 0 }}>
          Codex CLI update available
        </h3>
        <p>
          Codex {status.installed} → <strong>{status.latest}</strong> is ready
          to install.
        </p>
        <label
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            marginTop: "var(--space-2, 8px)",
          }}
        >
          <input
            type="checkbox"
            checked={autoUpdate}
            onChange={(e) => setAutoUpdate(e.target.checked)}
          />
          <span>Auto-update future Codex releases</span>
        </label>
        <div
          style={{
            display: "flex",
            gap: 8,
            justifyContent: "flex-end",
            marginTop: "var(--space-3, 12px)",
          }}
        >
          <button
            type="button"
            className="settings-button"
            onClick={handleNotNow}
            disabled={isInstalling}
          >
            Not now
          </button>
          <button
            type="button"
            className="settings-button"
            onClick={() => void handleUpdate()}
            disabled={isInstalling}
          >
            {isInstalling ? "Installing…" : "Update now"}
          </button>
        </div>
      </div>
    </div>
  );
}
