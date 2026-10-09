import { fetchPlainJSON } from "./api/plainFetch";
import {
  ALL_PROVIDERS,
  DEFAULT_PROVIDER,
  type ProviderInfo,
} from "@yep-anywhere/shared";
import { acquireProviderRow } from "./lib/providerQuery";
import { ensureClientQuery } from "./lib/clientQueryController";
import { LOCAL_CLIENT_SUMMARY_SOURCE_KEY } from "./lib/clientSourceIdentity";
import {
  SERVER_SETTINGS_QUERY_KEY,
  applySettingsQuerySnapshot,
  getServerSettingsSnapshot,
  type ServerSettingsResponse,
} from "./lib/serverSettingsQuery";
import { VERSION_QUERY_KEY, applyVersionSnapshot } from "./lib/versionQuery";
import type { VersionInfo } from "./api/client";

// This entry belongs only to the same-origin local client. Remote entrypoints
// acquire data after their source transport is connected. Keep UI imports
// asynchronous so local HTTP reads can overlap the React runtime download.
const basename = import.meta.env.BASE_URL.replace(/\/$/, "");
const initialPath = window.location.pathname.slice(basename.length);
const wrongDevPort =
  import.meta.env.DEV && window.location.port === String(__VITE_DEV_PORT__);
if (!wrongDevPort && /^\/new-session\/?$/.test(initialPath)) {
  void Promise.allSettled([
    ensureClientQuery({
      sourceKey: LOCAL_CLIENT_SUMMARY_SOURCE_KEY,
      key: SERVER_SETTINGS_QUERY_KEY,
      fetcher: () => fetchPlainJSON<ServerSettingsResponse>("/settings"),
      applySnapshot: applySettingsQuerySnapshot,
    }).then(() => {
      const settings = getServerSettingsSnapshot(
        LOCAL_CLIENT_SUMMARY_SOURCE_KEY,
      ).settings;
      if (!settings) return;
      const preferred = new URLSearchParams(window.location.search).get(
        "provider",
      );
      const provider =
        ALL_PROVIDERS.find((name) => name === preferred) ??
        settings.newSessionDefaults?.provider ??
        DEFAULT_PROVIDER;
      return acquireProviderRow(
        LOCAL_CLIENT_SUMMARY_SOURCE_KEY,
        provider,
        ({ refresh }) =>
          fetchPlainJSON<{ provider: ProviderInfo }>(
            `/providers/${provider}${refresh ? "?refresh=1" : ""}`,
          ),
        false,
      );
    }),
    ensureClientQuery({
      sourceKey: LOCAL_CLIENT_SUMMARY_SOURCE_KEY,
      key: VERSION_QUERY_KEY,
      fetcher: () => fetchPlainJSON<VersionInfo>("/version"),
      applySnapshot: applyVersionSnapshot,
    }),
  ]);
}

void import("./main");
