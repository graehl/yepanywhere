import type {
  ProjectWorkstreamsResponse,
  Workstream,
  WorkstreamKind,
  WorkstreamStatus,
} from "@yep-anywhere/shared";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api/client";
import { PageHeader } from "../components/PageHeader";
import { useServerSettings } from "../hooks/useServerSettings";
import { useI18n } from "../i18n";
import { MainContent, useNavigationLayout } from "../layouts";

type WorkstreamsLoadState =
  | { status: "idle" | "loading" }
  | { status: "loaded"; data: ProjectWorkstreamsResponse }
  | { status: "error"; error: Error; statusCode?: number };

function errorStatus(error: unknown): number | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof (error as { status?: unknown }).status === "number"
  ) {
    return (error as { status: number }).status;
  }
  return undefined;
}

function errorMessage(error: unknown, fallback: string): Error {
  return error instanceof Error ? error : new Error(fallback);
}

function WorkstreamsStateMessage({
  title,
  message,
  variant = "neutral",
}: {
  title: string;
  message?: string;
  variant?: "neutral" | "error";
}) {
  return (
    <div
      className={`workstreams-state workstreams-state--${variant}`}
      role={variant === "error" ? "alert" : "status"}
    >
      <h2>{title}</h2>
      {message ? <p>{message}</p> : null}
    </div>
  );
}

export function WorkstreamsPage() {
  const { t } = useI18n();
  const { projectId } = useParams<{ projectId: string }>();
  const {
    settings,
    isLoading: settingsLoading,
    error: settingsError,
  } = useServerSettings();
  const { openSidebar, isWideScreen, toggleSidebar, isSidebarCollapsed } =
    useNavigationLayout();
  const [loadState, setLoadState] = useState<WorkstreamsLoadState>({
    status: "idle",
  });
  const enabled = settings?.workstreamsEnabled === true;

  useEffect(() => {
    if (!enabled || !projectId) {
      setLoadState({ status: "idle" });
      return undefined;
    }

    let cancelled = false;
    setLoadState({ status: "loading" });

    void api
      .getProjectWorkstreams(projectId)
      .then((data) => {
        if (cancelled) return;
        setLoadState({ status: "loaded", data });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadState({
          status: "error",
          error: errorMessage(err, t("workstreamsLoadFailed")),
          statusCode: errorStatus(err),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, projectId, t]);

  const content = useMemo(() => {
    if (!projectId) {
      return (
        <WorkstreamsStateMessage
          title={t("workstreamsNoAccessTitle")}
          message={t("workstreamsNoAccessDescription")}
          variant="error"
        />
      );
    }

    if (settingsLoading && !settings) {
      return <p className="loading">{t("workstreamsLoading")}</p>;
    }

    if (settingsError && !settings) {
      return (
        <WorkstreamsStateMessage
          title={t("workstreamsSettingsErrorTitle")}
          message={settingsError}
          variant="error"
        />
      );
    }

    if (!enabled) {
      return (
        <WorkstreamsStateMessage
          title={t("workstreamsDisabledTitle")}
          message={t("workstreamsDisabledDescription")}
        />
      );
    }

    if (loadState.status === "idle" || loadState.status === "loading") {
      return <p className="loading">{t("workstreamsLoading")}</p>;
    }

    if (loadState.status === "error") {
      if (loadState.statusCode === 403 || loadState.statusCode === 404) {
        return (
          <WorkstreamsStateMessage
            title={t("workstreamsNoAccessTitle")}
            message={t("workstreamsNoAccessDescription")}
            variant="error"
          />
        );
      }

      return (
        <WorkstreamsStateMessage
          title={t("workstreamsErrorTitle")}
          message={loadState.error.message}
          variant="error"
        />
      );
    }

    if (loadState.status === "loaded") {
      return (
        <WorkstreamsTable workstreams={loadState.data.workstreams} t={t} />
      );
    }

    return <p className="loading">{t("workstreamsLoading")}</p>;
  }, [
    enabled,
    loadState,
    projectId,
    settings,
    settingsError,
    settingsLoading,
    t,
  ]);

  return (
    <MainContent
      isWideScreen={isWideScreen}
      innerClassName="workstreams-main-content"
    >
      <PageHeader
        title={t("workstreamsTitle")}
        onOpenSidebar={openSidebar}
        onToggleSidebar={toggleSidebar}
        isWideScreen={isWideScreen}
        isSidebarCollapsed={isSidebarCollapsed}
      />

      <main className="page-scroll-container">
        <div className="page-content-inner workstreams-page">{content}</div>
      </main>
    </MainContent>
  );
}

function WorkstreamsTable({
  workstreams,
  t,
}: {
  workstreams: Workstream[];
  t: ReturnType<typeof useI18n>["t"];
}) {
  if (workstreams.length === 0) {
    return (
      <WorkstreamsStateMessage
        title={t("workstreamsEmptyTitle")}
        message={t("workstreamsEmptyDescription")}
      />
    );
  }

  const checkoutCount = workstreams.filter(
    (workstream) => workstream.kind === "checkout",
  ).length;

  return (
    <>
      <div className="workstreams-table-wrapper">
        <table
          className="workstreams-table"
          aria-label={t("workstreamsTableLabel")}
        >
          <thead>
            <tr>
              <th scope="col">{t("workstreamsColumnLane")}</th>
              <th scope="col">{t("workstreamsColumnKind")}</th>
              <th scope="col">{t("workstreamsColumnBranch")}</th>
              <th scope="col">{t("workstreamsColumnQueue")}</th>
              <th scope="col">{t("workstreamsColumnStatus")}</th>
              <th scope="col">{t("workstreamsColumnSessions")}</th>
              <th scope="col">{t("workstreamsColumnPath")}</th>
            </tr>
          </thead>
          <tbody>
            {workstreams.map((workstream) => (
              <WorkstreamsRow
                key={workstream.id}
                workstream={workstream}
                t={t}
              />
            ))}
          </tbody>
        </table>
      </div>
      {checkoutCount === 0 ? (
        <WorkstreamsStateMessage
          title={t("workstreamsNoCheckoutsTitle")}
          message={t("workstreamsNoCheckoutsDescription")}
        />
      ) : null}
    </>
  );
}

function WorkstreamsRow({
  workstream,
  t,
}: {
  workstream: Workstream;
  t: ReturnType<typeof useI18n>["t"];
}) {
  return (
    <tr>
      <th scope="row">
        <span className="workstreams-lane-label">{workstream.label}</span>
      </th>
      <td>
        <span className="workstreams-kind">
          {kindLabel(workstream.kind, t)}
        </span>
      </td>
      <td>
        <code className="workstreams-branch">
          {workstream.branch ?? t("workstreamsValueNone")}
        </code>
      </td>
      <td>
        <span
          className={
            workstream.queuePaused
              ? "workstreams-badge workstreams-badge--paused"
              : "workstreams-badge workstreams-badge--running"
          }
        >
          {workstream.queuePaused
            ? t("workstreamsQueuePaused")
            : t("workstreamsQueueRunning")}
        </span>
      </td>
      <td>
        <span className="workstreams-status">
          {statusLabel(workstream.status, t)}
        </span>
      </td>
      <td aria-label={t("workstreamsSessionsUnavailable")}>
        <span className="workstreams-placeholder" aria-hidden="true">
          -
        </span>
      </td>
      <td>
        <code className="workstreams-path" title={workstream.path}>
          {workstream.path}
        </code>
      </td>
    </tr>
  );
}

function kindLabel(kind: WorkstreamKind, t: ReturnType<typeof useI18n>["t"]) {
  switch (kind) {
    case "main":
      return t("workstreamsKindMain");
    case "checkout":
      return t("workstreamsKindCheckout");
  }
}

function statusLabel(
  status: WorkstreamStatus,
  t: ReturnType<typeof useI18n>["t"],
) {
  switch (status) {
    case "active":
      return t("workstreamsStatusActive");
    case "archived":
      return t("workstreamsStatusArchived");
    case "landed":
      return t("workstreamsStatusLanded");
  }
}
