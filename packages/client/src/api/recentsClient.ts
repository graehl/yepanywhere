import type {
  EnrichedRecentEntry,
  RecentSessionsResponse,
} from "@yep-anywhere/shared";
import { fetchJSON } from "./sourceApiFetch";

export function createRecentsApi(fetcher: typeof fetchJSON) {
  function getRecents(
    limit?: number,
  ): Promise<{ recents: EnrichedRecentEntry[] }>;
  function getRecents(
    limit: number | undefined,
    summaryMode: "retained" | undefined,
  ): Promise<RecentSessionsResponse>;
  function getRecents(
    limit?: number,
    summaryMode?: "retained",
  ): Promise<RecentSessionsResponse> {
    const query = new URLSearchParams();
    if (limit) query.set("limit", String(limit));
    if (summaryMode) query.set("summaryMode", summaryMode);
    return fetcher<RecentSessionsResponse>(
      `/recents${query.size ? `?${query}` : ""}`,
    );
  }
  return {
    getRecents,

    recordVisit: (sessionId: string, projectId: string) =>
      fetcher<{ recorded: boolean }>("/recents/visit", {
        method: "POST",
        body: JSON.stringify({ sessionId, projectId }),
      }),

    clearRecents: () =>
      fetcher<{ cleared: boolean }>("/recents", {
        method: "DELETE",
      }),
  };
}

export const recentsApi = createRecentsApi(fetchJSON);
