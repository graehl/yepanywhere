import type { SessionDetailAction } from "./types";

/**
 * Constructors live here only when they adapt an input shape or enforce an
 * invariant the action type cannot express; otherwise dispatch
 * SessionDetailAction literals directly — the tagged union type-checks them.
 */
export function createFinalMarkdownAugmentAction(input: {
  messageId: string;
  html: string;
}): Extract<SessionDetailAction, { type: "applyFinalMarkdownAugment" }> {
  return {
    type: "applyFinalMarkdownAugment",
    messageId: input.messageId,
    augment: { html: input.html },
  };
}
