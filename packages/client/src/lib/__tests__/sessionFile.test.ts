import { describe, expect, it } from "vitest";
import {
  extractParentSessionIdFromAgentFileEvent,
  extractSessionIdFromFileEvent,
} from "../sessionFile";

describe("session file events", () => {
  it("extracts a regular session ID from its filename", () => {
    expect(
      extractSessionIdFromFileEvent({
        provider: "claude",
        relativePath: "project-hash/session-1.jsonl",
      }),
    ).toBe("session-1");
  });

  it("extracts a Claude child transcript's canonical parent session", () => {
    expect(
      extractParentSessionIdFromAgentFileEvent({
        provider: "claude",
        relativePath:
          "project-hash/parent-session/subagents/agent-child.meta.json",
      }),
    ).toBe("parent-session");
  });

  it("does not mistake a legacy child filename for a YA session ID", () => {
    expect(
      extractParentSessionIdFromAgentFileEvent({
        provider: "claude",
        relativePath: "project-hash/subagents/agent-child.jsonl",
      }),
    ).toBeNull();
  });

  it("ignores non-Claude child layouts", () => {
    expect(
      extractParentSessionIdFromAgentFileEvent({
        provider: "codex",
        relativePath: "2026/07/19/subagents/agent-child.jsonl",
      }),
    ).toBeNull();
  });
});
