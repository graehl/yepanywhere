import { z } from "zod";
import { pageQuery } from "../core-api/contracts.js";

/** Only existing catalog reads cross the trusted provider/controller channel. */
export const agentCatalogRequest = z
  .object({
    operation: z.enum(["projects", "providers", "sessions", "session"]),
    input: z
      .object({
        serverId: z.string().min(1).max(4096).optional(),
        sessionId: z.string().min(1).max(4096).optional(),
        query: pageQuery.optional(),
      })
      .strict(),
  })
  .strict();
export const AGENT_CATALOG_TIMEOUT_MS = 10_000;
export const AGENT_CATALOG_MAX_BYTES = 2 * 1024 * 1024;
