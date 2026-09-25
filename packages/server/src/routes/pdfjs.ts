import { PDFJS_VERSION } from "@yep-anywhere/shared";
import { Hono } from "hono";
import {
  isServedPdfjsFile,
  type PdfjsAssetCache,
  pdfjsContentType,
} from "../services/PdfjsAssetCache.js";

/**
 * Same-origin pdf.js modules and assets for the opt-in client PDF renderer.
 * The version is part of the path, so a response never changes and may be
 * cached indefinitely.
 */
export function createPdfjsRoutes(cache: PdfjsAssetCache) {
  const routes = new Hono();
  const prefix = `/pdfjs/${PDFJS_VERSION}/`;
  routes.get("/pdfjs/:version/*", async (c) => {
    const at = c.req.path.indexOf(prefix);
    const path = at < 0 ? "" : c.req.path.slice(at + prefix.length);
    if (!isServedPdfjsFile(path)) return c.json({ error: "Not found" }, 404);
    let bytes: Buffer;
    try {
      bytes = await cache.read(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return c.json({ error: "Not found" }, 404);
      return c.json(
        { error: error instanceof Error ? error.message : String(error) },
        502,
      );
    }
    return c.body(new Uint8Array(bytes), 200, {
      "Content-Type": pdfjsContentType(path),
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    });
  });
  return routes;
}
