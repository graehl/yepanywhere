import type {
  PermissionMode,
  ProviderName,
  ThinkingOption,
} from "@yep-anywhere/shared";
import {
  ALL_PERMISSION_MODES,
  PROJECT_CODE_NAMES_CAPABILITY,
  SERVER_CAPABILITIES,
  serverHasCapability,
} from "@yep-anywhere/shared";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useRemoteBasePath } from "../hooks/useRemoteBasePath";
import { NewSessionForm } from "../components/NewSessionForm";
import { PageHeader } from "../components/PageHeader";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { useVersion } from "../hooks/useVersion";
import { useIncomingShareFiles } from "../hooks/useIncomingShareFiles";
import { useProject, useProjects } from "../hooks/useProjects";
import {
  getRecentProjectId,
  resolvePreferredProjectId,
  setRecentProjectId,
} from "../hooks/useRecentProject";
import { useRecentSessions } from "../hooks/useRecentSessions";
import { useNewSessionProjectSnapshot } from "../hooks/useNewSessionProjectSnapshot";
import { useI18n } from "../i18n";
import { MainContent, useNavigationLayout } from "../layouts";
import { useToastContext } from "../contexts/ToastContext";
import { useProjectAppComposing } from "../hooks/useProjectAppComposing";
import { useProjectAppUpdates } from "../hooks/useProjectAppUpdates";
import styles from "./NewSessionPage.module.css";

const ignoreProjectAppUpdate = () => {};

const RECENT_PROJECT_SESSION_LIMIT = 30;
const DETACHED_PROJECT_PARAM = "detached";

function parsePreferredThinking(
  value: string | null,
): ThinkingOption | undefined {
  if (!value) return undefined;
  if (value === "off" || value === "auto" || value.startsWith("on:")) {
    return value as ThinkingOption;
  }
  return undefined;
}

function parsePreferredPermissionMode(
  value: string | null,
): PermissionMode | undefined {
  if (!value) return undefined;
  return ALL_PERMISSION_MODES.includes(value as PermissionMode)
    ? (value as PermissionMode)
    : undefined;
}

export function NewSessionPage() {
  const basePath = useRemoteBasePath();
  const { t } = useI18n();
  const { showToast } = useToastContext();
  const [incomingShareFiles, setIncomingShareFiles] = useState<readonly File[]>(
    [],
  );
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedProjectId = searchParams.get("projectId") ?? undefined;
  const preferredProvider = searchParams.get("provider") ?? undefined;
  const preferredModel = searchParams.get("model") ?? undefined;
  const preferredThinking = parsePreferredThinking(
    searchParams.get("thinking"),
  );
  const preferredPermissionMode = parsePreferredPermissionMode(
    searchParams.get("permissionMode"),
  );
  const preferredExecutor = searchParams.get("executor") ?? undefined;
  const requestedDetached =
    !requestedProjectId && searchParams.get(DETACHED_PROJECT_PARAM) === "1";
  const { openSidebar, isWideScreen } = useNavigationLayout();
  const { projectAppComposingEnabled } = useProjectAppComposing();

  useIncomingShareFiles(setIncomingShareFiles, {
    onError: () => showToast(t("incomingShareAttachmentUnavailable"), "error"),
  });

  const {
    projects: liveProjects,
    loading: projectsLoading,
    complete: projectsComplete,
    error: projectsError,
  } = useProjects({
    bootstrapTier: "route",
  });
  const projectCollectionConfirmed = projectsComplete && !projectsError;
  const { version } = useVersion();
  const supportsProjectCodeNames = serverHasCapability(
    version,
    PROJECT_CODE_NAMES_CAPABILITY,
  );
  const {
    recentProjectIds: liveRecentProjectIds,
    isLoadingVisits: recentSessionsLoading,
  } = useRecentSessions({
    limit: RECENT_PROJECT_SESSION_LIMIT,
  });
  const { projects, cachedProjects, recentProjectIds, unconfirmedProjectIds } =
    useNewSessionProjectSnapshot({
      projects: liveProjects,
      complete: projectCollectionConfirmed,
      recentProjectIds: liveRecentProjectIds,
      visitsLoading: recentSessionsLoading,
      projectId: requestedProjectId,
    });
  // The initial selection is already determined by these facts. Rendering it
  // must not wait for the router to commit the URL normalization below.
  let projectId = requestedProjectId;
  if (!projectId && !requestedDetached && projects.length > 0) {
    const storedRecentProjectId = getRecentProjectId();
    const hasValidStoredRecentProject = projects.some(
      (candidate) => candidate.id === storedRecentProjectId,
    );
    if (
      !recentSessionsLoading ||
      hasValidStoredRecentProject ||
      recentProjectIds.length > 0
    ) {
      projectId =
        resolvePreferredProjectId(
          projects,
          recentProjectIds[0],
          projectCollectionConfirmed,
        ) ?? undefined;
    }
  }
  const { project, loading: projectLoading, error } = useProject(projectId);
  const confirmedSelectedProject =
    liveProjects.find((candidate) => candidate.id === projectId) ?? project;
  const selectedProject =
    confirmedSelectedProject ??
    (projectId
      ? projects.find((candidate) => candidate.id === projectId)
      : null) ??
    (projectLoading
      ? cachedProjects.find((candidate) => candidate.id === projectId)
      : null);

  // Offered only for a project that declares a usable app; there is no turn
  // here to open it after, so updates need no action.
  const projectHasApp = useProjectAppUpdates(
    projectId,
    projectAppComposingEnabled &&
      serverHasCapability(version, SERVER_CAPABILITIES.projectService.name),
    false,
    ignoreProjectAppUpdate,
  );
  const projectAppButton = projectHasApp ? (
    <Link
      className={`btn-secondary ${styles.appButton}`}
      to={`${basePath}/projects/${projectId}/app?compose=1`}
      title={t("projectAppWhileComposing")}
    >
      {t("projectAppLabel")}
    </Link>
  ) : undefined;

  // Update browser tab title (must be called unconditionally before any early returns)
  useDocumentTitle(
    selectedProject?.name,
    supportsProjectCodeNames ? selectedProject?.codeName : undefined,
    t("newSessionTitle"),
  );

  useEffect(() => {
    if (!projectId || !confirmedSelectedProject) return;
    setRecentProjectId(projectId);
  }, [projectId, confirmedSelectedProject]);

  useEffect(() => {
    if (requestedProjectId || requestedDetached || !projectId) {
      return;
    }

    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("projectId", projectId);
    nextParams.delete(DETACHED_PROJECT_PARAM);
    setSearchParams(nextParams, { replace: true });
  }, [
    projectId,
    requestedProjectId,
    requestedDetached,
    searchParams,
    setSearchParams,
  ]);

  // Callback to update projectId in URL without navigation
  const handleProjectChange = (newProjectId: string | null) => {
    const nextParams = new URLSearchParams(searchParams);
    if (newProjectId) {
      nextParams.set("projectId", newProjectId);
      nextParams.delete(DETACHED_PROJECT_PARAM);
      setRecentProjectId(newProjectId);
    } else {
      nextParams.delete("projectId");
      nextParams.set(DETACHED_PROJECT_PARAM, "1");
    }
    setSearchParams(nextParams, { replace: true });
  };

  // The composer does not wait for the selected project's record: a tab opened
  // here is for typing, and the form holds the start until the project arrives.
  const renderError =
    !confirmedSelectedProject && !projectLoading ? error : null;

  if (renderError) {
    return (
      <MainContent isWideScreen={isWideScreen}>
        <PageHeader
          title={t("newSessionTitle")}
          onOpenSidebar={openSidebar}
          isWideScreen={isWideScreen}
        />
        <main className="page-scroll-container">
          <div className="page-content-inner">
            <div className="error">
              {t("newSessionErrorPrefix")} {renderError.message}
            </div>
          </div>
        </main>
      </MainContent>
    );
  }

  return (
    <MainContent isWideScreen={isWideScreen}>
      <PageHeader
        title={t("newSessionTitle")}
        onOpenSidebar={openSidebar}
        isWideScreen={isWideScreen}
        actions={projectAppButton}
      />

      <main className="page-scroll-container">
        <div className="page-content-inner new-session-page-shell">
          <NewSessionForm
            incomingShareFiles={incomingShareFiles}
            projectId={projectId}
            selectedProject={selectedProject}
            projects={projects}
            recentProjectIds={recentProjectIds}
            projectsLoading={projectsLoading && projects.length === 0}
            unconfirmedProjectIds={unconfirmedProjectIds.filter(
              (id) => id !== confirmedSelectedProject?.id,
            )}
            onProjectChange={handleProjectChange}
            preferredProvider={preferredProvider as ProviderName | undefined}
            preferredModel={preferredModel}
            preferredThinking={preferredThinking}
            preferredPermissionMode={preferredPermissionMode}
            preferredExecutor={preferredExecutor || undefined}
          />
        </div>
      </main>
    </MainContent>
  );
}
