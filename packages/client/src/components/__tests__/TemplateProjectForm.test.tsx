// @vitest-environment jsdom
import "fake-indexeddb/auto";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { ToastProvider } from "../../contexts/ToastContext";
import { TemplateProjectForm } from "../TemplateProjectForm";
import type { TemplateCreationRequest } from "../../api/projectTemplatesClient";

vi.mock("../../hooks/useActingPrincipal", () => ({
  useActingPrincipal: () => ({ principal: { username: null }, resolved: true }),
}));

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

const templates = [
  { id: "app", sourceId: "local", title: "App canvas", description: "Starter" },
];
const onStarted = vi.fn();
function form() {
  return render(
    <I18nProvider>
      <ToastProvider>
        <TemplateProjectForm
          templates={templates}
          projects={[]}
          pathBase="/projects"
          onStarted={onStarted}
        />
      </ToastProvider>
    </I18nProvider>,
  );
}

it("keeps a single template as a radio and retries a lost response with the same request after remount", async () => {
  const requests: TemplateCreationRequest[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const request = JSON.parse(String(init.body)) as TemplateCreationRequest;
      requests.push(request);
      if (requests.length === 1) throw new Error("Connection lost");
      return Response.json({
        request,
        phase: "started",
        log: "",
        projectId: "project",
        sessionId: "session",
      });
    }),
  );
  const rendered = form();
  expect(screen.getAllByRole("radio")).toHaveLength(1);
  expect(screen.queryByRole("combobox")).toBeNull();
  fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
    target: { value: "Garden" },
  });
  fireEvent.change(
    screen.getByRole("textbox", { name: "What would you like to make?" }),
    { target: { value: "Sketch plants" } },
  );
  fireEvent.click(screen.getByRole("button", { name: "Create & prepare" }));
  await screen.findByText("Connection lost");
  rendered.unmount();
  form();
  await waitFor(() =>
    expect(onStarted).toHaveBeenCalledWith("project", "session"),
  );
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
  expect(requests[0]).toMatchObject({
    path: "/projects/garden",
    name: "Garden",
    intent: "Sketch plants",
    templateId: "app",
    sourceId: "local",
  });
});

it("unlocks details after the server rejects a request before allocation", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({ error: "Source changed" }, { status: 409 }),
    ),
  );
  form();
  const name = screen.getByRole("textbox", { name: "Name" });
  fireEvent.change(name, { target: { value: "Garden" } });
  fireEvent.change(
    screen.getByRole("textbox", { name: "What would you like to make?" }),
    { target: { value: "Sketch plants" } },
  );
  fireEvent.click(screen.getByRole("button", { name: "Create & prepare" }));
  await screen.findByText("Source changed");
  expect((name as HTMLInputElement).disabled).toBe(false);
});

it("shows progress immediately before the creation request returns", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise<Response>(() => {})),
  );
  form();
  fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
    target: { value: "Garden" },
  });
  fireEvent.change(
    screen.getByRole("textbox", { name: "What would you like to make?" }),
    { target: { value: "Sketch plants" } },
  );
  fireEvent.click(screen.getByRole("button", { name: "Create & prepare" }));
  expect(screen.getByText("Submitting project creation…")).toBeTruthy();
  expect(screen.getByText("Waiting for setup output…")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Hide setup log" })).toBeTruthy();
});

it("creates the template, name and path an enclosing form chose", async () => {
  const requests: TemplateCreationRequest[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const request = JSON.parse(String(init.body)) as TemplateCreationRequest;
      requests.push(request);
      return Response.json({ request, phase: "setup", log: "" });
    }),
  );
  render(
    <I18nProvider>
      <ToastProvider>
        <TemplateProjectForm
          templates={templates}
          projects={[]}
          pathBase="/projects"
          intent="Sketch plants"
          chosen={{ template: templates[0]!, name: "math", path: "~/math" }}
          onStarted={onStarted}
        />
      </ToastProvider>
    </I18nProvider>,
  );
  // The enclosing form owns the palette and the name.
  expect(screen.queryByRole("radio")).toBeNull();
  expect(screen.queryByRole("textbox", { name: "Name" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Create & prepare" }));
  await waitFor(() => expect(requests).toHaveLength(1));
  expect(requests[0]).toMatchObject({
    sourceId: "local",
    templateId: "app",
    name: "math",
    path: "~/math",
    intent: "Sketch plants",
  });
});
