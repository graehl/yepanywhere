import type { UrlProjectId } from "@yep-anywhere/shared";
import { api } from "../api/client";

/**
 * Public file share URL for Copy public URL: the file's existing live public
 * file share when it has one, otherwise a newly minted one. Either way the
 * link authorizes only that file and its bounded render assets, and the owner
 * can list and revoke it from the File Viewer's share dialog.
 */
export async function reuseOrCreatePublicFileShareUrl(
  projectId: UrlProjectId,
  path: string,
): Promise<string> {
  const existing = await api.getPublicFileShares(projectId, path);
  const reusable = existing.items[0]?.url;
  if (reusable) return reusable;
  const created = await api.createPublicFileShare({ projectId, path });
  return created.url;
}
