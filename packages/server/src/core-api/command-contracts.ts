import { z } from "zod";

export const requestIdSchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/)
  .describe(
    "Caller-generated unique retry key. Reuse with the identical request after a lost response; a conflicting payload returns 409. Never generate a new key merely to retry an uncertain operation.",
  );
export const createSessionRequest = z
  .object({
    requestId: requestIdSchema,
    projectId: z
      .string()
      .min(1)
      .max(4096)
      .describe(
        "Existing authorized project id from this server's projects collection. The server owns its path.",
      ),
    provider: z
      .enum(["claude", "codex"])
      .describe(
        "Configured native harness. Other providers, remote executors and blank-session creation are not qualified in this slice.",
      ),
    message: z
      .string()
      .min(1)
      .max(100000)
      .refine((value) => value.trim().length > 0)
      .describe(
        "Initial prompt, exact text. Native agents choose checkout/worktree and workflow behavior.",
      ),
    model: z
      .string()
      .min(1)
      .max(256)
      .optional()
      .describe(
        "Native/YA model selector; omitted or default uses the harness default. No installation or protocol upgrade is performed.",
      ),
    thinking: z
      .enum([
        "off",
        "auto",
        "low",
        "medium",
        "high",
        "xhigh",
        "max",
        "on:low",
        "on:medium",
        "on:high",
        "on:xhigh",
        "on:max",
      ])
      .optional()
      .describe(
        "Existing native thinking/effort selection; on:high is forced thinking with high effort.",
      ),
    permissionMode: z
      .enum(["default", "acceptEdits", "plan", "bypassPermissions", "auto"])
      .default("default")
      .describe("Native permission mode, explicit bypass only when requested."),
    serviceTier: z.string().min(1).max(128).optional(),
  })
  .strict();
export type CreateSessionRequest = z.infer<typeof createSessionRequest>;
export const creatorSchema = z.object({
  serverId: z
    .string()
    .describe(
      "Authenticated originating server. Local calls originate on this profile; peer identity is not accepted from JSON/headers.",
    ),
  sessionId: z
    .string()
    .nullable()
    .describe(
      "Trusted owning launch session; null for ordinary operator HTTP calls.",
    ),
  launchId: z.string().nullable(),
  principal: z.object({ kind: z.literal("superuser") }),
});
export type ApiCreator = z.infer<typeof creatorSchema>;
export const receiptSchema = z.object({
  id: z.string(),
  requestId: requestIdSchema,
  kind: z.enum(["createSession", "sendMessage"]),
  state: z
    .enum(["dispatching", "queued", "accepted", "failed", "uncertain"])
    .describe(
      "Admission evidence, not successful response completion. Uncertain operations are never automatically resubmitted.",
    ),
  projectId: z.string(),
  sessionId: z.string().nullable(),
  queueId: z.string().optional(),
  creator: creatorSchema,
  destinationServerId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  delivery: z
    .enum(["unknown", "consumed"])
    .describe(
      "consumed means the native provider input iterator consumed the input. It is not provider acknowledgement or successful completion.",
    ),
  completion: z
    .enum(["unknown"])
    .describe(
      "No completion claim is inferred from idle activity or unrelated replies. Follow the conversation and inspect evidence.",
    ),
  failure: z.object({ code: z.string(), message: z.string() }).optional(),
});
export type ApiReceipt = z.infer<typeof receiptSchema>;
export const relationshipsSchema = z.object({
  sessionId: z.string(),
  creation: receiptSchema
    .nullable()
    .describe(
      "First recorded v0 creation receipt; null does not establish a human origin for older sessions.",
    ),
  initiated: z.array(receiptSchema).max(100),
  nextCursor: z.string().nullable(),
});
