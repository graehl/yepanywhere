import { createHash } from "node:crypto";
import { open, realpath } from "node:fs/promises";
import { dirname, extname, isAbsolute, resolve } from "node:path";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { PRINCIPAL_VARIABLE, type Principal } from "../auth/principal.js";
import type { ProjectScanner } from "../projects/scanner.js";
import {
  type ArtifactRebuildService,
  parseArtifactRebuildDescriptor,
  rebuildApprovalSchema,
} from "../services/ArtifactRebuildService.js";
import { expandHomePath } from "../utils/expandHomePath.js";
import { writeFileAtomically } from "../utils/writeFileAtomically.js";
import type { createLocalResourcePathPolicy } from "./local-resource-policy.js";

const MAX_EDIT_BYTES = 1024 * 1024;
const referenceSchema = z.object({
  path: z.string().min(1).max(8192).optional(),
  projectId: z.string().optional(),
  relativeTo: z.string().max(8192).optional(),
  artifactUrl: z.string().max(8192).optional(),
  preview: z.literal("1").optional(),
});
const saveSchema = z.object({
  path: z.string().min(1).max(8192),
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  content: z.string().max(MAX_EDIT_BYTES),
});
const rebuildSchema = z.object({
  path: z.string().min(1).max(8192),
  hook: z.string().min(1).max(128),
  /** Approve the proposal in `approved` before running it. */
  register: z.boolean().optional(),
  /** The proposal the user was shown; registration requires it to be current. */
  approved: rebuildApprovalSchema.optional(),
});

export interface FileEditDeps {
  policy: ReturnType<typeof createLocalResourcePathPolicy>;
  scanner: Pick<ProjectScanner, "getProject">;
  resolveArtifactUrl: (url: string) => Promise<string>;
  isWritePending?: (path: string) => boolean;
  /** Absent means previews report no rebuild hook and rebuilds are refused. */
  rebuild?: ArtifactRebuildService;
}

function isHtmlPath(path: string): boolean {
  return [".html", ".htm"].includes(extname(path).toLowerCase());
}

function revision(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Bounded UTF-8 source reads and conditional user saves; never a public route. */
export function createFileEditRoutes(deps: FileEditDeps) {
  const routes = new Hono<{
    Variables: Record<typeof PRINCIPAL_VARIABLE, Principal>;
  }>();
  const saving = new Set<string>();
  routes.use("/file-edit", bodyLimit({ maxSize: MAX_EDIT_BYTES * 6 + 16384 }));
  routes.use("/file-edit", async (c, next) => {
    c.header("Cache-Control", "no-store");
    await next();
  });

  async function readSource(path: string, preview = false) {
    const allowed = await deps.policy.resolveAllowedFilePath(path);
    if (!allowed.ok)
      throw new HTTPException(allowed.status, { message: allowed.error });
    const canonical = allowed.file.resolvedPath;
    const limit =
      preview && [".html", ".htm"].includes(extname(canonical).toLowerCase())
        ? 200 * 1024 * 1024
        : MAX_EDIT_BYTES;
    const handle = await open(canonical, "r");
    try {
      const stats = await handle.stat();
      if (!stats.isFile() || stats.size > limit)
        throw new HTTPException(413, {
          message: `Source ${preview ? "preview" : "editing"} is limited to text files up to ${limit / (1024 * 1024)} MiB`,
        });
      const bytes = Buffer.alloc(Math.min(stats.size + 1, limit + 1));
      let bytesRead = 0;
      while (bytesRead < bytes.length) {
        const chunk = await handle.read(
          bytes,
          bytesRead,
          bytes.length - bytesRead,
          bytesRead,
        );
        if (!chunk.bytesRead) break;
        bytesRead += chunk.bytesRead;
      }
      if (bytesRead > limit || bytesRead > stats.size)
        throw new HTTPException(413, {
          message: "Source file grew beyond the edit limit",
        });
      const contentBytes = bytes.subarray(0, bytesRead);
      let content: string;
      try {
        content = new TextDecoder("utf-8", {
          fatal: true,
          ignoreBOM: true,
        }).decode(contentBytes);
      } catch {
        throw new HTTPException(415, {
          message: "Source editing requires UTF-8 text",
        });
      }
      if (content.includes("\0"))
        throw new HTTPException(415, {
          message: "Binary files cannot be edited",
        });
      return {
        path: canonical,
        content,
        revision: revision(contentBytes),
        editable: bytesRead <= MAX_EDIT_BYTES,
        stats,
      };
    } finally {
      await handle.close();
    }
  }

  routes.get("/file-edit", async (c) => {
    const parsed = referenceSchema.safeParse(c.req.query());
    if (!parsed.success)
      return c.json({ error: "Invalid source reference" }, 400);
    const ref = parsed.data;
    let path = ref.path && expandHomePath(ref.path);
    if (ref.artifactUrl) {
      if (path || ref.relativeTo || ref.projectId)
        return c.json({ error: "Use one source reference" }, 400);
      path = await deps.resolveArtifactUrl(ref.artifactUrl);
    } else if (path && !isAbsolute(path)) {
      if (ref.relativeTo) {
        const base = await deps.policy.resolveAllowedFilePath(ref.relativeTo);
        if (!base.ok) return c.json({ error: base.error }, base.status);
        path = resolve(dirname(base.file.resolvedPath), path);
      } else if (ref.projectId) {
        const project = await deps.scanner.getProject(ref.projectId);
        if (!project) return c.json({ error: "Project not found" }, 404);
        path = resolve(project.path, path);
      }
    }
    if (!path || !isAbsolute(path))
      return c.json(
        { error: "An absolute or project-relative source path is required" },
        400,
      );
    const { stats: _stats, ...source } = await readSource(
      path,
      ref.preview === "1",
    );
    if (ref.preview === "1" && deps.rebuild && isHtmlPath(source.path)) {
      const descriptor = parseArtifactRebuildDescriptor(source.content);
      if (descriptor)
        return c.json({
          ...source,
          regenerate: await deps.rebuild.status(source.path, descriptor),
        });
    }
    return c.json(source);
  });

  // Run the artifact's approved rebuild hook, then return the fresh preview so
  // the editor replaces HTML and mapping together. A registration mismatch
  // is reported, never silently re-approved; `register` is the explicit act,
  // and it approves only the `approved` proposal the user was shown.
  // The hook runs as the host user outside any session sandbox, so only the
  // superuser may approve or run it, whatever the route policy table says.
  routes.post("/file-edit/rebuild", async (c) => {
    const principal = c.get(PRINCIPAL_VARIABLE) as Principal | undefined;
    if (principal && principal.kind !== "superuser")
      return c.json({ error: "Superuser required" }, 403);
    if (!deps.rebuild)
      return c.json({ error: "Artifact rebuild is unavailable" }, 409);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid rebuild JSON" }, 400);
    }
    const parsed = rebuildSchema.safeParse(body);
    if (!parsed.success)
      return c.json({ error: "Invalid rebuild request" }, 400);
    const before = await readSource(expandHomePath(parsed.data.path), true);
    if (!isHtmlPath(before.path))
      return c.json({ error: "Only HTML artifacts can be rebuilt" }, 400);
    const descriptor = parseArtifactRebuildDescriptor(before.content);
    if (!descriptor || descriptor.hook !== parsed.data.hook)
      return c.json(
        { error: "This artifact declares no matching rebuild hook" },
        409,
      );
    const { register, approved } = parsed.data;
    const registered =
      register && approved
        ? await deps.rebuild.register(before.path, descriptor, approved)
        : undefined;
    if (register && !registered)
      return c.json(
        {
          error:
            "The artifact's proposed rebuild command is not the one you approved; review it again",
          regenerate: await deps.rebuild.status(before.path, descriptor),
        },
        409,
      );
    let status =
      registered ?? (await deps.rebuild.status(before.path, descriptor));
    if (!status.registered || !status.matches)
      return c.json(
        {
          error: status.registered
            ? "The artifact's proposed rebuild command changed since it was approved"
            : "This rebuild command has not been approved",
          regenerate: status,
        },
        409,
      );
    const result = await deps.rebuild.run(before.path, descriptor);
    const { stats: _stats, ...after } = await readSource(before.path, true);
    const nextDescriptor = parseArtifactRebuildDescriptor(after.content);
    status = nextDescriptor
      ? await deps.rebuild.status(after.path, nextDescriptor)
      : status;
    return c.json({
      ...result,
      preview: after,
      regenerate: nextDescriptor ? status : undefined,
    });
  });

  routes.put("/file-edit", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid source edit JSON" }, 400);
    }
    const parsed = saveSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: "Invalid source edit" }, 400);
    const { content, revision: expected } = parsed.data;
    const bytes = Buffer.from(content, "utf8");
    if (bytes.length > MAX_EDIT_BYTES || content.includes("\0"))
      return c.json(
        { error: "Source editing requires UTF-8 text up to 1 MiB" },
        413,
      );
    const source = await readSource(parsed.data.path);
    if (saving.has(source.path) || deps.isWritePending?.(source.path))
      return c.json(
        {
          error:
            "This file is being edited; retry after the active write finishes",
        },
        409,
      );
    saving.add(source.path);
    try {
      // Re-read after taking the per-file writer slot. A second browser's
      // save must not reuse a snapshot taken before the first save completed.
      const current = await readSource(source.path);
      if (
        current.revision !== expected ||
        (await realpath(parsed.data.path)) !== source.path
      )
        return c.json(
          {
            error:
              "The file changed since opening. Keep your draft and reopen the source to reconcile it.",
          },
          409,
        );
      if (current.stats.nlink !== 1)
        return c.json(
          { error: "Editing hard-linked files is not supported" },
          409,
        );
      if (deps.isWritePending?.(source.path))
        return c.json({ error: "This file has an active writer" }, 409);
      await writeFileAtomically(source.path, bytes, {
        mode: current.stats.mode & 0o777,
      });
      return c.json({ path: source.path, revision: revision(bytes) });
    } finally {
      saving.delete(source.path);
    }
  });
  return routes;
}
