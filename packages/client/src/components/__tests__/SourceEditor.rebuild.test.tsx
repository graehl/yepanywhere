import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { SourceEditor } from "../SourceEditor";

const state = vi.hoisted(() => ({
  fetch: vi.fn(),
  version: {} as Record<string, unknown>,
  registered: false,
}));
const runtime = { sourceKey: "localhost", transport: { fetch: state.fetch } };
vi.mock("../../contexts/SourceRuntimeContext", () => ({
  useCurrentSourceRuntime: () => runtime,
}));
vi.mock("../../hooks/useVersion", () => ({
  useRetainedVersionInfo: () => state.version,
  useVersion: () => ({ version: state.version }),
}));
vi.mock("../../contexts/PublicShareContext", () => ({
  usePublicShareContext: () => null,
}));

const PATH = "/proj/_build/paper.html";
const proposal = {
  cwd: "/proj",
  argv: ["/usr/bin/python3", "/proj/scripts/build.py"],
  outputs: [PATH],
  timeoutSeconds: 180,
};
function html(marker: string) {
  return `<!doctype html><html><body>
<!-- ya-source-target:v1 {"id":"intro","source":"sections/intro.qmd","sourceRange":[[0,0],[3,0]]} -->
<p>${marker}</p>
<!-- /ya-source-target:v1 intro -->
</body></html>`;
}
function status() {
  return {
    hook: "paper",
    registrationVersion: 1,
    proposedRegistration: proposal,
    registered: state.registered,
    matches: state.registered,
  };
}

beforeEach(() => {
  state.version = { current: "0.8.2", capabilities: [] };
  state.registered = false;
  localStorage.clear();
  state.fetch.mockReset();
  state.fetch.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path.startsWith("/file-edit?"))
      return {
        path: PATH,
        content: html("Before"),
        revision: "r1",
        editable: true,
        regenerate: status(),
      };
    if (path === "/file-edit" && init?.method === "PUT")
      return { path: PATH, revision: "r2" };
    if (path === "/file-edit/rebuild") {
      const body = JSON.parse(String(init?.body));
      if (body.register) state.registered = true;
      if (!state.registered) throw new Error("not approved");
      return {
        ok: true,
        exitCode: 0,
        timedOut: false,
        durationMs: 5,
        log: "quarto render ok",
        preview: { path: PATH, content: html("After"), revision: "r3" },
        regenerate: status(),
      };
    }
    throw new Error(`unexpected ${path}`);
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mount() {
  return render(
    <I18nProvider>
      <SourceEditor
        source={{ path: "_build/paper.html", projectId: "p1" }}
        artifact
        onClose={() => {}}
      />
    </I18nProvider>,
  );
}

function rebuildBody(index: number) {
  const call = state.fetch.mock.calls.filter(
    ([path]) => path === "/file-edit/rebuild",
  )[index];
  return JSON.parse(String(call?.[1]?.body));
}

it("asks for approval, sends it with the run, and swaps in the rebuilt preview", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  mount();
  const approve = await screen.findByRole("button", {
    name: "Approve and rebuild…",
  });
  expect(
    (screen.getByTitle("Preview") as HTMLIFrameElement).getAttribute("srcdoc"),
  ).toContain("Before");
  fireEvent.click(approve);
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(confirm.mock.calls[0]?.[0]).toContain(
    "/usr/bin/python3 /proj/scripts/build.py",
  );
  await screen.findByText(/Rebuilt\./);
  expect(rebuildBody(0)).toEqual({
    path: PATH,
    hook: "paper",
    register: true,
    approved: { registrationVersion: 1, ...proposal },
  });
  expect(
    (screen.getByTitle("Preview") as HTMLIFrameElement).getAttribute("srcdoc"),
  ).toContain("After");
  expect(screen.getByRole("button", { name: "Rebuild" })).toBeTruthy();
  expect(screen.getByText("Build output")).toBeTruthy();
});

it("declines to run when approval is refused", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(false);
  mount();
  fireEvent.click(
    await screen.findByRole("button", { name: "Approve and rebuild…" }),
  );
  await waitFor(() => expect(state.fetch).toHaveBeenCalledTimes(1));
  expect(screen.queryByText(/Rebuilt\./)).toBeNull();
});

it("shows the changed command for approval after the server refuses a stale one", async () => {
  const changed = { ...proposal, argv: ["/usr/bin/python3", "/proj/other.py"] };
  let reads = 0;
  state.fetch.mockImplementation(async (path: string) => {
    if (path.startsWith("/file-edit?")) {
      reads += 1;
      return {
        path: PATH,
        content: html("Before"),
        revision: "r1",
        editable: true,
        regenerate: {
          ...status(),
          proposedRegistration: reads === 1 ? proposal : changed,
        },
      };
    }
    if (path === "/file-edit/rebuild")
      throw Object.assign(
        new Error("API error: 409: not the one you approved"),
        {
          status: 409,
        },
      );
    throw new Error(`unexpected ${path}`);
  });
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  mount();
  fireEvent.click(
    await screen.findByRole("button", { name: "Approve and rebuild…" }),
  );
  await screen.findByText(/not the one you approved/);
  await waitFor(() => expect(reads).toBe(2));
  fireEvent.click(screen.getByRole("button", { name: "Approve and rebuild…" }));
  await waitFor(() => expect(confirm).toHaveBeenCalledTimes(2));
  expect(confirm.mock.calls[1]?.[0]).toContain("/proj/other.py");
  expect(rebuildBody(1).approved.argv).toEqual(changed.argv);
  expect(
    (screen.getByTitle("Preview") as HTMLIFrameElement).getAttribute("srcdoc"),
  ).toContain("Before");
});

it("rebuilds automatically after a save only when opted in and approved", async () => {
  state.registered = true;
  mount();
  const auto = await screen.findByRole("checkbox", {
    name: "Rebuild automatically after save",
  });
  fireEvent.click(auto);
  fireEvent.change(screen.getByRole("textbox", { name: "Source" }), {
    target: { value: "edited" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByText(/Rebuilt\./);
  expect(rebuildBody(0)).toEqual({
    path: PATH,
    hook: "paper",
    register: false,
  });
  expect(localStorage.getItem(`ya:source-editor:auto-rebuild:${PATH}`)).toBe(
    "1",
  );
});
