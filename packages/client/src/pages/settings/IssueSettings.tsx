import {
  DEFAULT_JIRA_KEY_BLOCKLIST,
  SERVER_CAPABILITIES,
  serverHasCapability,
  type IssueCoverage,
  type KnownJiraProject,
  type IssueCredentialStatus,
  type IssueCredentialsResult,
  type IssueSettings as Settings,
} from "@yep-anywhere/shared";
import { useEffect, useRef, useState } from "react";
import { useCurrentSourceRuntime } from "../../contexts/SourceRuntimeContext";
import { useServerSettings } from "../../hooks/useServerSettings";
import { useVersion } from "../../hooks/useVersion";
import { useI18n } from "../../i18n";
import { SettingsItem } from "./SettingsItem";
import { SettingsSection } from "./SettingsSection";
import { useSettingsPaneTitle } from "./SettingsPaneTitleContext";
import styles from "./IssueSettings.module.css";

export function IssueSettings() {
  const { t } = useI18n();
  const { version: versionInfo } = useVersion();
  const runtime = useCurrentSourceRuntime();
  useSettingsPaneTitle(t("issuesTitle"));
  const supported = serverHasCapability(
    versionInfo,
    SERVER_CAPABILITIES.issueSessionAssociations.name,
  );
  return (
    <SettingsSection
      title={t("issuesTitle")}
      description={t("issuesDescription")}
    >
      {supported ? (
        <IssueSettingsControls key={runtime.sourceKey} />
      ) : (
        <p>{t("issuesUnavailable")}</p>
      )}
    </SettingsSection>
  );
}
function IssueSettingsControls() {
  const { t } = useI18n();
  const { transport } = useCurrentSourceRuntime();
  const { refetch } = useServerSettings();
  const [settings, setSettings] = useState<Settings>();
  const [projects, setProjects] = useState<KnownJiraProject[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const source = useRef(transport);
  source.current = transport;
  useEffect(() => {
    let disposed = false;
    setSettings(undefined);
    setError("");
    setBusy(false);
    transport
      .fetch<IssueCoverage>("/issues/settings")
      .then((result) => {
        if (!disposed) {
          setSettings(result.settings);
          setProjects(result.knownJiraProjects ?? []);
        }
      })
      .catch(() => {
        if (!disposed) setError(t("issuesLoadError"));
      });
    return () => {
      disposed = true;
    };
  }, [transport, t]);
  const save = async (next: Settings) => {
    const previous = settings;
    setSettings(next);
    setBusy(true);
    setError("");
    try {
      const result = await transport.fetch<IssueCoverage>("/issues/settings", {
        method: "PUT",
        body: JSON.stringify(next),
      });
      if (source.current === transport) {
        setSettings(result.settings);
        setProjects(result.knownJiraProjects ?? []);
        await refetch();
      }
    } catch {
      if (source.current === transport) {
        setSettings(previous);
        setError(t("issuesSaveError"));
      }
    } finally {
      if (source.current === transport) setBusy(false);
    }
  };
  return (
    <div className={styles.settings}>
      <SettingsItem
        as="label"
        id="issue-discovery-enabled"
        label={t("issuesEnable")}
        description={t("issuesRetention")}
      >
        <span className={`toggle-switch ${styles.toggle}`}>
          <input
            type="checkbox"
            aria-label={t("issuesEnable")}
            checked={settings?.enabled ?? false}
            disabled={!settings || busy}
            onChange={(e) =>
              settings && void save({ ...settings, enabled: e.target.checked })
            }
          />
          <span className="toggle-slider" />
        </span>
      </SettingsItem>
      <SettingsItem
        id="issue-discovery-scope"
        label={t("issuesScope")}
        className={styles.scopeRow}
        description={
          settings?.scope === "recent"
            ? t("issuesRecentHelp")
            : t("issuesViewedHelp")
        }
      >
        <select
          className={styles.control}
          aria-label={t("issuesScope")}
          value={settings?.scope ?? "viewed"}
          disabled={!settings || busy}
          onChange={(e) =>
            settings &&
            void save({
              ...settings,
              scope: e.target.value as Settings["scope"],
            })
          }
        >
          <option value="viewed">{t("issuesViewed")}</option>
          <option value="recent">{t("issuesRecent")}</option>
        </select>
      </SettingsItem>
      {settings?.scope === "recent" && (
        <SettingsItem id="issue-discovery-days" label={t("issuesDays")}>
          <input
            className={styles.days}
            type="number"
            aria-label={t("issuesDays")}
            min={1}
            max={90}
            defaultValue={settings.recentDays}
            disabled={busy}
            onBlur={(e) => {
              const days = Number(e.target.value);
              if (Number.isInteger(days) && days >= 1 && days <= 90)
                void save({ ...settings, recentDays: days });
              else e.target.value = String(settings.recentDays);
            }}
          />
        </SettingsItem>
      )}
      <SettingsItem
        as="label"
        id="issue-aggressive-matching"
        label={t("issuesAggressiveMatching")}
        description={t("issuesAggressiveHelp")}
      >
        <span className={`toggle-switch ${styles.toggle}`}>
          <input
            type="checkbox"
            aria-label={t("issuesAggressiveMatching")}
            checked={settings?.aggressiveMatching ?? false}
            disabled={!settings || busy}
            onChange={(e) =>
              settings &&
              void save({ ...settings, aggressiveMatching: e.target.checked })
            }
          />
          <span className="toggle-slider" />
        </span>
      </SettingsItem>
      <SettingsItem
        id="issue-known-projects"
        className={styles.scopeRow}
        label={t("issuesKnownProjects")}
        description={t("issuesKnownProjectsHelp")}
      >
        {projects.length ? (
          <ul className={styles.projects}>
            {projects.map((project) => (
              <li key={`${project.prefix}:${project.site}`}>
                <strong>{project.prefix}</strong> · {project.site}
              </li>
            ))}
          </ul>
        ) : (
          <span>{t("issuesNoKnownProjects")}</span>
        )}
      </SettingsItem>
      {settings && (
        <ConfirmationControls settings={settings} busy={busy} save={save} />
      )}
      {settings && (
        <BlocklistControl settings={settings} busy={busy} save={save} />
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

interface ControlProps {
  settings: Settings;
  busy: boolean;
  save: (next: Settings) => Promise<void>;
}

const NO_CONFIRMATION: NonNullable<Settings["confirmation"]> = {
  enabled: false,
  jiraSite: "",
  jiraEmail: "",
};

/**
 * Opt-in tracker confirmation, with the credential inventory beside it.
 *
 * The point of showing every source by name is that most installations
 * already have one: the pane says where a credential would come from and
 * whether it is there, without ever displaying it.
 */
function ConfirmationControls({ settings, busy, save }: ControlProps) {
  const { t } = useI18n();
  const { transport } = useCurrentSourceRuntime();
  const [credentials, setCredentials] = useState<IssueCredentialStatus[]>();
  const [saving, setSaving] = useState("");
  const confirmation = settings.confirmation ?? NO_CONFIRMATION;
  const update = (next: Partial<typeof confirmation>) =>
    void save({ ...settings, confirmation: { ...confirmation, ...next } });
  useEffect(() => {
    let disposed = false;
    setCredentials(undefined);
    transport
      .fetch<IssueCredentialsResult>("/issues/credentials")
      .then((result) => {
        if (!disposed) setCredentials(result.credentials);
      })
      .catch(() => {
        if (!disposed) setCredentials([]);
      });
    return () => {
      disposed = true;
    };
  }, [transport]);
  const storeKey = async (provider: string, key: string) => {
    setSaving(provider);
    try {
      const result = await transport.fetch<IssueCredentialsResult>(
        "/issues/credentials",
        { method: "PUT", body: JSON.stringify({ provider, key }) },
      );
      setCredentials(result.credentials);
    } finally {
      setSaving("");
    }
  };
  return (
    <>
      <SettingsItem
        as="label"
        id="issue-confirm-enabled"
        label={t("issuesConfirmEnable")}
        description={t("issuesConfirmHelp")}
      >
        <span className={`toggle-switch ${styles.toggle}`}>
          <input
            type="checkbox"
            aria-label={t("issuesConfirmEnable")}
            checked={confirmation.enabled}
            disabled={busy}
            onChange={(e) => update({ enabled: e.target.checked })}
          />
          <span className="toggle-slider" />
        </span>
      </SettingsItem>
      {confirmation.enabled && (
        <>
          <SettingsItem
            id="issue-confirm-jira-site"
            label={t("issuesJiraSite")}
          >
            <input
              className={styles.control}
              type="url"
              aria-label={t("issuesJiraSite")}
              placeholder="https://example.atlassian.net"
              defaultValue={confirmation.jiraSite}
              disabled={busy}
              onBlur={(e) => update({ jiraSite: e.target.value.trim() })}
            />
          </SettingsItem>
          <SettingsItem
            id="issue-confirm-jira-email"
            label={t("issuesJiraEmail")}
          >
            <input
              className={styles.control}
              type="email"
              aria-label={t("issuesJiraEmail")}
              defaultValue={confirmation.jiraEmail}
              disabled={busy}
              onBlur={(e) => update({ jiraEmail: e.target.value.trim() })}
            />
          </SettingsItem>
          {credentials?.map((credential) => (
            <CredentialControl
              key={credential.provider}
              credential={credential}
              busy={saving === credential.provider}
              store={storeKey}
            />
          ))}
        </>
      )}
    </>
  );
}

function CredentialControl({
  credential,
  busy,
  store,
}: {
  credential: IssueCredentialStatus;
  busy: boolean;
  store: (provider: string, key: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const [key, setKey] = useState("");
  const label =
    credential.provider === "github"
      ? t("issuesCredentialGithub")
      : t("issuesCredentialJira");
  const stored = credential.sources.find((source) => source.kind === "stored");
  return (
    <fieldset className={styles.credential}>
      <legend>{label}</legend>
      <p>
        {credential.active
          ? t("issuesCredentialActive", { source: credential.active })
          : t("issuesCredentialMissing")}
      </p>
      <ul>
        {credential.sources.map((source) => (
          <li key={source.name}>
            {source.name}
            {": "}
            {source.present
              ? t("issuesCredentialPresent")
              : t("issuesCredentialAbsent")}
          </li>
        ))}
      </ul>
      <label className={styles.stacked}>
        {t("issuesCredentialOverride")}
        <input
          type="password"
          aria-label={`${label}: ${t("issuesCredentialOverride")}`}
          autoComplete="off"
          value={key}
          disabled={busy}
          onChange={(e) => setKey(e.target.value)}
        />
      </label>
      <button
        type="button"
        disabled={busy || !key.trim()}
        onClick={() => {
          void store(credential.provider, key.trim()).then(() => setKey(""));
        }}
      >
        {t("issuesCredentialSave")}
      </button>
      {stored?.present && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void store(credential.provider, "")}
        >
          {t("issuesCredentialClear")}
        </button>
      )}
    </fieldset>
  );
}

/** The project names that never become a ticket when seen without a URL. */
function BlocklistControl({ settings, busy, save }: ControlProps) {
  const { t } = useI18n();
  const current = settings.jiraKeyBlocklist ?? [...DEFAULT_JIRA_KEY_BLOCKLIST];
  return (
    <SettingsItem id="issue-jira-blocklist" label={t("issuesBlocklist")}>
      <input
        type="text"
        className={`${styles.control} ${styles.names}`}
        aria-label={t("issuesBlocklist")}
        defaultValue={current.join(" ")}
        disabled={busy}
        onBlur={(e) => {
          const names = e.target.value
            .toUpperCase()
            .split(/[\s,]+/)
            .filter(Boolean);
          if (names.every((name) => /^[A-Z][A-Z0-9_]{0,31}$/.test(name)))
            void save({ ...settings, jiraKeyBlocklist: names });
          else e.target.value = current.join(" ");
        }}
      />
    </SettingsItem>
  );
}
