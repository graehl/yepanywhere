import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { toUrlProjectId } from "@yep-anywhere/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionMetadataProvider } from "../../contexts/SessionMetadataContext";
import { I18nProvider } from "../../i18n";
import { LocalFileModal, LocalMediaModal } from "../LocalMediaModal";

const originalCreateObjectUrlDescriptor = Object.getOwnPropertyDescriptor(
  URL,
  "createObjectURL",
);
const originalRevokeObjectUrlDescriptor = Object.getOwnPropertyDescriptor(
  URL,
  "revokeObjectURL",
);

function restoreObjectProperty(
  target: object,
  name: PropertyKey,
  descriptor: PropertyDescriptor | undefined,
) {
  if (descriptor) {
    Object.defineProperty(target, name, descriptor);
  } else {
    Reflect.deleteProperty(target, name);
  }
}

describe("LocalFileModal", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    restoreObjectProperty(
      URL,
      "createObjectURL",
      originalCreateObjectUrlDescriptor,
    );
    restoreObjectProperty(
      URL,
      "revokeObjectURL",
      originalRevokeObjectUrlDescriptor,
    );
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

describe("LocalMediaModal", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    restoreObjectProperty(
      URL,
      "createObjectURL",
      originalCreateObjectUrlDescriptor,
    );
    restoreObjectProperty(
      URL,
      "revokeObjectURL",
      originalRevokeObjectUrlDescriptor,
    );
  });

  it("renders image media as a raw image tab link", async () => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:local-media-image"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    const fetchBlob = vi.fn(
      async () => new Blob(["png"], { type: "image/png" }),
    );

    render(
      <I18nProvider>
        <LocalMediaModal
          path="/tmp/plot.png"
          mediaType="image"
          mediaSource={{ fetchBlob }}
          onClose={() => {}}
        />
      </I18nProvider>,
    );

    const imageLink = await screen.findByRole("link", {
      name: "Open image in new tab",
    });
    expect(imageLink.getAttribute("href")).toBe("blob:local-media-image");
    expect(imageLink.getAttribute("target")).toBe("_blank");
    expect(imageLink.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.getByRole("img", { name: "plot.png" })).toBeTruthy();
    expect(fetchBlob).toHaveBeenCalledWith(
      "/tmp/plot.png",
      "/api/local-image?path=%2Ftmp%2Fplot.png",
      "modal",
    );
  });
});
