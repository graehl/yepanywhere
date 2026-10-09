import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import type { ArtifactViewerStatus } from "@yep-anywhere/shared";
import { afterEach, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../i18n";
import { ArtifactSettings } from "../ArtifactSettings";

const mock = vi.hoisted(() => ({
  status: undefined as ArtifactViewerStatus | undefined,
  fetch: vi.fn(),
}));
vi.mock("../../../hooks/useVersion", () => ({
  useRetainedVersionInfo: () => ({ artifactViewer: mock.status }),
  useVersion: () => ({
    version: { artifactViewer: mock.status },
    refetch: async () => {},
  }),
}));
vi.mock("../../../contexts/SourceRuntimeContext", () => ({
  useCurrentSourceRuntime: () => ({
    sourceKey: "test",
    transport: { fetch: mock.fetch },
  }),
}));
vi.mock("../../../hooks/useVhostAccess", () => ({
  useVhostAccess: () => ({ supported: false, refresh: () => {} }),
}));
vi.mock("../ProjectAppInventorySection", () => ({
  ProjectAppInventorySection: () => null,
}));
afterEach(() => {
  cleanup();
  mock.fetch.mockReset();
});

const baseStatus: ArtifactViewerStatus = {
  available: true,
  locked: false,
  port: 4402,
  defaultLocalOrigin: "http://artifacts.localhost:3400",
  vhosts: [],
};

it("shows how many files a saved file row reaches, naming them in its tooltip", async () => {
  mock.status = {
    ...baseStatus,
    vhostSites: [{ name: "report", path: "/p/sr/report.html", public: true }],
  };
  const paths = Array.from({ length: 25 }, (_, i) => `figs/f${i}.png`);
  mock.fetch.mockResolvedValue({
    sites: [
      {
        name: "report",
        path: "/p/sr/report.html",
        kind: "file",
        linkedFiles: { count: 30, paths, truncated: false },
      },
    ],
  });
  render(
    <I18nProvider>
      <ArtifactSettings />
    </I18nProvider>,
  );
  const count = await screen.findByText("30 files");
  const tooltip = count.getAttribute("title")!.split("\n");
  expect(tooltip).toHaveLength(21);
  expect(tooltip[0]).toBe("figs/f0.png");
  expect(tooltip[20]).toBe("…and 10 more");
  expect(mock.fetch).toHaveBeenCalledWith("/artifacts/vhost-sites");
});

it("asks nothing of a server without file rows", () => {
  mock.status = baseStatus;
  render(
    <I18nProvider>
      <ArtifactSettings />
    </I18nProvider>,
  );
  expect(mock.fetch).not.toHaveBeenCalled();
});

it("sorts full served paths in both directions without changing saved order", async () => {
  mock.status = {
    ...baseStatus,
    vhostSites: [
      { name: "first", path: "/p/z/report.html", public: true },
      { name: "second", path: "/p/a/index.html", public: true },
    ],
  };
  mock.fetch.mockResolvedValue({ sites: [] });
  render(
    <I18nProvider>
      <ArtifactSettings />
    </I18nProvider>,
  );
  const table = within(screen.getByRole("table", { name: "HTTP vhosts" }));
  const rows = () =>
    table
      .getAllByRole("row")
      .slice(1)
      .map((row) => row.textContent);
  fireEvent.click(table.getByRole("button", { name: "Serves" }));
  expect(rows()[0]).toContain("second");
  expect(
    table
      .getByRole("columnheader", { name: "Serves" })
      .getAttribute("aria-sort"),
  ).toBe("ascending");
  fireEvent.click(table.getByRole("button", { name: "Serves" }));
  expect(rows()[0]).toContain("first");
  expect(mock.status.vhostSites?.map((row) => row.name)).toEqual([
    "first",
    "second",
  ]);
  expect(mock.fetch).not.toHaveBeenCalledWith(
    "/artifacts/config",
    expect.anything(),
  );
  fireEvent.click(table.getByRole("button", { name: "Domain" }));
  expect(rows()[0]).toContain("first");
});
