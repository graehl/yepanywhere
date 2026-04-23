import { useSearchParams } from "react-router-dom";
import { NewSessionForm } from "../components/NewSessionForm";
import { PageHeader } from "../components/PageHeader";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { useProject, useProjects } from "../hooks/useProjects";
import { useI18n } from "../i18n";
import { useNavigationLayout } from "../layouts";

export function NewSessionPage() {
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const projectId = searchParams.get("projectId") ?? undefined;
  const { openSidebar, isWideScreen, toggleSidebar, isSidebarCollapsed } =
    useNavigationLayout();

  const { projects, loading: projectsLoading } = useProjects();
  const {
    project,
    loading: projectLoading,
    error,
  } = useProject(projectId);
  const selectedProject =
    (projectId ? projects.find((candidate) => candidate.id === projectId) : null) ??
    project;

  // Update browser tab title (must be called unconditionally before any early returns)
  useDocumentTitle(selectedProject?.name, t("newSessionTitle"));

  // Callback to update projectId in URL without navigation
  const handleProjectChange = (newProjectId: string | null) => {
    const nextParams = new URLSearchParams(searchParams);
    if (newProjectId) {
      nextParams.set("projectId", newProjectId);
    } else {
      nextParams.delete("projectId");
    }
    setSearchParams(nextParams, { replace: true });
  };

  const loading = Boolean(projectId) && projectLoading && !selectedProject;
  const renderError = !selectedProject ? error : null;

  // Render loading/error states
  if (loading || renderError) {
    return (
      <div
        className={
          isWideScreen ? "main-content-wrapper" : "main-content-mobile"
        }
      >
        <div
          className={
            isWideScreen
              ? "main-content-constrained"
              : "main-content-mobile-inner"
          }
        >
          <PageHeader
            title={t("newSessionTitle")}
            onOpenSidebar={openSidebar}
            onToggleSidebar={toggleSidebar}
            isWideScreen={isWideScreen}
            isSidebarCollapsed={isSidebarCollapsed}
          />
          <main className="page-scroll-container">
            <div className="page-content-inner">
              {loading ? (
                <div className="loading">{t("newSessionLoading")}</div>
              ) : (
                <div className="error">
                  {t("newSessionErrorPrefix")} {renderError?.message}
                </div>
              )}
            </div>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div
      className={isWideScreen ? "main-content-wrapper" : "main-content-mobile"}
    >
      <div
        className={
          isWideScreen
            ? "main-content-constrained"
            : "main-content-mobile-inner"
        }
      >
        <PageHeader
          title={t("newSessionTitle")}
          onOpenSidebar={openSidebar}
          onToggleSidebar={toggleSidebar}
          isWideScreen={isWideScreen}
          isSidebarCollapsed={isSidebarCollapsed}
        />

        <main className="page-scroll-container">
          <div className="page-content-inner new-session-page-shell">
            <NewSessionForm
              projectId={projectId}
              selectedProject={selectedProject}
              projects={projects}
              projectsLoading={projectsLoading}
              onProjectChange={handleProjectChange}
            />
          </div>
        </main>
      </div>
    </div>
  );
}
