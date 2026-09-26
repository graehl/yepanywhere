import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { ArtifactPreview } from "../ArtifactPreview";

const state = vi.hoisted(() => ({
  fetch: vi.fn(),
  version: {} as Record<string, unknown>,
  share: null as object | null,
  shareStatus: null as { canCreate: boolean } | null,
  getPublicFileShares: vi.fn(),
  createPublicFileShare: vi.fn(),
}));
const runtime = { sourceKey: "localhost", transport: { fetch: state.fetch } };
vi.mock("../../contexts/SourceRuntimeContext", () => ({
  useCurrentSourceRuntime: () => runtime,
}));
vi.mock("../../hooks/useVersion", () => ({
  useRetainedVersionInfo: () => state.version,
}));
vi.mock("../../contexts/PublicShareContext", () => ({
  usePublicShareContext: () => state.share,
}));
vi.mock("../../hooks/usePublicShareStatus", () => ({
  usePublicShareStatus: () => ({ status: state.shareStatus }),
}));
vi.mock("../../api/client", () => ({
  api: {
    getPublicFileShares: state.getPublicFileShares,
    createPublicFileShare: state.createPublicFileShare,
  },
}));

const PROJECT_ID = "cHJvamVjdA";
const SHARE_URL = `https://ya.example/remote/share/secret123/file?h=relayuser&projectId=${PROJECT_ID}&path=mockup%2Findex.html&standalone=1#v=2&target=file`;

beforeEach(() => {
  state.version = {
    current: "0.8.2",
    capabilities: ["artifact-viewer"],
    artifactViewer: {
      port: 4402,
      available: true,
      locked: false,
      localOrigin: "http://artifacts.localhost:3400",
      publicOrigin: "https://artifacts.example.org",
    },
  };
  state.share = null;
  state.shareStatus = { canCreate: true };
  state.fetch.mockReset();
  state.getPublicFileShares.mockReset();
  state.createPublicFileShare.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mount(projectId?: string) {
  return render(
    <I18nProvider>
      <ArtifactPreview
        html="<p>Static</p>"
        path={projectId ? "mockup/index.html" : "/mockup/index.html"}
        projectId={projectId}
        title="Mockup"
      />
    </I18nProvider>,
  );
}

async function runAndOpenMenu(projectId?: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ artifactViewer: 1 }),
    }),
  );
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
  const origin =
    window.location.hostname === "localhost"
      ? "http://artifacts.localhost:3400"
      : "https://artifacts.example.org";
  state.fetch.mockResolvedValue({
    id: "grant",
    url: `${origin}/a/token/index.html`,
    expiresAt: Date.now() + 1000,
  });
  mount(projectId);
  fireEvent.click(
    screen.getByRole("button", {
      name: "Run full HTML/CSS/JavaScript preview (current view is sanitized)",
    }),
  );
  const stop = await screen.findByRole("button", {
    name: "Stop interactive preview",
  });
  fireEvent.contextMenu(stop, { clientX: 20, clientY: 20 });
  return stop;
}

it("does not contact an artifact origin or request grants from an old server", () => {
  state.version = { current: "0.8.1" };
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  mount();
  expect(screen.queryByRole("button")).toBeNull();
  expect(screen.getByTitle("Mockup").getAttribute("sandbox")).toBe(
    "allow-same-origin",
  );
  expect(fetch).not.toHaveBeenCalled();
  expect(state.fetch).not.toHaveBeenCalled();
});

it("keeps a static preview when resolution fails and retries only on request", async () => {
  const fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
  vi.stubGlobal("fetch", fetch);
  mount();
  fireEvent.click(
    screen.getByRole("button", {
      name: "Run full HTML/CSS/JavaScript preview (current view is sanitized)",
    }),
  );
  await screen.findByRole("status");
  expect(state.fetch).not.toHaveBeenCalled();
  expect(screen.getByTitle("Mockup").getAttribute("sandbox")).toBe(
    "allow-same-origin",
  );
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledWith(
    expect.stringContaining("/health"),
    expect.objectContaining({
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
    }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Retry interactive preview" }),
  );
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
});

it("admits only after a successful probe and keeps the grant reusable", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ artifactViewer: 1 }),
    }),
  );
  const origin =
    window.location.hostname === "localhost"
      ? "http://artifacts.localhost:3400"
      : "https://artifacts.example.org";
  state.fetch.mockResolvedValue({
    id: "grant",
    url: `${origin}/a/token/index.html`,
    expiresAt: Date.now() + 1000,
  });
  const { unmount } = mount();
  fireEvent.click(
    screen.getByRole("button", {
      name: "Run full HTML/CSS/JavaScript preview (current view is sanitized)",
    }),
  );
  await screen.findByRole("button", { name: "Stop interactive preview" });
  expect(screen.getByTitle("Mockup").getAttribute("sandbox")).toBe(
    "allow-scripts allow-same-origin",
  );
  expect(screen.getByTitle("Mockup").getAttribute("src")).toBe(
    `${origin}/a/token/index.html`,
  );
  unmount();
  expect(state.fetch).toHaveBeenCalledTimes(1);
});

it("opens only its own frame's same-grant tab requests, without an opener", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ artifactViewer: 1 }),
    }),
  );
  const open = vi.fn();
  vi.stubGlobal("open", open);
  const origin =
    window.location.hostname === "localhost"
      ? "http://artifacts.localhost:3400"
      : "https://artifacts.example.org";
  state.fetch.mockResolvedValue({
    id: "grant",
    url: `${origin}/a/token/index.html`,
    expiresAt: Date.now() + 1000,
  });
  mount();
  fireEvent.click(
    screen.getByRole("button", {
      name: "Run full HTML/CSS/JavaScript preview (current view is sanitized)",
    }),
  );
  await screen.findByRole("button", { name: "Stop interactive preview" });
  const frame = screen.getByTitle("Mockup") as HTMLIFrameElement;
  const request = (url: string, source: Window | null) =>
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { protocol: "yep-artifact-tab/1", type: "open", url },
        source,
      }),
    );
  request(`${origin}/a/other/paper.pdf`, frame.contentWindow);
  request(`${origin}/a/token/paper.pdf?next=1`, frame.contentWindow);
  request(`${origin}/a/token/paper.pdf`, window);
  expect(open).not.toHaveBeenCalled();
  request(`${origin}/a/token/paper.pdf?download=true`, frame.contentWindow);
  expect(open).toHaveBeenCalledWith(
    `${origin}/a/token/paper.pdf?download=true`,
    "_blank",
    "noopener,noreferrer",
  );
});

it("copies the file's public share as a play link, never a public artifact grant", async () => {
  state.getPublicFileShares.mockResolvedValue({ items: [] });
  state.createPublicFileShare.mockResolvedValue({ url: SHARE_URL });
  const stop = await runAndOpenMenu(PROJECT_ID);
  fireEvent.click(screen.getByRole("menuitem", { name: "Copy public URL" }));
  await waitFor(() =>
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      `https://ya.example/remote/play.html?h=relayuser&projectId=${PROJECT_ID}&path=mockup%2Findex.html#share=secret123`,
    ),
  );
  expect(state.createPublicFileShare).toHaveBeenCalledWith({
    projectId: PROJECT_ID,
    path: "mockup/index.html",
  });
  // The only artifact grant is the local one that runs the preview.
  expect(state.fetch).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("menu")).toBeNull();
  fireEvent.contextMenu(stop, { clientX: 20, clientY: 20 });
  fireEvent.click(
    screen.getByRole("menuitem", { name: "Stop interactive preview" }),
  );
  await screen.findByRole("button", {
    name: "Run full HTML/CSS/JavaScript preview (current view is sanitized)",
  });
  expect(screen.getByTitle("Mockup").getAttribute("sandbox")).toBe(
    "allow-same-origin",
  );
});

it("reuses the file's existing public share for Copy public URL", async () => {
  state.getPublicFileShares.mockResolvedValue({
    items: [{ shareId: "s1", url: SHARE_URL }],
  });
  await runAndOpenMenu(PROJECT_ID);
  fireEvent.click(screen.getByRole("menuitem", { name: "Copy public URL" }));
  await waitFor(() =>
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining("/remote/play.html?"),
    ),
  );
  expect(state.getPublicFileShares).toHaveBeenCalledWith(
    PROJECT_ID,
    "mockup/index.html",
  );
  expect(state.createPublicFileShare).not.toHaveBeenCalled();
});

it("offers no Copy public URL without a project file or share creation", async () => {
  await runAndOpenMenu();
  expect(screen.getByRole("menuitem", { name: "Stop interactive preview" }));
  expect(
    screen.queryByRole("menuitem", { name: "Copy public URL" }),
  ).toBeNull();
  cleanup();
  state.shareStatus = { canCreate: false };
  await runAndOpenMenu(PROJECT_ID);
  expect(
    screen.queryByRole("menuitem", { name: "Copy public URL" }),
  ).toBeNull();
});

it("never offers private grants in a public share", () => {
  state.share = {};
  mount();
  expect(screen.queryByRole("button")).toBeNull();
  expect(state.fetch).not.toHaveBeenCalled();
});
