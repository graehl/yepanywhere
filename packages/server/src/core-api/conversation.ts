import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  ActivityStateSchema,
  TextContentSchema,
  ActivityContentSchema,
  FailureContentSchema,
  MediaContentSchema,
  HistoryCoverageSchema,
  SnapshotEnvelopeSchema,
} from "@yep-anywhere/shared/experimental/simple-client.generated";
import type { ConversationSubscriptions } from "../experimental/conversation-subscriptions.js";
import { CoreApiError } from "./errors.js";

export const conversationQuery = z
  .object({
    maxMessages: z
      .string()
      .regex(/^(?:[1-9]|[1-9][0-9]|100)$/)
      .optional()
      .describe(
        "Visible user/agent messages, 1–100, default 20; scoped to the recent two compactions.",
      ),
    anchorMessageId: z
      .string()
      .min(1)
      .max(256)
      .optional()
      .describe(
        "Stable message id to end the window at. Unavailable anchors fail explicitly; no silent jump to latest.",
      ),
  })
  .strict();
export type ConversationReadQuery = z.infer<typeof conversationQuery>;
export const conversationSchema = z.object({
  sessionId: z.string(),
  revision: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .describe(
      "Opaque content revision, scoped to the selected window. Not an event-log offset.",
    ),
  activity: ActivityStateSchema.describe(
    "Observed idle/working/waiting/unknown, independent of whether the last message is complete.",
  ),
  messages: z
    .array(
      z.object({
        id: z.string(),
        role: z.enum(["user", "agent"]),
        createdAt: z.string().nullable(),
        state: z.enum(["complete", "growing", "interrupted"]),
        truncated: z.boolean(),
        content: z
          .array(
            z.union([
              TextContentSchema,
              ActivityContentSchema,
              FailureContentSchema,
              MediaContentSchema,
            ]),
          )
          .max(64),
      }),
    )
    .max(100),
  pendingRequests: z
    .array(
      z.object({
        id: z.string().nullable(),
        kind: z.string(),
        prompt: z.string().optional(),
        options: z.array(z.string()).optional(),
        canAnswer: z.literal(false),
      }),
    )
    .max(16)
    .describe(
      "Read-only pending attention. No approval/answer endpoint is implied.",
    ),
  coverage: HistoryCoverageSchema.describe(
    "Incomplete/byte/compaction/anchor evidence; an empty or idle view does not establish successful completion.",
  ),
});
export type ApiConversation = z.infer<typeof conversationSchema>;

/** Thin port adapter over the shared observation owner; no HTTP or app startup. */
export function createConversationRead(
  subscriptions: ConversationSubscriptions,
) {
  return (
    sessionId: string,
    query: ConversationReadQuery,
    signal?: AbortSignal,
  ): Promise<ApiConversation> =>
    new Promise((resolve, reject) => {
      let release: (() => void) | undefined;
      let finished = false;
      const finish = (value?: ApiConversation, error?: unknown) => {
        if (finished) return;
        finished = true;
        clearTimeout(deadline);
        signal?.removeEventListener("abort", abort);
        queueMicrotask(() => release?.());
        if (error) reject(error);
        else resolve(value!);
      };
      const unavailable = () =>
        finish(
          undefined,
          new CoreApiError(
            "conversation_unavailable",
            "Conversation history is unavailable or exceeds its acquisition bounds",
            503,
          ),
        );
      const abort = () =>
        finish(
          undefined,
          signal?.reason ?? new Error("Conversation read aborted"),
        );
      // Below the controller bridge deadline; stalled sources release all demand.
      const deadline = setTimeout(unavailable, 4000);
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) {
        abort();
        return;
      }
      try {
        release = subscriptions.subscribe(
          {
            sessionId,
            maxMessages: Number(query.maxMessages ?? 20),
            anchorMessageId: query.anchorMessageId ?? null,
          },
          randomUUID(),
          {
            close: unavailable,
            send(encoded) {
              try {
                const { view } = SnapshotEnvelopeSchema.parse(
                  JSON.parse(encoded),
                );
                if (view.kind !== "conversation") {
                  if (
                    view.kind === "error" &&
                    view.code === "anchorUnavailable"
                  )
                    finish(
                      undefined,
                      new CoreApiError(
                        "anchor_unavailable",
                        "Anchor is outside available history; choose another window explicitly",
                        404,
                      ),
                    );
                  else unavailable();
                  return;
                }
                const opaque = view.messages.some((message) =>
                  message.content.some((content) => content.kind === "unknown"),
                );
                const body = {
                  sessionId: view.sessionId,
                  activity: view.activity,
                  messages: view.messages.map((message) => ({
                    ...message,
                    content: message.content.map((content) =>
                      content.kind === "unknown"
                        ? {
                            kind: "text" as const,
                            format: "plain" as const,
                            text: `Unavailable content (${content.originalKind.slice(0, 128)})`,
                          }
                        : content,
                    ),
                  })),
                  pendingRequests: view.pendingRequests.map((request) =>
                    request.kind === "question"
                      ? request
                      : {
                          kind: request.originalKind,
                          id: null,
                          canAnswer: false as const,
                        },
                  ),
                  coverage: opaque
                    ? {
                        ...view.coverage,
                        completeForRequest: false,
                        limitedBy: [
                          ...new Set([
                            ...view.coverage.limitedBy,
                            "unavailable" as const,
                          ]),
                        ],
                      }
                    : view.coverage,
                };
                const revision = createHash("sha256")
                  .update(JSON.stringify(body))
                  .digest("hex");
                finish(conversationSchema.parse({ ...body, revision }));
              } catch {
                unavailable();
              }
            },
          },
        );
        if (finished) release();
      } catch {
        unavailable();
      }
    });
}
