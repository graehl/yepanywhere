import { describe, expect, it } from "vitest";
import type { useI18n } from "../../i18n";
import { describeProviderRuntimeStatus } from "../providerRuntimeStatus";

const t = ((key: string, vars?: Record<string, string | number>) => {
  const values: Record<string, string> = {
    toolbarProviderRuntimeRateLimited: `${vars?.provider} rate limited`,
    toolbarProviderRuntimeRetrying: `${vars?.provider} retrying`,
    toolbarProviderRuntimeStopped: `${vars?.provider} stopped`,
    toolbarProviderRuntimeStoppedReason: `${vars?.label}: ${vars?.reason}`,
    toolbarProviderRuntimeRetryAt: `${vars?.label} - retry at ${vars?.time}`,
    providerRuntimeRetryingTitle: "The provider will retry automatically.",
    providerRuntimeTerminalTitle:
      "This turn ended and will not retry automatically.",
    providerRuntimeProcessTerminalTitle:
      "The provider process stopped and will not retry automatically.",
    providerRuntimeReasonRateLimit: "Rate limit",
    providerRuntimeReasonOverloaded: "Overloaded",
    providerRuntimeReasonServerError: "Server error",
    providerRuntimeReasonNetwork: "Network",
    providerRuntimeReasonUnknown: "Unknown",
    providerRuntimeReasonTitle: `reason: ${vars?.reason}`,
    providerRuntimeHttpStatusTitle: `HTTP status: ${vars?.status}`,
    providerRuntimeLastSeenTitle: `last seen: ${vars?.time}`,
    providerRuntimeOccurredTitle: `occurred: ${vars?.time}`,
    providerRuntimeSourceTitle: `source: ${vars?.source}`,
  };
  return values[key] ?? key;
}) as ReturnType<typeof useI18n>["t"];

describe("describeProviderRuntimeStatus", () => {
  it("accepts older retry status payloads without optional diagnostics", () => {
    const display = describeProviderRuntimeStatus(
      {
        kind: "retrying",
        provider: "claude",
        reason: "server_error",
        startedAt: "2026-07-10T18:00:00.000Z",
        lastSeenAt: "2026-07-10T18:00:01.000Z",
        eventCount: 1,
        source: "claude.system.api_retry",
      },
      t,
    );

    expect(display).toMatchObject({
      summary: "Claude retrying",
      tone: "warn",
    });
    expect(display?.title).toContain("will retry automatically");
  });

  it("uses danger tone and terminal copy when the turn will not retry", () => {
    const display = describeProviderRuntimeStatus(
      {
        kind: "terminal",
        provider: "codex",
        reason: "overloaded",
        message: "Selected model is at capacity.",
        occurredAt: "2026-07-10T18:14:32.213Z",
        source: "codex.error",
        turnId: "turn-1",
      },
      t,
    );

    expect(display).toMatchObject({
      summary: "Codex stopped: Overloaded",
      tone: "danger",
      retryAtMs: null,
    });
    expect(display?.title).toContain("will not retry automatically");
    expect(display?.title).toContain("Selected model is at capacity.");
  });

  it("includes optional Codex retry details when a new server provides them", () => {
    const display = describeProviderRuntimeStatus(
      {
        kind: "retrying",
        provider: "codex",
        reason: "network",
        startedAt: "2026-07-10T18:00:00.000Z",
        lastSeenAt: "2026-07-10T18:00:01.000Z",
        eventCount: 2,
        source: "codex.error",
        message: "Reconnecting... 2/5",
        details: "stream disconnected before completion",
      },
      t,
    );

    expect(display).toMatchObject({
      summary: "Codex retrying",
      tone: "warn",
    });
    expect(display?.title).toContain("Reconnecting... 2/5");
    expect(display?.title).toContain("stream disconnected before completion");
  });

  it("uses process-specific copy for an app-server exit", () => {
    const display = describeProviderRuntimeStatus(
      {
        kind: "terminal",
        provider: "codex",
        reason: "server_error",
        message: "Codex app-server exited (code=1, signal=null)",
        occurredAt: "2026-07-10T18:14:32.213Z",
        source: "codex.app_server_process",
        scope: "provider_process",
      },
      t,
    );

    expect(display?.title).toContain("provider process stopped");
    expect(display?.title).toContain("code=1");
  });
});
