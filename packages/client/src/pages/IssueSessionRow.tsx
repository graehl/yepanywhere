import type {
  IssueEvidence,
  IssueEvidenceResult,
  IssueSession,
} from "@yep-anywhere/shared";
import { useEffect, useRef, useState } from "react";
import { SessionListItem } from "../components/SessionListItem";
import { useSourceContextMenu } from "../components/SourceContextMenu";
import { useCurrentSourceRuntime } from "../contexts/SourceRuntimeContext";
import { useRemoteBasePath } from "../hooks/useRemoteBasePath";
import { useI18n } from "../i18n";
import { formatBriefAge } from "../lib/sessionAge";
import styles from "./IssuesPage.module.css";

export function IssueSessionRow({
  issueId,
  session,
  unresolved,
  busy,
  includeDismissed,
  action,
}: {
  issueId: string;
  session: IssueSession;
  unresolved: boolean;
  busy: boolean;
  includeDismissed: boolean;
  action: (path: string, method: string, body?: unknown) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const { transport } = useCurrentSourceRuntime();
  const base = useRemoteBasePath();
  const menu = useSourceContextMenu(t, {
    menu: t("issuesAssociationActions"),
    dismiss: t("issuesCancel"),
  });
  const [expanded, setExpanded] = useState(false);
  const [evidence, setEvidence] = useState(session.evidence);
  const [nextOffset, setNextOffset] = useState<number | null>(
    session.evidence.length < session.evidenceCount
      ? session.evidence.length
      : null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const more = async () => {
    if (nextOffset === null || loading) return;
    setLoading(true);
    setError("");
    try {
      const next = await transport.fetch<IssueEvidenceResult>(
        `/issues/evidence?${new URLSearchParams({ id: issueId, sessionId: session.sessionId, offset: String(nextOffset), dismissed: includeDismissed ? "1" : "0" })}`,
      );
      if (alive.current) {
        setEvidence((previous) => [...previous, ...next.evidence]);
        setNextOffset(next.nextOffset);
      }
    } catch {
      if (alive.current) setError(t("issuesLoadError"));
    } finally {
      if (alive.current) setLoading(false);
    }
  };
  const age = formatBriefAge(session.updatedAt);
  const excerpt = (entry: IssueEvidence, compact: boolean) => (
    <div key={entry.id} className={styles.mention}>
      <p className={compact ? styles.excerpt : styles.expandedExcerpt}>
        {entry.excerpt || entry.value}
      </p>
      {entry.sourceTime && (
        <time className={styles.muted} dateTime={entry.sourceTime}>
          {new Date(entry.sourceTime).toLocaleString()}
        </time>
      )}
    </div>
  );
  return (
    <article
      className={styles.session}
      aria-label={session.title ?? session.sessionId}
    >
      <div className={styles.sessionRow}>
        <div className={styles.sessionIdentity}>
          {session.sourceAvailable === false ? (
            <span>
              {session.title ?? session.sessionId} ·{" "}
              {t("issuesSourceUnavailable")}
            </span>
          ) : (
            <SessionListItem
              sessionId={session.sessionId}
              projectId={session.projectId}
              title={session.title ?? session.sessionId}
              initialPrompt={session.initialPrompt}
              lastAgentText={session.lastAgentText}
              provider={session.provider}
              model={session.model}
              status={session.ownership}
              activity={session.activity}
              updatedAt={session.updatedAt}
              createdAt={session.createdAt}
              mode="compact"
              showMenu={false}
              showProjectName
              projectName={session.projectName}
              basePath={base}
            />
          )}
        </div>
        <button
          className={styles.iconButton}
          type="button"
          aria-label={t("issuesAssociationActions")}
          onClick={(e) =>
            menu.openFromButton(e, [
              ...(unresolved ||
              session.state === "confirmed" ||
              session.state === "dismissed"
                ? []
                : [
                    {
                      label: t("issuesConfirm"),
                      disabled: busy,
                      onSelect: () => {
                        void action("/issues/decision", "POST", {
                          id: issueId,
                          sessionId: session.sessionId,
                          state: "confirmed",
                        });
                      },
                    },
                  ]),
              {
                label: t(
                  session.state === "dismissed"
                    ? "issuesRestore"
                    : "issuesDismiss",
                ),
                disabled: busy,
                onSelect: () => {
                  void action("/issues/decision", "POST", {
                    id: issueId,
                    sessionId: session.sessionId,
                    state:
                      session.state === "dismissed"
                        ? "discovered"
                        : "dismissed",
                  });
                },
              },
            ])
          }
        >
          ⋯
        </button>
      </div>
      <div className={styles.sessionMeta}>
        <span
          title={
            session.updatedAt
              ? new Date(session.updatedAt).toLocaleString()
              : undefined
          }
        >
          {age ? t("issuesLastActivity", { age }) : t("issuesActivityUnknown")}
        </span>
        <span>
          {t(
            session.evidenceCount === 1
              ? "issuesSingleMention"
              : "issuesMentionCount",
            { count: session.evidenceCount },
          )}
        </span>
      </div>
      {(expanded ? evidence : evidence.slice(0, 1)).map((entry) =>
        excerpt(entry, !expanded),
      )}
      {session.evidenceCount > 1 && (
        <button
          className={styles.textButton}
          type="button"
          aria-expanded={expanded}
          onClick={() => {
            setExpanded(!expanded);
            if (!expanded && evidence.length === 1) void more();
          }}
        >
          {t(expanded ? "issuesFewerMentions" : "issuesMoreMentions", {
            count: session.evidenceCount - 1,
          })}
        </button>
      )}
      {expanded && evidence.length > 1 && nextOffset !== null && (
        <button
          className={styles.textButton}
          type="button"
          disabled={loading}
          onClick={() => void more()}
        >
          {t("issuesMoreEvidence")}
        </button>
      )}
      {loading && (
        <span className={styles.muted}>{t("issuesLoadingMentions")}</span>
      )}
      {error && <p role="alert">{error}</p>}
      {menu.menu}
    </article>
  );
}
