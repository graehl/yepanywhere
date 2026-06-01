import type { UrlProjectId } from "@yep-anywhere/shared";
import { describe, expect, it, vi } from "vitest";
import { findSessionSummaryAcrossProviders } from "../../src/sessions/provider-resolution.js";
import type { ISessionReader } from "../../src/sessions/types.js";
import type { Project, SessionSummary } from "../../src/supervisor/types.js";

describe("provider resolution", () => {
  it("uses an OpenCode reader when metadata prefers opencode", async () => {
    const projectId = "proj-1" as UrlProjectId;
    const summary: SessionSummary = {
      id: "ses_opencode",
      projectId,
      title: "OpenCode",
      fullTitle: "OpenCode",
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:01:00.000Z",
      messageCount: 2,
      ownership: { owner: "none" },
      provider: "opencode",
    };
    const claudeReader = makeReader(null);
    const opencodeReader = makeReader(summary);
    const readerFactory = vi.fn((project: Project) =>
      project.provider === "opencode" ? opencodeReader : claudeReader,
    );

    const resolved = await findSessionSummaryAcrossProviders(
      {
        id: projectId,
        path: "/tmp/project",
        name: "project",
        sessionCount: 1,
        sessionDir: "/tmp/project/.claude-sessions",
        activeOwnedCount: 0,
        activeExternalCount: 0,
        lastActivity: null,
        provider: "claude",
      },
      "ses_opencode",
      projectId,
      { readerFactory },
      "opencode",
    );

    expect(resolved?.source.provider).toBe("opencode");
    expect(resolved?.summary).toBe(summary);
    expect(readerFactory).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "opencode" }),
    );
  });
});

function makeReader(summary: SessionSummary | null): ISessionReader {
  return {
    listSessions: vi.fn(async () => (summary ? [summary] : [])),
    getSessionSummary: vi.fn(async () => summary),
    getSession: vi.fn(async () => null),
    getSessionSummaryIfChanged: vi.fn(async () => null),
    getAgentMappings: vi.fn(async () => []),
    getAgentSession: vi.fn(async () => null),
  };
}
