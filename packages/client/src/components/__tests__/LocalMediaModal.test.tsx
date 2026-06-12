import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { toUrlProjectId } from "@yep-anywhere/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionMetadataProvider } from "../../contexts/SessionMetadataContext";
import { I18nProvider } from "../../i18n";
import { LocalFileModal } from "../LocalMediaModal";

describe("LocalFileModal", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows project-relative metadata while fetching the raw local path", async () => {
    const projectRoot = "C:\\Users\\user\\Documents\\code\\playbox";
    const rawPath = `${projectRoot}\\docs\\note.md`;
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => {
        return new Response("hello", {
          headers: { "Content-Type": "text/plain" },
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <I18nProvider>
        <SessionMetadataProvider
          projectId={toUrlProjectId(projectRoot)}
          projectPath={projectRoot}
          sessionId="session-1"
        >
          <LocalFileModal
            resource={{
              kind: "local-file",
              path: rawPath,
              lineNumber: 12,
              columnNumber: 4,
            }}
            onClose={() => {}}
          />
        </SessionMetadataProvider>
      </I18nProvider>,
    );

    const metadata = screen.getByText("docs/note.md:12:4");
    expect(metadata.getAttribute("title")).toBe(`${rawPath}:12:4`);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      encodeURIComponent(rawPath),
    );
  });
});
