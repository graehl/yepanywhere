import { IssueIcon } from "../components/IssueIcon";
import type {
  IssueItem,
  IssueSearchResult,
  IssueSessionsResult,
} from "@yep-anywhere/shared";
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useCurrentSourceRuntime } from "../contexts/SourceRuntimeContext";
import { useIssuesEnabled } from "../hooks/useIssuesEnabled";
import { useRemoteBasePath } from "../hooks/useRemoteBasePath";
import { useI18n } from "../i18n";
import { PageHeader } from "../components/PageHeader";
import { MainContent, useNavigationLayout } from "../layouts";
import { useSourceContextMenu } from "../components/SourceContextMenu";
import { IssueSessionRow } from "./IssueSessionRow";
import styles from "./IssuesPage.module.css";

export function IssuesPage() {
  const { t } = useI18n();
  const { openSidebar, isWideScreen } = useNavigationLayout();
  const enabled = useIssuesEnabled();
  const runtime = useCurrentSourceRuntime();
  const [scopeParams] = useSearchParams();
  return (
    <MainContent isWideScreen={isWideScreen}>
      <PageHeader title={t("issuesTitle")} onOpenSidebar={openSidebar} />
      {enabled ? (
        <IssueBrowser key={`${runtime.sourceKey}:${scopeParams.toString()}`} />
      ) : (
        <p className={styles.empty}>{t("issuesDisabled")}</p>
      )}
    </MainContent>
  );
}
function IssueBrowser() {
  const { t } = useI18n();
  const { transport } = useCurrentSourceRuntime();
  const base = useRemoteBasePath();
  const [params] = useSearchParams();
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [result, setResult] = useState<IssueSearchResult>();
  const [selected, setSelected] = useState<IssueItem>();
  const [detail, setDetail] = useState<IssueSessionsResult>();
  const [sessionOffset, setSessionOffset] = useState(0);
  const [sort, setSort] = useState("activity");
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{
    item: IssueItem;
    kind: "title" | "url" | "delete";
  }>();
  const [value, setValue] = useState("");
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const sessionId = params.get("sessionId") ?? "";
  const projectId = params.get("projectId") ?? "";
  const menu = useSourceContextMenu(t, {
    menu: t("issuesItemActions"),
    dismiss: t("issuesCancel"),
  });
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const next = await transport.fetch<IssueSearchResult>(
          `/issues?${new URLSearchParams({ q: query, offset: String(offset), dismissed: dismissed ? "1" : "0", sessionId, projectId, revision: String(revision) })}`,
        );
        if (!disposed) {
          setResult(next);
          setSelected((previous) => {
            const current = next.items.find((item) => item.id === previous?.id);
            return current &&
              previous &&
              (current.title !== previous.title ||
                current.url !== previous.url ||
                current.sessionCount !== previous.sessionCount)
              ? current
              : previous;
          });
          if (next.coverage.active) timer = setTimeout(load, 750);
        }
      } catch {
        if (!disposed) setError(t("issuesLoadError"));
      }
    };
    timer = setTimeout(() => void load(), 150);
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
    };
  }, [transport, query, offset, dismissed, sessionId, projectId, revision, t]);
  useEffect(() => {
    let disposed = false;
    setDetail(undefined);
    if (selected)
      void transport
        .fetch<IssueSessionsResult>(
          `/issues/sessions?${new URLSearchParams({ id: selected.id, offset: String(sessionOffset), sort, dismissed: dismissed ? "1" : "0", revision: String(revision) })}`,
        )
        .then((next) => {
          if (!disposed) setDetail(next);
        })
        .catch(() => {
          if (!disposed) setError(t("issuesLoadError"));
        });
    return () => {
      disposed = true;
    };
  }, [transport, selected, sessionOffset, sort, dismissed, revision, t]);
  const action = async (
    path: string,
    method: string,
    body?: unknown,
    saved?: (result: { title?: string | null }) => void,
  ) => {
    setBusy(true);
    setError("");
    try {
      const response = await transport.fetch<{ title?: string | null }>(path, {
        method,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (alive.current) {
        saved?.(response);
        setRevision((x) => x + 1);
        return true;
      }
    } catch {
      if (alive.current) setError(t("issuesSaveError"));
    } finally {
      if (alive.current) setBusy(false);
    }
    return false;
  };
  const select = (item: IssueItem) => {
    setEditing(undefined);
    setSelected(item);
    setSessionOffset(0);
  };
  const edit = (item: IssueItem, kind: "title" | "url" | "delete") => {
    if (kind === "url") select(item);
    setEditing({ item, kind });
    setValue(kind === "title" ? (item.title ?? "") : "");
  };
  const saveEdit = async () => {
    if (!editing) return;
    const { item, kind } = editing;
    let ok = false;
    if (kind === "title") {
      ok = await action(
        "/issues/item",
        "PATCH",
        { id: item.id, title: value.trim() || null },
        (response) => {
          setSelected((previous) =>
            previous?.id === item.id
              ? {
                  ...previous,
                  title:
                    response.title !== undefined
                      ? response.title
                      : value.trim() || null,
                }
              : previous,
          );
        },
      );
    } else if (kind === "delete") {
      ok = await action(
        `/issues/item?${new URLSearchParams({ id: item.id })}`,
        "DELETE",
      );
      if (ok)
        setSelected((previous) =>
          previous?.id === item.id ? undefined : previous,
        );
    } else {
      const first = detail?.sessions[0];
      if (first) {
        ok = await action("/issues/resolve", "POST", {
          url: value,
          key: item.key,
          projectId: first.projectId,
          sessionId: first.sessionId,
        });
        if (ok) setSelected(undefined);
      }
    }
    if (ok) setEditing(undefined);
  };
  return (
    <main className={styles.page}>
      <div className={styles.controls}>
        <input
          type="search"
          aria-label={t("issuesSearch")}
          placeholder={t("issuesSearch")}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOffset(0);
          }}
        />
        <button
          className={styles.button}
          type="button"
          onClick={() => setRevision((x) => x + 1)}
        >
          {t("issuesRefresh")}
        </button>
        <Link className={styles.settingsLink} to={`${base}/settings/issues`}>
          {t("issuesSettings")}
        </Link>
      </div>
      <details className={styles.coverage}>
        <summary>
          {result?.coverage.active
            ? t("issuesIndexing")
            : t("issuesDiscoveryDetails")}
        </summary>
        {result && (
          <p>
            {result.coverage.settings.scope === "viewed"
              ? t("issuesViewedCoverage")
              : t("issuesRecentCoverage", {
                  days: result.coverage.settings.recentDays,
                })}
          </p>
        )}
        <div className={styles.actions}>
          {result?.coverage.counts.map((row) => (
            <span key={row.state}>
              {t(`issuesState_${row.state}` as never)}: {row.count}
            </span>
          ))}
        </div>
        <label className={styles.choice}>
          <input
            type="checkbox"
            checked={dismissed}
            onChange={(e) => {
              setDismissed(e.target.checked);
              setOffset(0);
              setSessionOffset(0);
            }}
          />
          {t("issuesShowDismissed")}
        </label>
      </details>
      {sessionId && (
        <p>
          {t("issuesSessionFilter")}{" "}
          <Link to={`${base}/issues`}>{t("issuesAll")}</Link>
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      <div className={`${styles.columns} ${selected ? styles.withDetail : ""}`}>
        <section
          className={`${styles.list} ${editing ? styles.editingList : ""}`}
          aria-label={t("issuesResults")}
        >
          <div className={styles.listHeading}>{t("issuesKeyOrder")}</div>
          {result?.items.length === 0 && (
            <p className={styles.empty}>{t("issuesEmpty")}</p>
          )}
          {result?.items.map((item) => (
            <div
              key={item.id}
              className={`${styles.item} ${selected?.id === item.id ? styles.selected : ""}`}
            >
              <div className={styles.itemRow}>
                <button
                  type="button"
                  className={styles.itemSelect}
                  aria-pressed={selected?.id === item.id}
                  onClick={() => select(item)}
                >
                  <span className={styles.itemTitle}>
                    <IssueIcon />
                    <strong>{item.title ?? item.key}</strong>
                  </span>
                  <span className={styles.itemMeta}>
                    {item.title ? `${item.key} · ` : ""}
                    {item.provider} ·{" "}
                    {t(
                      item.sessionCount === 1
                        ? "issuesSingleSession"
                        : "issuesSessionCount",
                      { count: item.sessionCount },
                    )}
                  </span>
                  {item.unresolved && <small>{t("issuesUnresolved")}</small>}
                </button>
                <button
                  type="button"
                  className={styles.iconButton}
                  aria-label={t("issuesItemMenu", { key: item.key })}
                  onClick={(e) =>
                    menu.openFromButton(e, [
                      {
                        label: t(
                          item.unresolved ? "issuesResolve" : "issuesEditTitle",
                        ),
                        onSelect: () =>
                          edit(item, item.unresolved ? "url" : "title"),
                        disabled: busy,
                      },
                      {
                        label: t("issuesDelete"),
                        onSelect: () => edit(item, "delete"),
                        disabled: busy,
                      },
                    ])
                  }
                >
                  ⋯
                </button>
              </div>
              {editing?.item.id === item.id && (
                <form
                  className={styles.editor}
                  onSubmit={(e) => {
                    e.preventDefault();
                    void saveEdit();
                  }}
                >
                  {editing.kind === "delete" ? (
                    <p>{t("issuesDeleteHelp")}</p>
                  ) : (
                    <>
                      <label htmlFor="issue-edit-value">
                        {t(
                          editing.kind === "title"
                            ? "issuesTitleOverride"
                            : "issuesResolveHelp",
                        )}
                      </label>
                      <input
                        id="issue-edit-value"
                        aria-label={t(
                          editing.kind === "title"
                            ? "issuesTitleOverride"
                            : "issuesResolveUrl",
                        )}
                        type={editing.kind === "title" ? "text" : "url"}
                        maxLength={editing.kind === "title" ? 512 : 4096}
                        required={editing.kind === "url"}
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                      />
                    </>
                  )}
                  <div className={styles.actions}>
                    <button
                      className={styles.button}
                      disabled={
                        busy ||
                        (editing.kind === "url" && !detail?.sessions.length)
                      }
                      type="submit"
                    >
                      {t(
                        editing.kind === "title"
                          ? "issuesSaveTitle"
                          : editing.kind === "url"
                            ? "issuesResolve"
                            : "issuesDeleteConfirm",
                      )}
                    </button>
                    <button
                      className={styles.button}
                      type="button"
                      onClick={() => setEditing(undefined)}
                    >
                      {t("issuesCancel")}
                    </button>
                  </div>
                </form>
              )}
            </div>
          ))}
          <div className={styles.actions}>
            {offset > 0 && (
              <button
                className={styles.button}
                type="button"
                onClick={() => setOffset(Math.max(0, offset - 50))}
              >
                {t("issuesPrevious")}
              </button>
            )}
            {result?.nextOffset != null && (
              <button
                className={styles.button}
                type="button"
                onClick={() => setOffset(result.nextOffset!)}
              >
                {t("issuesNext")}
              </button>
            )}
          </div>
        </section>
        {selected && (
          <section
            className={styles.detail}
            aria-label={t("issuesAssociatedSessions")}
          >
            <div className={styles.actions}>
              <h2>{selected.title ?? selected.key}</h2>
              <button
                type="button"
                className={styles.iconButton}
                aria-label={t("issuesClose")}
                onClick={() => setSelected(undefined)}
              >
                ×
              </button>
            </div>
            {selected.url && (
              <a
                className={styles.externalLink}
                href={selected.url}
                target="_blank"
                rel="noreferrer"
              >
                {selected.key} ↗
              </a>
            )}
            <div className={styles.sessionHeading}>
              <h3>{t("issuesAssociatedSessions")}</h3>
              <select
                aria-label={t("issuesSessionSort")}
                value={sort}
                onChange={(e) => {
                  setSort(e.target.value);
                  setSessionOffset(0);
                }}
              >
                <option value="activity">{t("issuesActivityNewest")}</option>
                <option value="oldest">{t("issuesActivityOldest")}</option>
              </select>
            </div>
            {!detail && (
              <p className={styles.muted}>{t("issuesLoadingSessions")}</p>
            )}
            {detail?.sessions.length === 0 && (
              <p className={styles.empty}>{t("issuesNoSessions")}</p>
            )}
            {detail?.sessions.map((session) => (
              <IssueSessionRow
                key={`${selected.id}:${session.sessionId}:${revision}`}
                issueId={selected.id}
                session={session}
                unresolved={selected.unresolved}
                busy={busy}
                includeDismissed={dismissed}
                action={action}
              />
            ))}
            <div className={styles.actions}>
              {sessionOffset > 0 && (
                <button
                  className={styles.button}
                  type="button"
                  onClick={() =>
                    setSessionOffset(Math.max(0, sessionOffset - 50))
                  }
                >
                  {t("issuesPreviousSessions")}
                </button>
              )}
              {detail?.nextOffset != null && (
                <button
                  className={styles.button}
                  type="button"
                  onClick={() => setSessionOffset(detail.nextOffset!)}
                >
                  {t("issuesNextSessions")}
                </button>
              )}
            </div>
          </section>
        )}
      </div>
      {menu.menu}
    </main>
  );
}
