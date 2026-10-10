import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ArtifactViewerStatus } from "@yep-anywhere/shared";
import { afterEach, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../i18n";
import { ArtifactSettings } from "../ArtifactSettings";

const mock = vi.hoisted(() => ({
  status: undefined as ArtifactViewerStatus | undefined,
  fetch: vi.fn(),
  copy: vi.fn(async (_text: string) => true),
}));
vi.mock("../../../hooks/useVersion", () => ({
  useVersion: () => ({
    version: { artifactViewer: mock.status },
    refetch: async () => {},
  }),
  useRetainedVersionInfo: () => ({ artifactViewer: mock.status }),
}));
vi.mock("../../../contexts/SourceRuntimeContext", () => ({
  useCurrentSourceRuntime: () => ({
    sourceKey: "test",
    transport: { fetch: mock.fetch, capabilities: { sameOriginUrls: true } },
  }),
}));
vi.mock("../../../hooks/useVhostAccess", () => ({
  useVhostAccess: () => ({
    supported: true,
    refresh: () => {},
    config: { ...mock.status, accessTokens: { app: "tok", site: "stok" } },
  }),
}));
vi.mock("../../../lib/clipboard", () => ({
  writeClipboardText: mock.copy,
}));
vi.mock("../ProjectAppInventorySection", () => ({
  ProjectAppInventorySection: () => null,
}));
afterEach(() => {
  cleanup();
  mock.fetch.mockReset();
  mock.copy.mockClear();
});

const status: ArtifactViewerStatus = {
  available: true,
  locked: false,
  port: 4402,
  defaultLocalOrigin: "http://artifacts.localhost:3400",
  localOrigin: "http://artifacts.localhost:3400",
  vhostPublicRoot: "example.org",
  vhosts: [{ name: "app", port: 5173 }],
  vhostSites: [{ name: "site", path: "/p/site/index.html" }],
};

function renderSettings() {
  mock.status = status;
  mock.fetch.mockResolvedValue({
    sites: [{ name: "site", path: "/p/site/index.html", kind: "file" }],
  });
  render(
    <I18nProvider>
      <ArtifactSettings />
    </I18nProvider>,
  );
  return within(screen.getByRole("table", { name: "Hosted apps" }));
}

it("links each saved row to its service in a new tab, with its access token", () => {
  const table = renderSettings();
  const app = table.getByRole("link", { name: /Open app in a new tab/ });
  expect(app.getAttribute("href")).toBe(
    "https://app.example.org/?ya_access=tok",
  );
  expect(app.getAttribute("target")).toBe("_blank");
  expect(
    table
      .getByRole("link", { name: /Open site in a new tab/ })
      .getAttribute("href"),
  ).toBe("https://site.example.org/?ya_access=stok");
});

it("offers Open and Copy link on right-click", async () => {
  const table = renderSettings();
  const open = vi.spyOn(window, "open").mockReturnValue(null);
  const app = table.getByRole("link", { name: /Open app in a new tab/ });
  fireEvent.contextMenu(app);
  fireEvent.click(screen.getByRole("menuitem", { name: /Copy link/ }));
  await waitFor(() =>
    expect(mock.copy).toHaveBeenCalledWith(
      "https://app.example.org/?ya_access=tok",
    ),
  );
  expect(await screen.findByText("Copied!")).toBeTruthy();
  fireEvent.contextMenu(app);
  fireEvent.click(screen.getByRole("menuitem", { name: "Open" }));
  expect(open).toHaveBeenCalledWith(
    "https://app.example.org/?ya_access=tok",
    "_blank",
    "noopener,noreferrer",
  );
  open.mockRestore();
});

it("links a file row's path to the file viewer", async () => {
  const table = renderSettings();
  fireEvent.click(table.getByRole("button", { name: /site/ }));
  const viewer = await screen.findByRole("link", {
    name: /Open in the file viewer/,
  });
  const href = new URL(viewer.getAttribute("href")!);
  expect(href.pathname).toBe("/file-view");
  expect(href.searchParams.get("path")).toBe("/p/site/index.html");
  expect(href.searchParams.get("mode")).toBe("interactive");
});

it("offers no link for an unsaved row", () => {
  const table = renderSettings();
  fireEvent.click(screen.getByRole("button", { name: "Add vhost" }));
  expect(table.getAllByRole("link")).toHaveLength(2);
});
