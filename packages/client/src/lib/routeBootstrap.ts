import {
  ALL_PROVIDERS,
  DEFAULT_PROVIDER,
  type ProviderInfo,
  type RecentSessionsResponse,
} from "@yep-anywhere/shared";
import type { VersionInfo } from "../api/client";
import type { ProjectsResponse } from "../api/projectsClient";
import { ensureClientQuery } from "./clientQueryController";
import type { ClientSummarySourceKey } from "./clientSourceIdentity";
import type { SourceTransport } from "./transport/types";
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

/** Declare route acquisition before mounted consumers join these shared reads. */
export function primeRoute(
  sourceKey: ClientSummarySourceKey,
  transport: Pick<SourceTransport, "fetch" | "fetchStream">,
  route: "new-session" | "settings",
  preferredProvider: string | null,
) {
  const preferred = ALL_PROVIDERS.find((name) => name === preferredProvider);
  const bundle =
    route === "new-session" && transport.fetchStream
      ? createNewSessionBootstrap(preferred, (path, init) =>
          transport.fetchStream!(path, init),
        )
      : undefined;
  const readSettings = () =>
    transport.fetch<ServerSettingsResponse>("/settings");
  const readVersion = () => transport.fetch<VersionInfo>("/version");
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
            transport.fetch<{ provider: ProviderInfo }>(
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
            transport.fetch<ProjectsResponse>(
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
              transport.fetch<RecentSessionsResponse>(
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
