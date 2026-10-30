import { z } from "zod";
import { conversationQuery } from "../core-api/conversation.js";
import { pageQuery } from "../core-api/contracts.js";

/** Only existing catalog reads cross the trusted provider/controller channel. */
export const agentCatalogRequest = z
  .object({
    operation: z.enum([
      "projects",
      "providers",
      "sessions",
      "session",
      "conversation",
    ]),
    input: z
      .object({
        serverId: z.string().min(1).max(4096).optional(),
        sessionId: z.string().min(1).max(4096).optional(),
        query: pageQuery
          .extend(conversationQuery.shape)
          .catchall(z.string().max(4096))
          .optional(),
      })
      .strict(),
  })
  .strict();
export const AGENT_CATALOG_TIMEOUT_MS = 10_000;
export const AGENT_CATALOG_MAX_BYTES = 2 * 1024 * 1024;
