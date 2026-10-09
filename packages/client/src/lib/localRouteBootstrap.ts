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

/** Start route data before loading React; mounted consumers join these reads. */
export function primeLocalRoute(
  route: "new-session" | "settings",
  preferredProvider: string | null,
) {
  const sourceKey = LOCAL_CLIENT_SUMMARY_SOURCE_KEY;
  const reads = [
    ensureClientQuery({
      sourceKey,
      key: SERVER_SETTINGS_QUERY_KEY,
      fetcher: () => fetchPlainJSON<ServerSettingsResponse>("/settings"),
      applySnapshot: applySettingsQuerySnapshot,
    }).then(() => {
      if (route !== "new-session") return;
      const settings = getServerSettingsSnapshot(sourceKey).settings;
      if (!settings) return;
      const provider =
        ALL_PROVIDERS.find((name) => name === preferredProvider) ??
        settings.newSessionDefaults?.provider ??
        DEFAULT_PROVIDER;
      return acquireProviderRow(
        sourceKey,
        provider,
        ({ refresh }) =>
          fetchPlainJSON<{ provider: ProviderInfo }>(
            `/providers/${provider}${refresh ? "?refresh=1" : ""}`,
          ),
        false,
      );
    }),
    ensureClientQuery({
      sourceKey,
      key: VERSION_QUERY_KEY,
      fetcher: () => fetchPlainJSON<VersionInfo>("/version"),
      applySnapshot: applyVersionSnapshot,
    }),
  ];
  if (route === "new-session") {
    reads.push(
      ensureClientQuery(
        createProjectsQuery(sourceKey, (summaryMode) =>
          fetchPlainJSON<ProjectsResponse>(
            summaryMode ? "/projects?summaryMode=retained" : "/projects",
          ),
        ),
      ),
      ensureClientQuery(
        createRecentsQuery(sourceKey, {
          getRecents: (limit, summaryMode) =>
            fetchPlainJSON<RecentSessionsResponse>(
              `/recents?limit=${limit}${summaryMode ? "&summaryMode=retained" : ""}`,
            ),
        }),
      ),
    );
  }
  return Promise.allSettled(reads);
}
