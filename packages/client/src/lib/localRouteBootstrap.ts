import {
  ALL_PROVIDERS,
  DEFAULT_PROVIDER,
  type ProviderInfo,
  type RecentSessionsResponse,
} from "@yep-anywhere/shared";
import type { VersionInfo } from "../api/client";
import type { ProjectsResponse } from "../api/projectsClient";
import { fetchPlainJSON } from "../api/plainFetch";
import { ensureClientQuery } from "./clientQueryController";
import { LOCAL_CLIENT_SUMMARY_SOURCE_KEY } from "./clientSourceIdentity";
import { acquireProviderRow } from "./providerQuery";
import { createProjectsQuery } from "./projectsQuery";
import { createRecentsQuery } from "./recentsQuery";
import {
  SERVER_SETTINGS_QUERY_KEY,
  applySettingsQuerySnapshot,
  getServerSettingsSnapshot,
  type ServerSettingsResponse,
} from "./serverSettingsQuery";
import { VERSION_QUERY_KEY, applyVersionSnapshot } from "./versionQuery";
import { createNewSessionBootstrap } from "./newSessionBootstrap";

/** Start route data before loading React; mounted consumers join these reads. */
export function primeLocalRoute(
  route: "new-session" | "settings",
  preferredProvider: string | null,
) {
  const sourceKey = LOCAL_CLIENT_SUMMARY_SOURCE_KEY;
  const preferred = ALL_PROVIDERS.find((name) => name === preferredProvider);
  const bundle =
    route === "new-session" ? createNewSessionBootstrap(preferred) : undefined;
  const readSettings = () =>
    fetchPlainJSON<ServerSettingsResponse>("/settings");
  const readVersion = () => fetchPlainJSON<VersionInfo>("/version");
  const reads = [
    ensureClientQuery({
      sourceKey,
      key: SERVER_SETTINGS_QUERY_KEY,
      fetcher: () =>
        bundle ? bundle.read("settings", readSettings) : readSettings(),
      applySnapshot: applySettingsQuerySnapshot,
    }).then(() => {
      if (route !== "new-session") return;
      const settings = getServerSettingsSnapshot(sourceKey).settings;
      if (!settings) return;
      const provider =
        preferred ?? settings.newSessionDefaults?.provider ?? DEFAULT_PROVIDER;
      return acquireProviderRow(
        sourceKey,
        provider,
        async ({ refresh }) => {
          const readProvider = () =>
            fetchPlainJSON<{ provider: ProviderInfo }>(
              `/providers/${provider}${refresh ? "?refresh=1" : ""}`,
            );
          if (!bundle || refresh) return readProvider();
          const result = await bundle.read("provider", readProvider);
          // Settings may have changed after the server chose this bundle's row.
          return result.provider.name === provider ? result : readProvider();
        },
        false,
      );
    }),
    ensureClientQuery({
      sourceKey,
      key: VERSION_QUERY_KEY,
      fetcher: () =>
        bundle ? bundle.read("version", readVersion) : readVersion(),
      applySnapshot: applyVersionSnapshot,
    }),
  ];
  if (route === "new-session") {
    reads.push(
      ensureClientQuery(
        createProjectsQuery(sourceKey, (summaryMode) => {
          const readProjects = () =>
            fetchPlainJSON<ProjectsResponse>(
              summaryMode ? "/projects?summaryMode=retained" : "/projects",
            );
          return bundle
            ? bundle.read("projects", readProjects)
            : readProjects();
        }),
      ),
      ensureClientQuery(
        createRecentsQuery(sourceKey, {
          getRecents: (limit, summaryMode) => {
            const readRecents = () =>
              fetchPlainJSON<RecentSessionsResponse>(
                `/recents?limit=${limit}${summaryMode ? "&summaryMode=retained" : ""}`,
              );
            return bundle ? bundle.read("recents", readRecents) : readRecents();
          },
        }),
      ),
    );
  }
  return Promise.allSettled(reads);
}
