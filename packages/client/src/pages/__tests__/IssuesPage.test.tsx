import type {
  IssueEvidence,
  IssueEvidenceResult,
  IssueSearchResult,
  IssueSession,
  IssueSessionsResult,
} from "@yep-anywhere/shared";
import { DEFAULT_ISSUE_SETTINGS } from "@yep-anywhere/shared";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { IssuesPage } from "../IssuesPage";

const state = vi.hoisted(() => ({ fetch: vi.fn() }));
const runtime = { sourceKey: "localhost", transport: { fetch: state.fetch } };
vi.mock("../../contexts/SourceRuntimeContext", () => ({
  useCurrentSourceRuntime: () => runtime,
}));
vi.mock("../../hooks/useIssuesEnabled", () => ({
  useIssuesEnabled: () => true,
}));
vi.mock("../../hooks/useRemoteBasePath", () => ({
  useRemoteBasePath: () => "",
}));
vi.mock("../../layouts", () => ({
  MainContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  useNavigationLayout: () => ({
    openSidebar: () => {},
    isWideScreen: true,
  }),
}));

function evidence(index: number): IssueEvidence {
  return {
    id: index,
    sessionId: "s1",
    projectId: "p1",
    messageId: `m${index}`,
    excerpt: `mention ${index}`,
    value: `AUTOTEST-1 mention ${index}`,
    kind: "text",
    observedAt: index,
    sourceTime: null,
    state: "discovered",
  };
}

const session: IssueSession = {
  sessionId: "s1",
  projectId: "p1",
  title: "Session one",
  state: "discovered",
  evidenceCount: 2,
  // The source is deliberately unavailable so the row renders its plain
  // identity line instead of a full session card.
  sourceAvailable: false,
  evidence: [evidence(1)],
};

function item(index: number) {
  return {
    id: `i${index}`,
    key: `AUTOTEST-${index}`,
    title: `Title ${index}`,
    url: null,
    provider: "jira",
    kind: "issue",
    sessionCount: 1,
    unresolved: false,
  };
}

const search: IssueSearchResult = {
  items: [item(1), item(2)],
  coverage: {
    settings: DEFAULT_ISSUE_SETTINGS,
    active: false,
    error: null,
    counts: [],
  },
  nextOffset: null,
};

const sessions: IssueSessionsResult = { sessions: [session], nextOffset: null };
const evidencePage: IssueEvidenceResult = {
  evidence: [evidence(2)],
  nextOffset: null,
};

function renderPage() {
  return render(
    <I18nProvider>
      <MemoryRouter>
        <IssuesPage />
      </MemoryRouter>
    </I18nProvider>,
  );
}

async function selectIssue(index: number) {
  fireEvent.click(
    await screen.findByRole("button", {
      name: new RegExp(`^AUTOTEST-${index}`),
    }),
  );
}

async function expandFirstIssueSession() {
  await selectIssue(1);
  fireEvent.click(
    await screen.findByRole("button", { name: /more mentions/i }),
  );
  expect(await screen.findByText("mention 2")).toBeTruthy();
}

function searchReads() {
  return state.fetch.mock.calls.filter(([path]) =>
    (path as string).startsWith("/issues?"),
  ).length;
}

/**
 * Click a control that changes the issue search, and wait for the search read
 * the page debounces after it. Without the wait a test can finish first, and
 * the late answer re-renders the page outside act().
 */
async function clickAndAwaitSearch(control: HTMLElement) {
  const before = searchReads();
  fireEvent.click(control);
  await waitFor(() => expect(searchReads()).toBeGreaterThan(before));
}

const refreshButton = () => screen.getByRole("button", { name: "Refresh" });

describe("IssuesPage associated sessions", () => {
  beforeEach(() => {
    state.fetch.mockReset();
    state.fetch.mockImplementation((path: string) => {
      if (path.startsWith("/issues/sessions")) return Promise.resolve(sessions);
      if (path.startsWith("/issues/evidence"))
        return Promise.resolve(evidencePage);
      return Promise.resolve(search);
    });
  });
  afterEach(cleanup);

  it("keeps an expanded row's loaded mentions across a refresh", async () => {
    renderPage();
    await expandFirstIssueSession();

    await clickAndAwaitSearch(refreshButton());
    expect(
      await screen.findByRole("button", { name: /fewer mentions/i }),
    ).toBeTruthy();
    expect(screen.getByText("mention 2")).toBeTruthy();
  });

  it("shows a refreshed first mention below the ones already loaded", async () => {
    renderPage();
    await expandFirstIssueSession();

    const renamed = { ...evidence(1), excerpt: "mention 1 (edited)" };
    state.fetch.mockImplementation((path: string) => {
      if (path.startsWith("/issues/sessions"))
        return Promise.resolve({
          sessions: [{ ...session, evidence: [renamed] }],
          nextOffset: null,
        });
      if (path.startsWith("/issues/evidence"))
        return Promise.resolve(evidencePage);
      return Promise.resolve(search);
    });
    await clickAndAwaitSearch(refreshButton());

    expect(await screen.findByText("mention 1 (edited)")).toBeTruthy();
    expect(screen.getByText("mention 2")).toBeTruthy();
  });

  it("reloads an expanded row's mentions under the new dismissed filter", async () => {
    const suppressed = {
      ...evidence(2),
      excerpt: "dismissed mention",
      state: "dismissed" as const,
    };
    state.fetch.mockImplementation((path: string) => {
      const includeDismissed = path.includes("dismissed=1");
      if (path.startsWith("/issues/sessions"))
        return Promise.resolve({
          sessions: [{ ...session, evidenceCount: includeDismissed ? 3 : 2 }],
          nextOffset: null,
        });
      if (path.startsWith("/issues/evidence"))
        return Promise.resolve(
          includeDismissed
            ? { evidence: [suppressed, evidence(3)], nextOffset: null }
            : { evidence: [evidence(3)], nextOffset: null },
        );
      return Promise.resolve(search);
    });
    renderPage();
    const filter = screen.getByRole("checkbox", {
      name: "Include dismissed associations",
    });
    fireEvent.click(filter);
    await selectIssue(1);
    fireEvent.click(
      await screen.findByRole("button", { name: /more mentions/i }),
    );
    expect(await screen.findByText("dismissed mention")).toBeTruthy();

    state.fetch.mockClear();
    await clickAndAwaitSearch(filter);

    expect(await screen.findByText("mention 3")).toBeTruthy();
    await waitFor(() =>
      expect(screen.queryByText("dismissed mention")).toBeNull(),
    );
    const reloads = state.fetch.mock.calls
      .map(([path]) => path as string)
      .filter((path) => path.startsWith("/issues/evidence"));
    expect(reloads).toHaveLength(1);
    expect(reloads[0]).toContain("dismissed=0");
    expect(reloads[0]).toContain("offset=1");
  });

  it("shows a refreshed row's loaded range in the server's current order", async () => {
    renderPage();
    await expandFirstIssueSession();

    // After the refresh the server orders the later mentions 3, 4, 5.
    const later = [evidence(3), evidence(4), evidence(5)];
    let answerMore: (result: IssueEvidenceResult) => void = () => {};
    state.fetch.mockImplementation((path: string) => {
      if (path.startsWith("/issues/sessions"))
        return Promise.resolve({
          sessions: [{ ...session, evidenceCount: 4 }],
          nextOffset: null,
        });
      if (path.startsWith("/issues/evidence")) {
        const query = new URLSearchParams(path.split("?")[1]);
        const offset = Number(query.get("offset"));
        const limit = query.get("limit");
        if (!limit)
          return new Promise<IssueEvidenceResult>((resolve) => {
            answerMore = resolve;
          });
        const page = later.slice(offset - 1, offset - 1 + Number(limit));
        return Promise.resolve({
          evidence: page,
          nextOffset:
            page.length === Number(limit) ? offset + page.length : null,
        });
      }
      return Promise.resolve(search);
    });
    const reloads = () =>
      state.fetch.mock.calls.filter(([path]) =>
        (path as string).includes("limit="),
      ).length;
    await clickAndAwaitSearch(refreshButton());
    expect(await screen.findByText("mention 3")).toBeTruthy();
    expect(screen.queryByText("mention 2")).toBeNull();

    // A page requested before a refresh cannot land in the reloaded list.
    fireEvent.click(screen.getByRole("button", { name: /more evidence/i }));
    await clickAndAwaitSearch(refreshButton());
    await waitFor(() => expect(reloads()).toBe(2));
    answerMore({ evidence: [evidence(2)], nextOffset: null });
    await screen.findByRole("button", { name: /more evidence/i });
    expect(screen.queryByText("mention 2")).toBeNull();
    expect(screen.getAllByText("mention 3")).toHaveLength(1);
  });

  it("still loads an expanded row's mentions when a refresh overtakes its first page", async () => {
    let answerFirstPage: (result: IssueEvidenceResult) => void = () => {};
    state.fetch.mockImplementation((path: string) => {
      if (path.startsWith("/issues/sessions"))
        return Promise.resolve({
          sessions: [{ ...session }],
          nextOffset: null,
        });
      if (path.startsWith("/issues/evidence") && !path.includes("limit="))
        return new Promise<IssueEvidenceResult>((resolve) => {
          answerFirstPage = resolve;
        });
      if (path.startsWith("/issues/evidence"))
        return Promise.resolve(evidencePage);
      return Promise.resolve(search);
    });
    renderPage();
    await selectIssue(1);
    fireEvent.click(
      await screen.findByRole("button", { name: /more mentions/i }),
    );
    await clickAndAwaitSearch(refreshButton());

    expect(await screen.findByText("mention 2")).toBeTruthy();
    answerFirstPage({ evidence: [evidence(9)], nextOffset: null });
    await screen.findByRole("button", { name: /fewer mentions/i });
    expect(screen.queryByText("mention 9")).toBeNull();
  });

  it("empties the pane when another issue is picked", async () => {
    renderPage();
    await expandFirstIssueSession();

    let answerSessions: (result: IssueSessionsResult) => void = () => {};
    state.fetch.mockImplementation((path: string) => {
      if (path.startsWith("/issues/sessions"))
        return new Promise<IssueSessionsResult>((resolve) => {
          answerSessions = resolve;
        });
      return Promise.resolve(search);
    });
    await selectIssue(2);

    expect(await screen.findByText("Loading sessions…")).toBeTruthy();
    expect(screen.queryByText("mention 2")).toBeNull();
    await act(async () => answerSessions({ sessions: [], nextOffset: null }));
  });
});
