import { beforeEach, describe, expect, it, vi } from "vitest";
import { LOCAL_CLIENT_SUMMARY_SOURCE_KEY } from "../clientSummaryStore";
import { getOrCreateCurrentSourceRuntime } from "../sourceRuntime";

const apiMocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getSessionMetadata: vi.fn(),
}));

vi.mock("../../api/client", () => ({
  api: apiMocks,
}));

describe("source runtime session detail API", () => {
  beforeEach(() => {
    apiMocks.getSession.mockReset();
    apiMocks.getSessionMetadata.mockReset();
  });

  it("forwards bounded session-detail requests", async () => {
    apiMocks.getSession.mockResolvedValueOnce({ ok: true });
    const runtime = getOrCreateCurrentSourceRuntime(
      LOCAL_CLIENT_SUMMARY_SOURCE_KEY,
    );

    await runtime.api.getSession({
      projectId: "proj-1",
      sessionId: "sess-1",
      tailCompactions: 2,
    });

    expect(apiMocks.getSession).toHaveBeenCalledWith(
      "proj-1",
      "sess-1",
      undefined,
      { tailCompactions: 2 },
    );
  });

  it("keeps full-history reads explicit without changing the server request", async () => {
    apiMocks.getSession.mockResolvedValueOnce({ ok: true });
    const runtime = getOrCreateCurrentSourceRuntime(
      LOCAL_CLIENT_SUMMARY_SOURCE_KEY,
    );

    await runtime.api.getSession({
      projectId: "proj-1",
      sessionId: "sess-1",
      fullHistory: true,
      fullHistoryReason: "test explicit full-history escape hatch",
    });

    expect(apiMocks.getSession).toHaveBeenCalledWith("proj-1", "sess-1");
  });

  it("rejects unbounded session-detail requests without explicit full history", () => {
    const runtime = getOrCreateCurrentSourceRuntime(
      LOCAL_CLIENT_SUMMARY_SOURCE_KEY,
    );

    expect(() =>
      runtime.api.getSession({
        projectId: "proj-1",
        sessionId: "sess-1",
      } as never),
    ).toThrow("Session detail request requires bounds or explicit fullHistory.");
    expect(apiMocks.getSession).not.toHaveBeenCalled();
  });

  it("rejects full-history requests without a reason", () => {
    const runtime = getOrCreateCurrentSourceRuntime(
      LOCAL_CLIENT_SUMMARY_SOURCE_KEY,
    );

    expect(() =>
      runtime.api.getSession({
        projectId: "proj-1",
        sessionId: "sess-1",
        fullHistory: true,
        fullHistoryReason: "",
      }),
    ).toThrow("Full-history session request requires a reason.");
    expect(apiMocks.getSession).not.toHaveBeenCalled();
  });
});
