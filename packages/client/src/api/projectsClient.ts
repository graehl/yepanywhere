import type { RetainedProjectCollectionState } from "@yep-anywhere/shared";
import type { Project } from "../types";
import { fetchJSON } from "./sourceApiFetch";

export interface ProjectsResponse {
  projects: Project[];
  catalog?: RetainedProjectCollectionState;
}

export function createProjectsApi(fetcher: typeof fetchJSON) {
  return {
    getProjects: (summaryMode?: "retained") =>
      fetcher<ProjectsResponse>(
        summaryMode ? "/projects?summaryMode=retained" : "/projects",
      ),
  };
}

export const projectsApi = createProjectsApi(fetchJSON);
