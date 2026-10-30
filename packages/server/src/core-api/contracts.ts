import { z } from "zod";
import { conversationQuery, conversationSchema } from "./conversation.js";

export const API_REVISION = "2026-10-30.4";
export const paginationQuery = z.object({
  cursor: z
    .string()
    .regex(/^(0|[1-9][0-9]{0,8})$/)
    .optional()
    .describe(
      "Offset returned as nextCursor by a previous page. Not a snapshot; concurrent changes can shift pages.",
    ),
  limit: z
    .string()
    .regex(/^(?:[1-9]|[1-9][0-9]|100)$/)
    .optional()
    .describe(
      "Maximum items returned: 1–100, default 50. Access filtering precedes pagination.",
    ),
});
export const pageQuery = paginationQuery.extend({
  projectId: z
    .string()
    .min(1)
    .max(4096)
    .optional()
    .describe(
      "Exact project id from the target server's projects collection. Supported only on session lists.",
    ),
});
export type PageQuery = z.infer<typeof pageQuery>;
export const principalSchema = z.object({
  kind: z
    .enum(["superuser", "limited"])
    .describe(
      "Resolved acting principal, not inferred from caller-supplied session ids.",
    ),
  username: z
    .string()
    .optional()
    .describe("Local limited-user name; absent for the operator."),
});
export const serverSchema = z.object({
  id: z
    .string()
    .describe(
      "Persistent public profile UUID; independent of relay username and relay installId.",
    ),
  local: z
    .literal(true)
    .describe("Only the receiving server is supported in this revision."),
});
export const projectSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z
    .string()
    .describe(
      "Project directory on the owning server, not the caller's filesystem.",
    ),
});
export const providerSchema = z.object({
  id: z.string(),
  name: z.string(),
  supportsSteering: z
    .boolean()
    .describe(
      "Harness capability; no v0 steering endpoint is implemented yet.",
    ),
  supportsPermissionMode: z
    .boolean()
    .describe(
      "Harness capability; does not grant permission or imply an implemented v0 configuration operation.",
    ),
});
export const sessionSchema = z.object({
  id: z
    .string()
    .describe(
      "Canonical YA session id. Provider-native resume handles are not separate API session ids.",
    ),
  projectId: z.string().describe("Project id in this server's catalog."),
  provider: z.string(),
  title: z.string().nullable(),
  updatedAt: z
    .string()
    .describe(
      "Timestamp used for descending chronological ordering, then session id.",
    ),
  createdByUser: z.string().optional(),
  state: z
    .string()
    .describe(
      "Observed runtime/catalog state, not a guarantee that a turn has completed. This resource is a summary, not a transcript.",
    ),
});
export type ApiProject = z.infer<typeof projectSchema>;
export type ApiProvider = z.infer<typeof providerSchema>;
export type ApiSession = z.infer<typeof sessionSchema>;
export const catalogSchema = z.object({
  complete: z
    .boolean()
    .describe(
      "False means an absent item is not yet evidence that it does not exist.",
    ),
  refreshing: z
    .boolean()
    .describe(
      "An existing catalog owner is refreshing observations; requests do not start a new scanner.",
    ),
});
export type CatalogState = z.infer<typeof catalogSchema>;
const page = <Item extends z.ZodType>(item: Item) =>
  z.object({
    items: z.array(item),
    nextCursor: z
      .string()
      .nullable()
      .describe(
        "Pass as cursor for the next page; null means no more items in this observation.",
      ),
    catalog: catalogSchema.optional(),
  });
export const errorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
export const capabilitiesSchema = z.object({
  revision: z.literal(API_REVISION),
  stability: z.literal("unstable"),
  operations: z.array(z.string()),
  peerRouting: z.literal(false),
});
export const accessSchema = z.object({
  principal: principalSchema,
  scope: z.enum(["all-projects", "project-grants"]),
  operations: z.array(z.string()),
});
export const launchContextSchema = z.object({
  id: z
    .string()
    .nullable()
    .describe(
      "Canonical owning YA session id, or null until its owner binds it.",
    ),
  launchId: z
    .string()
    .describe(
      "Provider-owner launch lease; inherited child environments identify this same launch.",
    ),
});
export type ApiLaunchContext = z.infer<typeof launchContextSchema>;
export const API_LAUNCH_VARIABLE = "yaApiLaunch";
export const operations = [
  {
    id: "describe",
    path: "",
    response: z.object({
      serverId: z.string(),
      revision: z.literal(API_REVISION),
      stability: z.literal("unstable"),
      schema: z.literal("/v0/schema"),
      help: z.literal("/v0/help"),
      me: z.literal("/v0/me"),
      servers: z.literal("/v0/servers"),
    }),
  },
  { id: "help", path: "/help", response: z.string() },
  {
    id: "schema",
    path: "/schema",
    response: z.record(z.string(), z.unknown()),
  },
  {
    id: "me",
    path: "/me",
    response: z.object({
      principal: principalSchema,
      session: launchContextSchema.nullable(),
      server: serverSchema,
      observedAt: z.string(),
      links: z.object({
        help: z.literal("/v0/help"),
        schema: z.literal("/v0/schema"),
        access: z.string(),
        session: z.string().nullable(),
      }),
    }),
  },
  { id: "servers", path: "/servers", response: page(serverSchema) },
  { id: "server", path: "/servers/:serverId", response: serverSchema },
  { id: "access", path: "/servers/:serverId/access", response: accessSchema },
  {
    id: "capabilities",
    path: "/servers/:serverId/capabilities",
    response: capabilitiesSchema,
  },
  {
    id: "projects",
    path: "/servers/:serverId/projects",
    response: page(projectSchema),
    paginated: true,
  },
  {
    id: "providers",
    path: "/servers/:serverId/providers",
    response: page(providerSchema),
    paginated: true,
  },
  {
    id: "sessions",
    path: "/servers/:serverId/sessions",
    response: page(sessionSchema),
    paginated: true,
  },
  {
    id: "session",
    path: "/servers/:serverId/sessions/:sessionId",
    response: sessionSchema,
  },
  {
    id: "conversation",
    path: "/servers/:serverId/sessions/:sessionId/conversation",
    response: conversationSchema,
  },
] as const;
export type Operation = (typeof operations)[number]["id"];
export const operationIds = operations.map((operation) => operation.id);

/** Human semantics and executable request examples share the wire contract. */
export const operationDocumentation: Record<
  Operation,
  { summary: string; description: string; example: string }
> = {
  describe: {
    summary: "Discover this API",
    description:
      "Read the receiving profile's persistent public server id, unstable revision and discovery links. Only this server is addressable; an unknown target never executes locally.",
    example: "/v0",
  },
  help: {
    summary: "Learn how to use the API",
    description:
      "Read the Markdown guide and operation reference. Uses the same authentication as other v0 reads; contains no credentials or private catalog entries.",
    example: "/v0/help",
  },
  schema: {
    summary: "Inspect the OpenAPI contract",
    description:
      "Read OpenAPI 3.1 request/response schemas, descriptions, bounds and examples for this build's implemented operations.",
    example: "/v0/schema",
  },
  me: {
    summary: "Inspect your caller identity",
    description:
      "Read the authenticated acting principal. Ordinary operator/limited-user authentication does not bind an agent session and returns session=null. A dedicated launch credential identifies its owning session and launch; id=null means canonical identity is pending. A session id supplied by the caller is not proof of identity.",
    example: "/v0/me",
  },
  servers: {
    summary: "List addressable servers",
    description:
      "Returns only the receiving server. Peer directory, remote routing and enrollment are not implemented. A public UUID names a profile; it does not authenticate it.",
    example: "/v0/servers",
  },
  server: {
    summary: "Inspect a server",
    description:
      "Read the receiving server's public identity. Unknown target ids return 404 server_not_found, with no local fallback.",
    example: "/v0/servers/{serverId}",
  },
  access: {
    summary: "Inspect effective catalog access",
    description:
      "Describe the caller's all-project or project-grant scope and supported read operations. Resource filtering and creator access still apply; a capability is not a grant to arbitrary projects.",
    example: "/v0/servers/{serverId}/access",
  },
  capabilities: {
    summary: "Discover implemented operations",
    description:
      "Read server implementation support, independently of caller/resource authorization. peerRouting is false. Provider steering flags do not imply a v0 steering endpoint.",
    example: "/v0/servers/{serverId}/capabilities",
  },
  projects: {
    summary: "Find authorized projects",
    description:
      "List retained project summaries ordered by id. Grants and personal hidden-project preferences filter before paging. path is on the target host. Catalog observations may be incomplete while refreshing.",
    example: "/v0/servers/{serverId}/projects?limit=50",
  },
  providers: {
    summary: "List configured provider harnesses",
    description:
      "Returns harness descriptors and supported controls, not installation checks, authentication readiness or a model catalog. No provider discovery is started by this request.",
    example: "/v0/servers/{serverId}/providers?limit=50",
  },
  sessions: {
    summary: "Find session summaries",
    description:
      "List retained summaries, optionally filtered by exact projectId. Newest updatedAt first, then id. Resource grants, creator access and hidden projects apply before pagination. Ambiguous cross-project ids are omitted. This does not return messages or completion results.",
    example: "/v0/servers/{serverId}/sessions?projectId={projectId}&limit=1",
  },
  conversation: {
    summary: "Read compact conversation and activity",
    description:
      "Read exact user prose and agent Markdown, stable message ids, observed activity, bounded failure/media references and pending attention. Routine tool payloads, thinking and HTML are excluded. Defaults to 20 messages within the recent two compactions; coverage and truncated flags state limits. idle is not proof of successful completion. Unsupported providers/history return 503 conversation_unavailable; missing anchors return 404 anchor_unavailable.",
    example:
      "/v0/servers/{serverId}/sessions/{sessionId}/conversation?maxMessages=20",
  },
  session: {
    summary: "Inspect one session summary",
    description:
      "Read a canonical YA session summary. Missing/inaccessible/ambiguous sessions return 404 in a complete catalog, or 503 catalog_not_ready if absence is uncertain. Hidden list preferences do not revoke direct access. No transcript or messages are returned.",
    example: "/v0/servers/{serverId}/sessions/{sessionId}",
  },
};

export const errorDescriptions = {
  400: "invalid_request: malformed pagination/conversation window or unsupported query parameters.",
  401: "Authentication missing, invalid or expired. Host authentication may return its existing error format.",
  403: "Request denied by host, origin, custom-header or principal policy. The hosting security layer may use its existing error format.",
  404: "Unknown resource/server, or session absent/inaccessible/ambiguous in a complete catalog; anchor_unavailable means choose another history window explicitly. No target fallback.",
  500: "internal_error: unexpected read failure; private exception details are not returned.",
  503: "catalog_not_ready: session absence is uncertain in an incomplete catalog; controller_unavailable: the catalog owner is detached/reloading. Retry reads later; neither means the session was deleted. conversation_unavailable means unsupported, unreadable or over-budget history; do not infer successful completion.",
};

export function apiHelp() {
  return [
    "# Yep Anywhere HTTP API v0",
    "",
    `Revision: ${API_REVISION}. Unstable: routes, fields and behavior may change.`,
    "",
    "Use this API to inspect authorized projects, configured provider harnesses and coding-agent session summaries and compact conversations. This build is READ ONLY. Session creation, message sending, configuration, interruption, command execution, terminals and peer routing are not implemented in v0. Do not infer support from older /api routes or provider capability flags.",
    "",
    "## Connect and discover",
    "",
    "Use your supplied connection and authentication. Normal server access follows the host's operator cookie/token or authenticated transport policy; desktop sessions use their own cookie bootstrap. When the ordinary host has authentication disabled or unconfigured without a desktop auth floor, it may admit requests as the operator without a credential. When authentication is required, supply the host credential. Follow the host's custom-header requirement when using its ordinary TCP API. A dedicated agent adapter always requires its supplied launch bearer, including help/schema. If supplied, AGENT_YA_V0_SOCKET selects Unix HTTP; otherwise use the supplied loopback AGENT_YA_V0_URL on Windows. Never guess a port, profile or credential. Only qualified launches advertise this connection.",
    "",
    "Read GET /v0 for serverId, GET /v0/me for caller identity, and GET /v0/schema for exact parameter and response schemas. Copy ids from responses, not names or local paths. URL-encode path ids and query values. A session belongs to a server; projects and paths are not global across hosts.",
    "",
    "## Find a project and its sessions",
    "",
    ...["projects", "sessions", "session", "conversation"].flatMap((id) => {
      const doc = operationDocumentation[id as Operation];
      return [`GET ${doc.example}`, doc.description, ""];
    }),
    "Replace {serverId} with GET /v0's serverId, {projectId} with an authorized project's id and {sessionId} with a session list item's id. Examples are request paths, not commands that guess your credentials.",
    "",
    "Collections return {items, nextCursor, catalog?}. Follow non-null nextCursor using cursor; keep your projectId/limit filter. Limit defaults to 50, maximum 100. Cursors are offsets, not snapshots: concurrent changes can shift pages. Grants filter before paging. catalog.complete=false means missing entries are uncertain; refreshing reports shared background observation, not work your request must poll forever.",
    "",
    "## Errors and observation",
    "",
    ...Object.entries(errorDescriptions).map(
      ([status, description]) => `- ${status}: ${description}`,
    ),
    "",
    "V0 handler errors use {error: {code, message}}. Earlier host authentication/policy errors can use existing JSON/text formats. Responses are no-store. Session state is an observation, not proof of turn completion. This surface starts no provider, independent scanner or retry loop.",
    "",
    "## Operation reference",
    "",
    ...operations.flatMap((operation) => {
      const doc = operationDocumentation[operation.id];
      return [
        `### ${doc.summary}`,
        `GET /v0${operation.path.replace(/:([A-Za-z]+)/g, "{$1}")}`,
        doc.description,
        `Example: GET ${doc.example}`,
        "",
      ];
    }),
  ].join("\n");
}

export function apiSchema(launchBound = false) {
  return {
    openapi: "3.1.0",
    ...(launchBound
      ? {
          security: [{ launchBearer: [] }],
          components: {
            securitySchemes: {
              launchBearer: {
                type: "http",
                scheme: "bearer",
                description:
                  "Launch-scoped Authorization header from AGENT_YA_V0_AUTHORIZATION. Required for every request on the dedicated agent listener, including help/schema. Never use the desktop master credential.",
              },
            },
          },
        }
      : {}),
    info: {
      title: "YA HTTP API",
      version: API_REVISION,
      description:
        "Unstable v0: incompatible changes are permitted. Provider descriptors are configured harnesses, not an installed/authenticated model catalog. Session lists are retained summaries and may be incomplete while refreshing. Cursors are offsets, not snapshot handles.",
    },
    paths: Object.fromEntries(
      operations.map((operation) => [
        `/v0${operation.path.replace(/:([A-Za-z]+)/g, "{$1}")}`,
        {
          get: {
            operationId: operation.id,
            summary: operationDocumentation[operation.id].summary,
            description: operationDocumentation[operation.id].description,
            "x-example-request": {
              method: "GET",
              path: operationDocumentation[operation.id].example,
            },
            parameters: [
              ...(operation.id === "conversation"
                ? Object.entries(conversationQuery.shape).map(
                    ([name, schema]) => ({
                      name,
                      in: "query",
                      required: false,
                      description: schema.description,
                      schema: z.toJSONSchema(schema),
                    }),
                  )
                : []),
              ...[...operation.path.matchAll(/:([A-Za-z]+)/g)].map((match) => ({
                name: match[1],
                in: "path",
                required: true,
                description:
                  match[1] === "serverId"
                    ? "Public server id from GET /v0; unknown targets fail without local fallback."
                    : "Canonical YA session id from this target's session collection.",
                schema: { type: "string", minLength: 1 },
              })),
              ...("paginated" in operation
                ? Object.entries(
                    operation.id === "sessions"
                      ? pageQuery.shape
                      : paginationQuery.shape,
                  ).map(([name, schema]) => ({
                    name,
                    in: "query",
                    required: false,
                    description: schema.description,
                    schema: z.toJSONSchema(schema),
                  }))
                : []),
            ],
            responses: Object.fromEntries(
              [200, 400, 401, 403, 404, 500, 503].map((status) => [
                status,
                {
                  description:
                    status === 200
                      ? "Success"
                      : errorDescriptions[
                          status as keyof typeof errorDescriptions
                        ],
                  content: {
                    [operation.id === "help" && status === 200
                      ? "text/markdown"
                      : "application/json"]: {
                      schema: z.toJSONSchema(
                        status === 200
                          ? operation.response
                          : status === 401 || status === 403
                            ? z.union([
                                errorSchema,
                                z.object({
                                  error: z.string(),
                                  setupRequired: z.boolean().optional(),
                                }),
                              ])
                            : errorSchema,
                      ),
                    },
                  },
                },
              ]),
            ),
          },
        },
      ]),
    ),
  };
}
