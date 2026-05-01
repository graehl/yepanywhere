import {
  type AppSession,
  type CreatePublicSessionShareRequest,
  type CreatePublicSessionShareResponse,
  type PublicSessionShareResponse,
  type PublicSessionShareSessionStatusResponse,
  type RevokePublicSessionSharesResponse,
  type UrlProjectId,
  isUrlProjectId,
} from "@yep-anywhere/shared";
import type { Context } from "hono";
import { Hono } from "hono";
import { decodeProjectId, getProjectName } from "../projects/paths.js";
import type { PublicShareService } from "../services/PublicShareService.js";

const DEFAULT_PUBLIC_SHARE_ORIGIN = "https://ya.graehl.org";
const DEFAULT_RELAY_URL = "wss://relay.yepanywhere.com/ws";

export interface RelayConfigForPublicShare {
  url: string;
  username: string;
}

export interface PublicShareRoutesDeps {
  publicShareService: PublicShareService;
  loadSession: (
    projectId: UrlProjectId,
    sessionId: string,
  ) => Promise<AppSession | null>;
  getRelayConfig?: () => RelayConfigForPublicShare | null;
  publicShareOrigin?: string;
}

function buildPublicShareUrl(
  secret: string,
  relayConfig: RelayConfigForPublicShare,
  display: {
    mode: CreatePublicSessionShareResponse["mode"];
    capturedAt?: string | null;
    initialPrompt?: string | null;
    projectName: string;
    title: string | null;
  },
  publicShareOrigin?: string,
): string {
  const origin =
    publicShareOrigin ??
    process.env.YEP_PUBLIC_SHARE_ORIGIN ??
    DEFAULT_PUBLIC_SHARE_ORIGIN;
  const url = new URL(`/share/${secret}`, origin);
  url.searchParams.set("h", relayConfig.username);
  if (relayConfig.url !== DEFAULT_RELAY_URL) {
    url.searchParams.set("r", relayConfig.url);
  }
  const displayParams = new URLSearchParams();
  displayParams.set("m", display.mode);
  displayParams.set("p", display.projectName);
  if (display.capturedAt) {
    displayParams.set("c", display.capturedAt);
  }
  if (display.title) {
    displayParams.set("t", display.title);
  }
  if (display.initialPrompt) {
    displayParams.set("q", display.initialPrompt);
  }
  url.hash = displayParams.toString();
  return url.toString();
}

function contentToPlainText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((block) => {
      if (!block || typeof block !== "object") {
        return "";
      }
      const value = block as { content?: unknown; text?: unknown; type?: unknown };
      if (value.type === "text" && typeof value.text === "string") {
        return value.text;
      }
      if (typeof value.content === "string") {
        return value.content;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function normalizePromptPreview(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (
    trimmed.startsWith("# AGENTS.md instructions") ||
    trimmed.startsWith("<environment_context>")
  ) {
    return null;
  }
  const normalized = trimmed.replace(/\s+/g, " ");
  return normalized.length > 700
    ? `${normalized.slice(0, 697).trimEnd()}...`
    : normalized;
}

function getInitialPromptPreview(session: AppSession): string | null {
  for (const message of session.messages) {
    if ((message as { type?: unknown }).type !== "user") {
      continue;
    }
    const content =
      contentToPlainText((message as { content?: unknown }).content) ||
      contentToPlainText(
        (message as { message?: { content?: unknown } }).message?.content,
      );
    const preview = normalizePromptPreview(content);
    if (preview) {
      return preview;
    }
  }
  return null;
}

function notFound(c: Context) {
  return c.json({ error: "Share not found" }, 404);
}

function getSessionParams(c: Context):
  | { projectId: UrlProjectId; sessionId: string }
  | { error: Response } {
  const projectId = c.req.param("projectId");
  const sessionId = c.req.param("sessionId");
  if (typeof projectId !== "string" || !isUrlProjectId(projectId)) {
    return { error: c.json({ error: "Invalid project ID format" }, 400) };
  }
  if (!sessionId || typeof sessionId !== "string") {
    return { error: c.json({ error: "sessionId is required" }, 400) };
  }
  return { projectId, sessionId };
}

export function createPublicShareRoutes(deps: PublicShareRoutesDeps): Hono {
  const app = new Hono();

  app.get("/status", (c) => {
    const relayConfig = deps.getRelayConfig?.() ?? null;
    return c.json({
      configured: !!relayConfig?.username,
      requiresRelay: true,
    });
  });

  app.get("/sessions/:projectId/:sessionId", (c) => {
    const params = getSessionParams(c);
    if ("error" in params) return params.error;
    const response: PublicSessionShareSessionStatusResponse =
      deps.publicShareService.getSessionShareStatus(
        params.projectId,
        params.sessionId,
      );
    return c.json(response);
  });

  app.delete("/sessions/:projectId/:sessionId", async (c) => {
    const params = getSessionParams(c);
    if ("error" in params) return params.error;
    const response: RevokePublicSessionSharesResponse =
      await deps.publicShareService.revokeSessionShares(
        params.projectId,
        params.sessionId,
      );
    return c.json(response);
  });

  app.post("/", async (c) => {
    let body: CreatePublicSessionShareRequest;
    try {
      body = await c.req.json<CreatePublicSessionShareRequest>();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    if (!isUrlProjectId(body.projectId)) {
      return c.json({ error: "Invalid project ID format" }, 400);
    }
    if (!body.sessionId || typeof body.sessionId !== "string") {
      return c.json({ error: "sessionId is required" }, 400);
    }
    if (body.mode !== "frozen" && body.mode !== "live") {
      return c.json({ error: "mode must be frozen or live" }, 400);
    }

    const relayConfig = deps.getRelayConfig?.() ?? null;
    if (!relayConfig?.url || !relayConfig.username) {
      return c.json(
        {
          error:
            "Remote relay must be configured before creating public share links",
        },
        400,
      );
    }

    const session = await deps.loadSession(body.projectId, body.sessionId);
    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }

    const title = body.title ?? session.customTitle ?? session.title;
    const projectName = getProjectName(decodeProjectId(body.projectId));
    const initialPrompt = getInitialPromptPreview(session);
    const { secret, secretBits, record } =
      await deps.publicShareService.createShare({
        mode: body.mode,
        title,
        source: {
          projectId: body.projectId,
          sessionId: body.sessionId,
          projectName,
          provider: session.provider,
        },
        ...(body.mode === "frozen" ? { snapshot: session } : {}),
      });

    const response: CreatePublicSessionShareResponse = {
      url: buildPublicShareUrl(
        secret,
        relayConfig,
        {
          mode: record.mode,
          capturedAt: record.capturedAt,
          initialPrompt,
          projectName,
          title,
        },
        deps.publicShareOrigin,
      ),
      mode: record.mode,
      createdAt: record.createdAt,
      secretBits,
    };
    return c.json(response);
  });

  return app;
}

export function createPublicSharePublicRoutes(
  deps: PublicShareRoutesDeps,
): Hono {
  const app = new Hono();

  app.get("/:secret", async (c) => {
    const secret = c.req.param("secret");
    const record = deps.publicShareService.getRecordBySecret(secret);
    if (!record) {
      return notFound(c);
    }

    let response: PublicSessionShareResponse | null;
    if (record.mode === "frozen") {
      response = deps.publicShareService.getFrozenShareBySecret(secret);
    } else {
      const session = await deps.loadSession(
        record.source.projectId,
        record.source.sessionId,
      );
      response = session
        ? deps.publicShareService.buildLiveResponse(record, session)
        : null;
    }

    if (!response) {
      return notFound(c);
    }

    c.header("Cache-Control", "no-store");
    return c.json(response);
  });

  return app;
}
