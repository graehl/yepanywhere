import { z } from "zod";
import { BaseEntrySchema } from "./BaseEntrySchema.js";

/**
 * Provider-owned transcript connector row. The nested attachment discriminants
 * change independently of the conversation entry envelope, so preserve them
 * without pretending YA has a complete schema for every attachment payload.
 */
export const AttachmentEntrySchema = BaseEntrySchema.extend({
  type: z.literal("attachment"),
  attachment: z.unknown(),
});

export type AttachmentEntry = z.infer<typeof AttachmentEntrySchema>;
