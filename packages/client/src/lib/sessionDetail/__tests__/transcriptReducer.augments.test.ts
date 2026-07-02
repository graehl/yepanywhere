import { describe, expect, it } from "vitest";
import { preprocessMessages } from "../../preprocessMessages";
import type { Message, SessionMetadata } from "../../../types";
import {
  createCatchupMessagesAction,
  createFinalMarkdownAugmentAction,
  createLoadPersistedTranscriptAction,
  createStreamMessageActions,
  hydrateInitialSessionDetailState,
} from "../actionAdapters";
import { selectSessionDetailPreprocessAugments } from "../selectors";
import {
  createInitialSessionDetailState,
  reduceSessionDetailActions,
  reduceSessionDetailState,
} from "../transcriptReducer";

function sessionMetadata(provider = "claude"): SessionMetadata {
  return {
    id: "session-augments",
    projectId: "project-1",
    provider,
    title: "Session augments",
    updatedAt: "2026-07-01T12:00:00.000Z",
    createdAt: "2026-07-01T12:00:00.000Z",
    messageCount: 1,
    ownership: { owner: "none" },
  } as SessionMetadata;
}

function assistantMessage(uuid: string, text: string): Message {
  return {
    uuid,
    type: "assistant",
    timestamp: "2026-07-01T12:00:01.000Z",
    message: {
      role: "assistant",
      content: [{ type: "text", text }],
    },
  };
}

function getFirstTextAugmentHtml(messages: Message[]) {
  const items = preprocessMessages(
    messages,
    selectSessionDetailPreprocessAugments({
      ...createInitialSessionDetailState(),
      messages,
      markdownAugments: {},
    }),
  );
  return items.find((item) => item.type === "text")?.augmentHtml;
}

function getStateTextAugmentHtml(
  state: ReturnType<typeof createInitialSessionDetailState>,
) {
  const items = preprocessMessages(
    state.messages,
    selectSessionDetailPreprocessAugments(state),
  );
  return items.find((item) => item.type === "text")?.augmentHtml;
}

describe("transcriptReducer markdown augments", () => {
  it("retains a final markdown augment that arrives before its message", () => {
    const html = "<p>Rendered <strong>answer</strong>.</p>";
    const state = reduceSessionDetailActions([
      createFinalMarkdownAugmentAction({
        messageId: "assistant-1",
        html,
      }),
      createLoadPersistedTranscriptAction({
        session: sessionMetadata(),
        messages: [assistantMessage("assistant-1", "Rendered answer.")],
      }),
    ]);

    expect(state.markdownAugments).toEqual({
      "assistant-1": { html },
    });
    expect(getStateTextAugmentHtml(state)).toBe(html);
  });

  it("attaches a final markdown augment that arrives after its message", () => {
    const html = "<p>Rendered after load.</p>";
    const state = reduceSessionDetailActions([
      createLoadPersistedTranscriptAction({
        session: sessionMetadata(),
        messages: [assistantMessage("assistant-1", "Rendered after load.")],
      }),
      createFinalMarkdownAugmentAction({
        messageId: "assistant-1",
        html,
      }),
    ]);

    expect(getStateTextAugmentHtml(state)).toBe(html);
  });

  it("uses markdown augments supplied by a persisted transcript load", () => {
    const html = "<p>Loaded with the transcript.</p>";
    const state = reduceSessionDetailState(
      createInitialSessionDetailState(),
      createLoadPersistedTranscriptAction({
        session: sessionMetadata(),
        messages: [
          assistantMessage("assistant-1", "Loaded with the transcript."),
        ],
        markdownAugments: {
          "assistant-1": { html },
        },
      }),
    );

    expect(getStateTextAugmentHtml(state)).toBe(html);
  });

  it("moves a final markdown augment from a live Codex id to its durable id", () => {
    const html = "<p>Rendered durable answer.</p>";
    const state = reduceSessionDetailActions(
      [
        ...createStreamMessageActions([
          assistantMessage("live-assistant-1", "Rendered durable answer."),
        ]),
        createFinalMarkdownAugmentAction({
          messageId: "live-assistant-1",
          html,
        }),
        createCatchupMessagesAction({
          session: sessionMetadata("codex"),
          messages: [
            assistantMessage(
              "response_item_019b8510-augment-durable",
              "Rendered durable answer.",
            ),
          ],
        }),
      ],
      hydrateInitialSessionDetailState(
        createInitialSessionDetailState(),
        sessionMetadata("codex"),
      ),
    );

    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]?.uuid).toBe(
      "response_item_019b8510-augment-durable",
    );
    expect(state.markdownAugments).toEqual({
      "response_item_019b8510-augment-durable": { html },
    });
    expect(getStateTextAugmentHtml(state)).toBe(html);
  });

  it("does not update state for duplicate markdown augment HTML", () => {
    const first = reduceSessionDetailState(createInitialSessionDetailState(), {
      type: "applyFinalMarkdownAugment",
      messageId: "assistant-1",
      augment: { html: "<p>One</p>" },
    });
    const duplicate = reduceSessionDetailState(first, {
      type: "applyFinalMarkdownAugment",
      messageId: "assistant-1",
      augment: { html: "<p>One</p>" },
    });
    const updated = reduceSessionDetailState(duplicate, {
      type: "applyFinalMarkdownAugment",
      messageId: "assistant-1",
      augment: { html: "<p>Two</p>" },
    });

    expect(duplicate).toBe(first);
    expect(updated).not.toBe(first);
    expect(updated.markdownAugments["assistant-1"]).toEqual({
      html: "<p>Two</p>",
    });
  });

  it("returns no preprocess augments when no data-level augments exist", () => {
    expect(
      getFirstTextAugmentHtml([assistantMessage("assistant-1", "Plain.")]),
    ).toBeUndefined();
    expect(
      selectSessionDetailPreprocessAugments(createInitialSessionDetailState()),
    ).toBeUndefined();
  });
});
