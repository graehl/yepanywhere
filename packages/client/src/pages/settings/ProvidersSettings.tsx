import { useCallback, useEffect, useState } from "react";
import { useToastContext } from "../../contexts/ToastContext";
import { useCodexUpdateStatus } from "../../hooks/useCodexUpdateStatus";
import { useProviders } from "../../hooks/useProviders";
import { useServerSettings } from "../../hooks/useServerSettings";
import { useI18n } from "../../i18n";
import { getAllProviders } from "../../providers/registry";

const DEFAULT_OLLAMA_SYSTEM_PROMPT =
  "You are a helpful coding assistant. You help users with software engineering tasks. You have access to tools for reading files, editing files, running shell commands, and searching code. Use tools when needed to answer questions or make changes. Be concise and direct.";

function OllamaUrlInput() {
  const { t } = useI18n();
  const { settings, updateSetting } = useServerSettings();
  const [url, setUrl] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  const serverValue = settings?.ollamaUrl ?? "";

  useEffect(() => {
    if (settings) {
      setUrl(settings.ollamaUrl ?? "");
    }
  }, [settings]);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      await updateSetting("ollamaUrl", url.trim() || undefined);
      setHasChanges(false);
    } catch {
      // Error handled by useServerSettings
    } finally {
      setIsSaving(false);
    }
  }, [url, updateSetting]);

  return (
    <div style={{ marginTop: "var(--space-2)", width: "100%" }}>
      <div
        style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}
      >
        <input
          type="text"
          className="settings-input"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setHasChanges(e.target.value !== serverValue);
          }}
          placeholder="http://localhost:11434"
          style={{ flex: 1 }}
        />
        <button
          type="button"
          className="settings-button"
          disabled={!hasChanges || isSaving}
          onClick={handleSave}
        >
          {isSaving ? t("providersSaving") : t("providersSave")}
        </button>
      </div>
      <span className="settings-hint">{t("providersOllamaUrlHint")}</span>
    </div>
  );
}

function OllamaUseFullSystemPrompt() {
  const { t } = useI18n();
  const { settings, updateSetting } = useServerSettings();
  const enabled = settings?.ollamaUseFullSystemPrompt ?? false;

  return (
    <label
      style={{
        display: "flex",
        gap: "var(--space-2)",
        alignItems: "center",
        marginTop: "var(--space-2)",
        cursor: "pointer",
      }}
    >
      <input
        type="checkbox"
        checked={enabled}
        onChange={(e) =>
          updateSetting("ollamaUseFullSystemPrompt", e.target.checked)
        }
      />
      <span>{t("providersUseFullPrompt")}</span>
      <span className="settings-hint" style={{ marginLeft: "auto" }}>
        {t("providersUseFullPromptHint")}
      </span>
    </label>
  );
}

function OllamaSystemPromptInput() {
  const { t } = useI18n();
  const { settings, updateSetting } = useServerSettings();
  const [prompt, setPrompt] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  const serverValue = settings?.ollamaSystemPrompt ?? "";

  useEffect(() => {
    if (settings) {
      setPrompt(settings.ollamaSystemPrompt ?? "");
    }
  }, [settings]);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      await updateSetting("ollamaSystemPrompt", prompt.trim() || undefined);
      setHasChanges(false);
    } catch {
      // Error handled by useServerSettings
    } finally {
      setIsSaving(false);
    }
  }, [prompt, updateSetting]);

  return (
    <div style={{ marginTop: "var(--space-2)", width: "100%" }}>
      <textarea
        className="settings-textarea"
        value={prompt}
        onChange={(e) => {
          setPrompt(e.target.value);
          setHasChanges(e.target.value !== serverValue);
        }}
        placeholder={DEFAULT_OLLAMA_SYSTEM_PROMPT}
        rows={4}
      />
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: "var(--space-2)",
        }}
      >
        <span className="settings-hint">{t("providersOllamaPromptHint")}</span>
        <button
          type="button"
          className="settings-button"
          disabled={!hasChanges || isSaving}
          onClick={handleSave}
        >
          {isSaving ? t("providersSaving") : t("providersSave")}
        </button>
      </div>
    </div>
  );
}

function CodexUpdatePanel() {
  const { showToast } = useToastContext();
  const { settings, updateSetting } = useServerSettings();
  const {
    status,
    isChecking,
    isInstalling,
    error,
    installOutput,
    refresh,
    install,
  } = useCodexUpdateStatus();

  const policy = settings?.codexUpdatePolicy ?? "notify";
  const canAuto = status?.updateMethod === "npm";

  const copy = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        showToast("Command copied", "success");
      } catch {
        showToast("Copy failed", "error");
      }
    },
    [showToast],
  );

  if (!status || !status.installed || !status.latest) {
    return null;
  }

  const updateAvailable = status.updateAvailable;

  return (
    <div style={{ marginTop: "var(--space-2)", width: "100%" }}>
      <div
        style={{
          display: "flex",
          gap: "var(--space-2)",
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        {updateAvailable ? (
          <span>
            <strong>Update available:</strong> {status.installed} →{" "}
            {status.latest}
          </span>
        ) : (
          <span className="settings-hint">
            Codex CLI {status.installed} is up to date
          </span>
        )}
        <button
          type="button"
          className="settings-button"
          onClick={() => void refresh(true)}
          disabled={isChecking}
          style={{ marginLeft: "auto" }}
        >
          {isChecking ? "Checking…" : "Check now"}
        </button>
        {status.releaseUrl && updateAvailable && (
          <a
            href={status.releaseUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="settings-link"
          >
            Release notes
          </a>
        )}
      </div>

      {updateAvailable && (
        <div
          style={{
            display: "flex",
            gap: "var(--space-2)",
            alignItems: "center",
            marginTop: "var(--space-2)",
            flexWrap: "wrap",
          }}
        >
          {status.updateMethod === "npm" ? (
            <button
              type="button"
              className="settings-button"
              onClick={() => void install()}
              disabled={isInstalling}
            >
              {isInstalling ? "Installing…" : "Update now"}
            </button>
          ) : (
            <span className="settings-hint">
              Update with your installer:
            </span>
          )}
          {status.manualInstallCommand && (
            <>
              <code
                style={{
                  padding: "2px 6px",
                  background: "var(--color-surface-raised, #f5f5f5)",
                  borderRadius: 4,
                  fontSize: "0.85em",
                }}
              >
                {status.manualInstallCommand}
              </code>
              <button
                type="button"
                className="settings-button"
                onClick={() => void copy(status.manualInstallCommand ?? "")}
              >
                Copy
              </button>
            </>
          )}
        </div>
      )}

      {error && (
        <p className="settings-hint" style={{ color: "var(--color-error)" }}>
          {error}
        </p>
      )}
      {installOutput && (
        <details style={{ marginTop: "var(--space-2)" }}>
          <summary className="settings-hint">Install output</summary>
          <pre
            style={{
              fontSize: "0.8em",
              whiteSpace: "pre-wrap",
              maxHeight: 200,
              overflow: "auto",
            }}
          >
            {installOutput}
          </pre>
        </details>
      )}

      <fieldset
        style={{
          border: "none",
          padding: 0,
          marginTop: "var(--space-3)",
          display: "flex",
          gap: "var(--space-3)",
          flexWrap: "wrap",
        }}
      >
        <legend className="settings-hint" style={{ marginBottom: 4 }}>
          Update policy
        </legend>
        {(["auto", "notify", "off"] as const).map((value) => {
          const disabled = value === "auto" && !canAuto;
          return (
            <label
              key={value}
              style={{
                display: "inline-flex",
                gap: 4,
                alignItems: "center",
                opacity: disabled ? 0.55 : 1,
                cursor: disabled ? "not-allowed" : "pointer",
              }}
              title={
                disabled
                  ? "Auto requires an npm-global install"
                  : undefined
              }
            >
              <input
                type="radio"
                name="codex-update-policy"
                value={value}
                checked={policy === value}
                disabled={disabled}
                onChange={() =>
                  void updateSetting("codexUpdatePolicy", value)
                }
              />
              <span>
                {value === "auto"
                  ? "Auto"
                  : value === "notify"
                    ? "Notify me"
                    : "Off"}
              </span>
            </label>
          );
        })}
      </fieldset>
    </div>
  );
}

function OllamaSettings() {
  const { settings } = useServerSettings();
  const useFullPrompt = settings?.ollamaUseFullSystemPrompt ?? false;

  return (
    <>
      <OllamaUrlInput />
      <OllamaUseFullSystemPrompt />
      {!useFullPrompt && <OllamaSystemPromptInput />}
    </>
  );
}

export function ProvidersSettings() {
  const { t } = useI18n();
  const { showToast } = useToastContext();
  const { providers: serverProviders, loading: providersLoading } =
    useProviders();

  const handleCopyClaudeLoginCommand = useCallback(async () => {
    try {
      await navigator.clipboard.writeText("claude auth login --claudeai");
      showToast(t("providersClaudeLoginCommandCopied"), "success");
    } catch {
      showToast(t("providersClaudeLoginCommandCopyError"), "error");
    }
  }, [showToast, t]);

  // Merge server detection status with client-side metadata
  const registeredProviders = getAllProviders();
  const providerDisplayList = registeredProviders.map((clientProvider) => {
    const serverInfo = serverProviders.find(
      (p) => p.name === clientProvider.id,
    );
    return {
      ...clientProvider,
      installed: serverInfo?.installed ?? false,
      authenticated: serverInfo?.authenticated ?? false,
    };
  });

  return (
    <section className="settings-section">
      <h2>{t("providersSectionTitle")}</h2>
      <p className="settings-section-description">
        {t("providersSectionDescription")}
      </p>
      <div className="settings-group">
        {providerDisplayList.map((provider) => (
          <div key={provider.id} className="settings-item">
            <div className="settings-item-info">
              <div className="settings-item-header">
                <strong>{provider.displayName}</strong>
                {provider.installed ? (
                  <span className="settings-status-badge settings-status-detected">
                    {t("providersDetected")}
                  </span>
                ) : (
                  <span className="settings-status-badge settings-status-not-detected">
                    {t("providersNotDetected")}
                  </span>
                )}
              </div>
              <p>{provider.metadata.description}</p>
              {provider.metadata.limitations.length > 0 && (
                <ul className="settings-limitations">
                  {provider.metadata.limitations.map((limitation) => (
                    <li key={limitation}>{limitation}</li>
                  ))}
                </ul>
              )}
              {provider.id === "claude" &&
                provider.installed &&
                !provider.authenticated && (
                  <div style={{ marginTop: "var(--space-2)" }}>
                    <p className="settings-hint">
                      {t("providersClaudeLoginHint")}
                    </p>
                    <button
                      type="button"
                      className="settings-button"
                      onClick={() => void handleCopyClaudeLoginCommand()}
                      style={{ marginTop: "var(--space-2)" }}
                    >
                      {t("providersClaudeLoginCommandCopy")}
                    </button>
                  </div>
                )}
              {provider.id === "claude-ollama" && <OllamaSettings />}
              {provider.id === "codex" && provider.installed && (
                <CodexUpdatePanel />
              )}
            </div>
            {provider.metadata.website && (
              <a
                href={provider.metadata.website}
                target="_blank"
                rel="noopener noreferrer"
                className="settings-link"
              >
                {t("providersWebsite")}
              </a>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
