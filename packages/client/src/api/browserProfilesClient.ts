import type { BrowserProfilesResponse } from "@yep-anywhere/shared";
import { fetchJSON } from "./sourceApiFetch";

export const browserProfilesApi = {
  getBrowserProfiles: () =>
    fetchJSON<BrowserProfilesResponse>("/browser-profiles"),

  deleteBrowserProfile: (browserProfileId: string) =>
    fetchJSON<{ deleted: boolean }>(
      `/browser-profiles/${encodeURIComponent(browserProfileId)}`,
      { method: "DELETE" },
    ),
};
