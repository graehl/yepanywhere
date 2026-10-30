import {
  conversationQuery,
  type ApiConversation,
  type ConversationReadQuery,
} from "./conversation.js";
import type { Principal } from "../auth/principal.js";
import { levelFor } from "../auth/limitedUserPolicy.js";
import {
  API_REVISION,
  apiHelp,
  apiSchema,
  operationIds,
  pageQuery,
  type ApiProject,
  type ApiProvider,
  type ApiSession,
  type CatalogState,
  type Operation,
  type PageQuery,
  type ApiLaunchContext,
} from "./contracts.js";

export interface CoreApiSources {
  projects(
    signal?: AbortSignal,
  ): Promise<{ items: ApiProject[]; catalog?: CatalogState }>;
  sessions(
    signal?: AbortSignal,
  ): Promise<{ items: ApiSession[]; catalog?: CatalogState }>;
  providers(signal?: AbortSignal): Promise<ApiProvider[]>;
  conversation?(
    sessionId: string,
    query: ConversationReadQuery,
    signal?: AbortSignal,
  ): Promise<ApiConversation>;
  hiddenProjects?(username: string): Promise<ReadonlySet<string>>;
}
export { CoreApiError } from "./errors.js";
import { CoreApiError } from "./errors.js";

const describePrincipal = (principal: Principal) =>
  principal.kind === "limited"
    ? { kind: principal.kind, username: principal.username }
    : { kind: principal.kind };

/** Application reads have no HTTP, provider-registry or discovery ownership. */
export class CoreApi {
  constructor(
    readonly serverId: string,
    private readonly sources: CoreApiSources,
  ) {}

  async read(
    operation: Operation,
    caller: Principal,
    input: {
      serverId?: string;
      sessionId?: string;
      query?: PageQuery & ConversationReadQuery;
      signal?: AbortSignal;
      /** Established by a trusted launch authenticator, never a request field. */
      launch?: ApiLaunchContext;
    } = {},
  ) {
    input.signal?.throwIfAborted();
    if (input.serverId !== undefined && input.serverId !== this.serverId) {
      throw new CoreApiError(
        "server_not_found",
        "Server is not configured here",
        404,
      );
    }
    if (input.query?.projectId !== undefined && operation !== "sessions") {
      throw new CoreApiError(
        "invalid_request",
        "projectId is only supported for the session catalog",
        400,
      );
    }
    const query = pageQuery.safeParse(input.query ?? {});
    if (!query.success)
      throw new CoreApiError(
        "invalid_request",
        "Invalid pagination or project filter",
        400,
      );
    const visible = (projectId: string) =>
      caller.kind === "superuser" ||
      levelFor(caller.grants, projectId) !== "none";
    const server = { id: this.serverId, local: true as const };
    switch (operation) {
      case "describe":
        return {
          serverId: this.serverId,
          revision: API_REVISION,
          stability: "unstable",
          schema: "/v0/schema",
          help: "/v0/help",
          me: "/v0/me",
          servers: "/v0/servers",
        };
      case "help":
        return apiHelp();
      case "schema":
        return apiSchema(Boolean(input.launch));
      case "me":
        return {
          principal: describePrincipal(caller),
          session: input.launch ?? null,
          server,
          observedAt: new Date().toISOString(),
          links: {
            help: "/v0/help",
            schema: "/v0/schema",
            access: `/v0/servers/${encodeURIComponent(this.serverId)}/access`,
            session: input.launch?.id
              ? `/v0/servers/${encodeURIComponent(this.serverId)}/sessions/${encodeURIComponent(input.launch.id)}`
              : null,
          },
        };
      case "servers":
        return { items: [server], nextCursor: null };
      case "server":
        return server;
      case "access":
        return {
          principal: describePrincipal(caller),
          scope:
            caller.kind === "superuser" ? "all-projects" : "project-grants",
          operations: operationIds,
        };
      case "capabilities":
        return {
          revision: API_REVISION,
          stability: "unstable",
          operations: operationIds,
          peerRouting: false,
        };
      case "providers":
        return this.page(
          await this.sources.providers(input.signal),
          query.data,
        );
      case "projects": {
        const result = await this.sources.projects(input.signal);
        const hidden =
          caller.kind === "limited"
            ? await this.sources.hiddenProjects?.(caller.username)
            : undefined;
        return {
          ...this.page(
            result.items
              .filter((p) => visible(p.id) && !hidden?.has(p.id))
              .sort((a, b) => a.id.localeCompare(b.id)),
            query.data,
          ),
          catalog: result.catalog,
        };
      }
      case "conversation": {
        const parsed = conversationQuery.safeParse(input.query ?? {});
        if (!parsed.success)
          throw new CoreApiError(
            "invalid_request",
            "Invalid conversation window",
            400,
          );
        await this.read("session", caller, { ...input, query: undefined });
        if (!this.sources.conversation)
          throw new CoreApiError(
            "conversation_unavailable",
            "Conversation source is not configured",
            503,
          );
        return this.sources.conversation(
          input.sessionId!,
          parsed.data,
          input.signal,
        );
      }
      case "sessions":
      case "session": {
        const result = await this.sources.sessions(input.signal);
        const projectsById = new Map<string, string>();
        const ambiguous = new Set<string>();
        for (const item of result.items) {
          const previous = projectsById.get(item.id);
          if (previous !== undefined && previous !== item.projectId)
            ambiguous.add(item.id);
          projectsById.set(item.id, item.projectId);
        }
        const hidden =
          operation === "sessions" && caller.kind === "limited"
            ? await this.sources.hiddenProjects?.(caller.username)
            : undefined;
        const items = result.items.filter(
          (s) =>
            !ambiguous.has(s.id) &&
            (visible(s.projectId) ||
              (caller.kind === "limited" &&
                s.createdByUser === caller.username)) &&
            !hidden?.has(s.projectId) &&
            (!query.data.projectId || query.data.projectId === s.projectId),
        );
        if (operation === "session") {
          const item = items.find((s) => s.id === input.sessionId);
          if (!item && result.catalog?.complete === false)
            throw new CoreApiError(
              "catalog_not_ready",
              "Session catalog is not ready",
              503,
            );
          if (!item)
            throw new CoreApiError(
              "session_not_found",
              "Session not found",
              404,
            );
          return item;
        }
        const unique = [
          ...new Map(items.map((item) => [item.id, item])).values(),
        ];
        unique.sort(
          (a, b) =>
            (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0) ||
            a.id.localeCompare(b.id),
        );
        return { ...this.page(unique, query.data), catalog: result.catalog };
      }
    }
  }

  private page<T>(items: T[], query: PageQuery) {
    const offset = Number(query.cursor ?? 0),
      limit = Number(query.limit ?? 50);
    const end = offset + limit;
    return {
      items: items.slice(offset, end),
      nextCursor: end < items.length ? String(end) : null,
    };
  }
}
