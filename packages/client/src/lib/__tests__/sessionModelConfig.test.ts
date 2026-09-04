import { describe, expect, it } from "vitest";
import { resolveSessionModelConfig } from "../sessionModelConfig";

describe("resolveSessionModelConfig", () => {
  const initialAck = {
    model: "gpt-5-codex",
    thinking: { type: "enabled" },
    effort: "medium",
  };

  it("prefers live process settings", () => {
    expect(
      resolveSessionModelConfig(
        {
          model: "gpt-6-codex",
          requestedModel: "gpt-6-codex",
          thinking: { type: "adaptive" },
          effort: "xhigh",
        },
        {
          requestedModel: "gpt-5-codex",
          thinking: { type: "enabled" },
          effort: "high",
        },
        initialAck,
      ),
    ).toMatchObject({
      model: "gpt-6-codex",
      requestedModel: "gpt-6-codex",
      thinking: { type: "adaptive" },
      effort: "xhigh",
    });
  });

  it("prefers durable settings over the initial config acknowledgement", () => {
    expect(
      resolveSessionModelConfig(
        null,
        {
          requestedModel: "gpt-5-codex",
          thinking: { type: "adaptive" },
          effort: "high",
        },
        initialAck,
      ),
    ).toMatchObject({
      model: "gpt-5-codex",
      requestedModel: "gpt-5-codex",
      thinking: { type: "adaptive" },
      effort: "high",
    });
  });

  it("uses durable nulls instead of stale acknowledgement values", () => {
    expect(
      resolveSessionModelConfig(
        null,
        {
          requestedModel: null,
          thinking: null,
          effort: null,
        },
        initialAck,
      ),
    ).toEqual({
      model: "gpt-5-codex",
      requestedModel: undefined,
      thinking: undefined,
      effort: undefined,
      promptSuggestionMode: undefined,
    });
  });

  it("keeps the initial acknowledgement fallback for older servers", () => {
    expect(
      resolveSessionModelConfig(null, undefined, initialAck),
    ).toMatchObject(initialAck);
  });

  it("returns null when no source is available", () => {
    expect(resolveSessionModelConfig(null, undefined, null)).toBeNull();
  });
});
