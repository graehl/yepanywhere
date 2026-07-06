import type { EnrichedRecentEntry } from "@yep-anywhere/shared";
import { fetchJSON } from "./sourceApiFetch";

export const recentsApi = {
  getRecents: (limit?: number) =>
    fetchJSON<{
      recents: Array<EnrichedRecentEntry>;
    }>(limit ? `/recents?limit=${limit}` : "/recents"),

  recordVisit: (sessionId: string, projectId: string) =>
    fetchJSON<{ recorded: boolean }>("/recents/visit", {
      method: "POST",
      body: JSON.stringify({ sessionId, projectId }),
    }),

  clearRecents: () =>
    fetchJSON<{ cleared: boolean }>("/recents", {
      method: "DELETE",
    }),
};
