import { describe, expect, it, vi } from "vitest";
import type { Message } from "../../types";
import { getCachedTranscriptProjection } from "../transcriptProjection/cache";

describe("transcript projection cache", () => {
  it("preserves identity for matching message and augment identities", () => {
    const messages: Message[] = [{ id: "user-1", role: "user", content: "Hi" }];
    const markdown = {};
    const augments = { markdown, activeToolApproval: true };
    const compile = vi.fn(() => []);

    const first = getCachedTranscriptProjection(messages, augments, compile);
    const second = getCachedTranscriptProjection(messages, augments, compile);

    expect(second).toBe(first);
    expect(compile).toHaveBeenCalledOnce();
    expect(compile).toHaveBeenCalledWith(messages, augments);
  });

  it("separates augment variants and evicts the oldest fourth variant", () => {
    const messages: Message[] = [{ id: "user-2", role: "user", content: "Hi" }];
    const markdownA = {};
    const markdownB = {};
    const compile = vi.fn(() => []);
    const variants = [
      undefined,
      { markdown: markdownA },
      { activeToolApproval: true },
      { markdown: markdownB },
    ];

    const results = variants.map((augments) =>
      getCachedTranscriptProjection(messages, augments, compile),
    );

    expect(compile).toHaveBeenCalledTimes(4);
    expect(getCachedTranscriptProjection(messages, variants[1], compile)).toBe(
      results[1],
    );
    expect(compile).toHaveBeenCalledTimes(4);
    expect(
      getCachedTranscriptProjection(messages, undefined, compile),
    ).not.toBe(results[0]);
    expect(compile).toHaveBeenCalledTimes(5);
  });
});
