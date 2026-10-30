import { z } from "zod";
import { followQuery } from "../core-api/conversation.js";
import { pageQuery, launchContextSchema } from "../core-api/contracts.js";

/** Only existing catalog reads cross the trusted provider/controller channel. */
export const agentCatalogRequest = z
  .object({
    operation: z.enum([
      "projects",
      "providers",
      "sessions",
      "session",
      "conversation",
      "followConversation",
      "createSession",
      "receipt",
      "relationships",
    ]),
    input: z
      .object({
        serverId: z.string().min(1).max(4096).optional(),
        sessionId: z.string().min(1).max(4096).optional(),
        receiptId: z.string().min(1).max(128).optional(),
        body: z.unknown().optional(),
        launch: launchContextSchema.optional(),
        query: pageQuery
          .extend(followQuery.shape)
          .catchall(z.string().max(4096))
          .optional(),
      })
      .strict(),
  })
  .strict();
export const AGENT_CATALOG_TIMEOUT_MS = 10_000;
export const AGENT_CATALOG_MAX_BYTES = 2 * 1024 * 1024;
