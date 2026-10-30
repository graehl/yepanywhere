import { z } from "zod";

export const API_REVISION = "2026-10-30.1";
export const paginationQuery = z.object({
  cursor: z
    .string()
    .regex(/^(0|[1-9][0-9]{0,8})$/)
    .optional(),
  limit: z
    .string()
    .regex(/^(?:[1-9]|[1-9][0-9]|100)$/)
    .optional(),
});
export const pageQuery = paginationQuery.extend({
  projectId: z.string().min(1).max(4096).optional(),
});
export type PageQuery = z.infer<typeof pageQuery>;
export const principalSchema = z.object({
  kind: z.enum(["superuser", "limited"]),
  username: z.string().optional(),
});
export const serverSchema = z.object({
  id: z.string(),
  local: z.literal(true),
});
export const projectSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
});
export const providerSchema = z.object({
  id: z.string(),
  name: z.string(),
  supportsSteering: z.boolean(),
  supportsPermissionMode: z.boolean(),
});
export const sessionSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  provider: z.string(),
  title: z.string().nullable(),
  updatedAt: z.string(),
  createdByUser: z.string().optional(),
  state: z.string(),
});
export type ApiProject = z.infer<typeof projectSchema>;
export type ApiProvider = z.infer<typeof providerSchema>;
export type ApiSession = z.infer<typeof sessionSchema>;
export const catalogSchema = z.object({
  complete: z.boolean(),
  refreshing: z.boolean(),
});
export type CatalogState = z.infer<typeof catalogSchema>;
const page = <Item extends z.ZodType>(item: Item) =>
  z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
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
export const operations = [
  {
    id: "describe",
    path: "",
    response: z.object({
      serverId: z.string(),
      revision: z.literal(API_REVISION),
      stability: z.literal("unstable"),
      schema: z.literal("/v0/schema"),
      servers: z.literal("/v0/servers"),
    }),
  },
  {
    id: "me",
    path: "/me",
    response: z.object({ principal: principalSchema, session: z.null() }),
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
] as const;
export type Operation = (typeof operations)[number]["id"];
export const operationIds = operations.map((operation) => operation.id);

export function apiSchema() {
  return {
    openapi: "3.1.0",
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
            parameters: [
              ...[...operation.path.matchAll(/:([A-Za-z]+)/g)].map((match) => ({
                name: match[1],
                in: "path",
                required: true,
                schema: { type: "string" },
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
                      : "Request failed; pre-route security errors may use the existing YA error shape",
                  content: {
                    "application/json": {
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
