import { useEffect, useRef, useState } from "react";
import {
  redundantVhostEmail,
  vhostOauthPolicy,
  type VhostOauthLogEntry,
  type VhostOauthStatus,
} from "@yep-anywhere/shared";
import { Modal } from "../../components/ui/Modal";
import { useCurrentSourceRuntime } from "../../contexts/SourceRuntimeContext";
import { useI18n } from "../../i18n";
import { downloadBlob } from "../../lib/imageActions";
import styles from "./VhostOauthSettings.module.css";

type Update = (path: string, body: unknown) => Promise<void>;

export function VhostOauthProviderSettings({
  status,
  update,
}: {
  status: VhostOauthStatus;
  update: Update;
}) {
  const { t } = useI18n();
  const [provider, setProvider] = useState(status.provider);
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  return (
    <div className={styles.settings}>
      <p>
        {t(status.locked ? "vhostOauthEnvironment" : "vhostOauthProviderHint")}
      </p>
      <fieldset disabled={status.locked || busy} className={styles.fields}>
        <label>
          {t("vhostOauthProvider")}
          <select
            value={provider.kind}
            onChange={(e) =>
              setProvider({
                ...provider,
                kind: e.target.value as "entra" | "oidc",
              })
            }
          >
            <option value="entra">Microsoft Entra</option>
            <option value="oidc">OpenID Connect</option>
          </select>
        </label>
        {provider.kind === "entra" ? (
          <label>
            {t("vhostOauthTenant")}
            <input
              value={provider.tenantId}
              onChange={(e) =>
                setProvider({ ...provider, tenantId: e.target.value })
              }
            />
          </label>
        ) : (
          <label>
            {t("vhostOauthIssuer")}
            <input
              type="url"
              value={provider.issuer}
              onChange={(e) =>
                setProvider({ ...provider, issuer: e.target.value })
              }
            />
          </label>
        )}
        <label>
          {t("vhostOauthClientId")}
          <input
            value={provider.clientId}
            onChange={(e) =>
              setProvider({ ...provider, clientId: e.target.value })
            }
          />
        </label>
        <label>
          {t("vhostOauthCallback")}
          <input
            type="url"
            value={provider.callbackUrl}
            onChange={(e) =>
              setProvider({ ...provider, callbackUrl: e.target.value })
            }
          />
        </label>
        <label>
          {t("vhostOauthSecret")}
          <input
            type="password"
            autoComplete="new-password"
            value={secret}
            placeholder={status.secretConfigured ? "••••••••" : ""}
            onChange={(e) => setSecret(e.target.value)}
          />
        </label>
        <label>
          {t("vhostOauthIp")}
          <select
            value={provider.visitorIp}
            onChange={(e) =>
              setProvider({
                ...provider,
                visitorIp: e.target.value as typeof provider.visitorIp,
              })
            }
          >
            <option value="peer">{t("vhostOauthIpPeer")}</option>
            <option value="cloudflare">Cloudflare</option>
            <option value="x-real-ip">X-Real-IP</option>
          </select>
        </label>
        <p>{t("vhostOauthIpHint")}</p>
        <button
          type="button"
          onClick={async () => {
            setBusy(true);
            setMessage("");
            try {
              await update("/artifacts/vhosts/oauth", {
                provider,
                ...(secret ? { secret } : {}),
              });
              setSecret("");
              setMessage(t("artifactSaved"));
            } catch (error) {
              setMessage(String(error));
            } finally {
              setBusy(false);
            }
          }}
        >
          {t("vhostOauthConfigure")}
        </button>
      </fieldset>
      {message && <p role="status">{message}</p>}
    </div>
  );
}

export function VhostOauthEmails({
  name,
  status,
  update,
  disabled,
  focusRequest,
}: {
  name: string;
  status: VhostOauthStatus;
  update: Update;
  disabled: boolean;
  focusRequest: number;
}) {
  const { t } = useI18n();
  const saved = vhostOauthPolicy(status.policies, name);
  const enabled = saved !== undefined;
  const [rows, setRows] = useState(() =>
    (saved ?? ["*@*"]).map((value, id) => ({ value, id })),
  );
  const nextId = useRef(rows.length);
  const first = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!enabled) return;
    const frame = requestAnimationFrame(() => {
      first.current?.focus();
      first.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [enabled, focusRequest]);
  async function persist(emails: string[] | null) {
    setBusy(true);
    setMessage("");
    try {
      await update(`/artifacts/vhosts/${encodeURIComponent(name)}/oauth`, {
        emails,
      });
      setMessage(t("artifactSaved"));
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={styles.settings}>
      <label className={styles.toggle}>
        <input
          type="checkbox"
          checked={enabled}
          disabled={disabled || busy || !status.configured}
          onChange={(e) => {
            void persist(
              e.target.checked ? rows.map((row) => row.value) : null,
            );
            if (e.target.checked)
              requestAnimationFrame(() => {
                first.current?.focus();
                first.current?.select();
              });
          }}
        />
        {t("vhostOauthRequired")}
      </label>
      <p>
        {t(
          !status.configured
            ? "vhostOauthConfigureFirst"
            : "vhostOauthLocalExcluded",
        )}
      </p>
      {enabled && (
        <>
          <p>{t("vhostOauthEmailsHint")}</p>
          {rows.map((row, index) => {
            const redundant = redundantVhostEmail(
              rows.map((item) => item.value),
              index,
            );
            return (
              <div key={row.id}>
                <div className={styles.emailRow}>
                  <input
                    ref={index === 0 ? first : undefined}
                    className={redundant ? styles.redundant : undefined}
                    aria-label={t("vhostOauthEmail", { number: index + 1 })}
                    value={row.value}
                    autoComplete="off"
                    spellCheck={false}
                    disabled={disabled}
                    onChange={(e) =>
                      setRows((current) =>
                        current.map((item) =>
                          item.id === row.id
                            ? { ...item, value: e.target.value }
                            : item,
                        ),
                      )
                    }
                    onBlur={() => void persist(rows.map((item) => item.value))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void persist(rows.map((item) => item.value));
                      }
                    }}
                  />
                  <button
                    type="button"
                    disabled={disabled}
                    aria-label={t("vhostOauthRemoveEmail", {
                      number: index + 1,
                    })}
                    onClick={() => {
                      const next = rows.filter((item) => item.id !== row.id);
                      setRows(next);
                      void persist(next.map((item) => item.value));
                    }}
                  >
                    −
                  </button>
                </div>
                {redundant && (
                  <small className={styles.redundantHint}>
                    {t("vhostOauthRedundant", { email: redundant })}
                  </small>
                )}
              </div>
            );
          })}
          <button
            type="button"
            disabled={disabled || rows.length >= 32}
            onClick={() =>
              setRows((current) => [
                ...current,
                { id: nextId.current++, value: "" },
              ])
            }
          >
            {t("vhostOauthAddEmail")}
          </button>
          {rows.length === 0 && <p>{t("vhostOauthNobody")}</p>}
        </>
      )}
      {message && <p role="status">{message}</p>}
    </div>
  );
}

export function VhostOauthLogs({
  host,
  onClose,
}: {
  host?: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { transport } = useCurrentSourceRuntime();
  const [entries, setEntries] = useState<VhostOauthLogEntry[]>();
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: revision explicitly requests a fresh log snapshot.
  useEffect(() => {
    let cancelled = false;
    transport
      .fetch<{ entries: VhostOauthLogEntry[] }>(
        `/artifacts/vhosts/oauth/log${host ? `?host=${encodeURIComponent(host)}` : ""}`,
      )
      .then(
        (result) => {
          if (!cancelled) setEntries(result.entries);
        },
        (failure: unknown) => {
          if (!cancelled) setError(String(failure));
        },
      );
    return () => {
      cancelled = true;
    };
  }, [host, transport, revision]);
  return (
    <Modal
      title={host ?? t("vhostOauthAllLogs")}
      onClose={onClose}
      actions={
        <button type="button" onClick={() => setRevision((value) => value + 1)}>
          {t("vhostOauthRefresh")}
        </button>
      }
    >
      <div className={styles.settings}>
        <p>{t("vhostOauthLogHint")}</p>
        <button
          type="button"
          disabled={!entries?.length}
          onClick={() =>
            downloadBlob(
              new Blob(
                [
                  entries!.map((entry) => JSON.stringify(entry)).join("\n") +
                    "\n",
                ],
                { type: "application/x-ndjson" },
              ),
              "vhost-oauth-access.jsonl",
            )
          }
        >
          {t("vhostOauthDownload")}
        </button>
        {error && <p role="alert">{error}</p>}
        {entries?.length === 0 && <p>{t("vhostOauthNoLogs")}</p>}
        <div className={styles.logEntries}>
          {entries?.map((entry, index) => (
            <article
              key={`${entry.timestamp}:${index}`}
              className={styles.logEntry}
            >
              <time dateTime={entry.timestamp}>
                {new Date(entry.timestamp).toLocaleString()}
              </time>
              <strong>{entry.email ?? "—"}</strong>
              <span>{entry.host}</span>
              <span>
                {t(
                  entry.outcome === "allowed"
                    ? "vhostOauthAllowed"
                    : entry.outcome === "denied"
                      ? "vhostOauthDenied"
                      : "vhostOauthError",
                )}
                {entry.ip ? ` · ${entry.ip}` : ""}
              </span>
            </article>
          ))}
        </div>
      </div>
    </Modal>
  );
}
