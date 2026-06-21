import type { UrlProjectId } from "@yep-anywhere/shared";
import { describe, expect, it, vi } from "vitest";
import {
  findSessionSummaryAcrossProviders,
  listSessionsAcrossProviders,
} from "../../src/sessions/provider-resolution.js";
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

  it("lists OpenCode sessions for a project whose primary provider is Claude", async () => {
    const projectId = "proj-2" as UrlProjectId;
    const opencodeSummary: SessionSummary = {
      id: "ses_oc_listed",
      projectId,
      title: "OpenCode in a Claude project",
      fullTitle: "OpenCode in a Claude project",
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:01:00.000Z",
      messageCount: 3,
      ownership: { owner: "none" },
      provider: "opencode",
    };
    const emptyReader = makeReader(null);
    const opencodeReader = makeReader(opencodeSummary);
    const readerFactory = vi.fn((project: Project) =>
      project.provider === "opencode" ? opencodeReader : emptyReader,
    );

    const deps = {
      readerFactory,
      // Stub grok so the source list stays hermetic (no real ~/.grok read).
      grokReaderFactory: () => emptyReader,
    } as unknown as Parameters<typeof listSessionsAcrossProviders>[1];

    const sessions = await listSessionsAcrossProviders(
      {
        id: projectId,
        path: "/tmp/project2",
        name: "project2",
        sessionCount: 0,
        sessionDir: "/tmp/project2/.claude-sessions",
        activeOwnedCount: 0,
        activeExternalCount: 0,
        lastActivity: null,
        provider: "claude",
      },
      deps,
    );

    // OpenCode is now a candidate source for every project, so its sessions
    // surface even when the project's primary provider is Claude.
    expect(sessions.map((s) => s.id)).toContain("ses_oc_listed");
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
