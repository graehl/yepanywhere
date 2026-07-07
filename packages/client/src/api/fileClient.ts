import type { FileContentResponse } from "@yep-anywhere/shared";
import { fetchJSON } from "./sourceApiFetch";

export const fileApi = {
  getFile: (
    projectId: string,
    path: string,
    highlight = false,
    lineNumber?: number,
    lineEnd?: number,
    viewMode?: "full" | "range",
  ) => {
    const params = new URLSearchParams({ path });
    if (highlight) params.set("highlight", "true");
    if (lineNumber !== undefined) params.set("line", String(lineNumber));
    if (lineEnd !== undefined) params.set("lineEnd", String(lineEnd));
    if (viewMode === "range") params.set("view", "range");
    return fetchJSON<FileContentResponse>(
      `/projects/${projectId}/files?${params.toString()}`,
    );
  },

  getFileRawUrl: (projectId: string, path: string, download = false) => {
    const params = new URLSearchParams({ path });
    if (download) params.set("download", "true");
    return `/api/projects/${projectId}/files/raw?${params.toString()}`;
  },

  /**
   * Expand diff context to show full file.
   * Returns syntax-highlighted diff with the entire file as context.
   * Uses originalFile from SDK Edit result (never truncated, verified up to 150KB+).
   */
  expandDiffContext: (
    projectId: string,
    filePath: string,
    oldString: string,
    newString: string,
    originalFile: string,
  ) =>
    fetchJSON<{
      structuredPatch: Array<{
        oldStart: number;
        oldLines: number;
        newStart: number;
        newLines: number;
        lines: string[];
      }>;
      diffHtml: string;
    }>(`/projects/${projectId}/diff/expand`, {
      method: "POST",
      body: JSON.stringify({ filePath, oldString, newString, originalFile }),
    }),
};
