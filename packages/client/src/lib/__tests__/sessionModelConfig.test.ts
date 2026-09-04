import { describe, expect, it } from "vitest";
import {
  liveModelConfigForProcess,
  resolveSessionModelConfig,
} from "../sessionModelConfig";

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
          requestedModel: "gpt-6-codex",
          thinking: { type: "adaptive" },
          effort: "high",
        },
        initialAck,
      ),
    ).toMatchObject({
      model: "gpt-6-codex",
      requestedModel: "gpt-6-codex",
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
      model: undefined,
      requestedModel: undefined,
      thinking: undefined,
      effort: undefined,
      promptSuggestionMode: undefined,
    });
  });

  it("uses the session fallback instead of an acknowledgement for provider default", () => {
    expect(
      resolveSessionModelConfig(
        null,
        {
          requestedModel: "default",
          thinking: null,
          effort: null,
        },
        initialAck,
      ),
    ).toEqual({
      model: undefined,
      requestedModel: "default",
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

  it("drops a live snapshot when its owning process disappears", () => {
    const snapshot = {
      processId: "process-1",
      config: { model: "gpt-5-codex", effort: "medium" },
    };
    const durable = {
      requestedModel: "gpt-6-codex",
      thinking: null,
      effort: "high" as const,
    };

    expect(
      resolveSessionModelConfig(
        liveModelConfigForProcess(snapshot, "process-1"),
        durable,
        initialAck,
      )?.effort,
    ).toBe("medium");
    expect(
      resolveSessionModelConfig(
        liveModelConfigForProcess(snapshot, undefined),
        durable,
        initialAck,
      ),
    ).toMatchObject({
      model: "gpt-6-codex",
      requestedModel: "gpt-6-codex",
      effort: "high",
    });
  });
});
