// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentsPage } from "../AgentsPage";

const { abortProcess, processesState, refetch } = vi.hoisted(() => ({
  abortProcess: vi.fn(),
  refetch: vi.fn(async () => undefined),
  processesState: {
    processes: [
      {
        id: "process-1",
        sessionId: "session-1",
        projectId: "project-1",
        projectPath: "/tmp/project",
        projectName: "project",
        state: "idle" as const,
        startedAt: "2026-07-19T12:00:00.000Z",
        queueDepth: 0,
        sessionTitle: "Codex session",
        provider: "codex" as const,
        pid: 43210,
        providerChildren: [
          {
            id: "child-native-1",
            parentSessionId: "session-1",
            title: "Review the restart guard",
            agentType: "reviewer",
            updatedAt: "2026-07-19T12:01:00.000Z",
          },
        ],
      },
    ],
    terminatedProcesses: [],
    loading: false,
    error: null as Error | null,
  },
}));

vi.mock("../../api/client", () => ({
  api: { abortProcess },
}));

vi.mock("../../components/PageHeader", () => ({
  PageHeader: ({ title }: { title: string }) => <header>{title}</header>,
}));

vi.mock("../../components/ThinkingIndicator", () => ({
  ThinkingIndicator: () => <span>thinking</span>,
}));

vi.mock("../../hooks/useProcesses", () => ({
  useProcesses: () => ({ ...processesState, refetch }),
}));

vi.mock("../../hooks/useRemoteBasePath", () => ({
  useRemoteBasePath: () => "",
}));

vi.mock("../../i18n", () => ({
  useI18n: () => ({
    t: (key: string, values?: Record<string, string | number>) => {
      const templates: Record<string, string> = {
        agentsTitle: "Agents",
        agentsSectionActive: "Active",
        agentsSectionIdle: "Idle",
        agentsSectionStopped: "Stopped",
        agentsEmptyActive: "No active agents",
        agentsEmptyStopped: "No stopped agents",
        agentsIdle: "Idle",
        agentsPid: "PID {pid}",
        agentsKill: "Kill",
        agentsKilling: "Killing…",
        agentsKillTitle: "Force-stop this agent process",
        agentsKillConfirm: "Kill {title}?",
        agentsKillVerifiedPid:
          "Stopped PID {pid} and verified it is no longer running.",
        agentsKillResumeBlocked: "Auto-resume disabled for the killed session.",
        agentsKillResumeBlockFailed:
          "The process stopped, but auto-resume could not be disabled: {message}",
        agentsKillResumeBlockUnknown: "Unknown exemption error",
        agentsKillFailed: "Could not stop the agent: {message}",
        providerChildrenCountOne: "{count} provider subagent",
        providerChildrenCountMany: "{count} provider subagents",
        providerChildFallback: "Provider subagent",
      };
      return Object.entries(values ?? {}).reduce(
        (text, [name, value]) => text.replace(`{${name}}`, String(value)),
        templates[key] ?? key,
      );
    },
  }),
}));

vi.mock("../../layouts", () => ({
  MainContent: ({ children }: { children: ReactNode }) => (
    <main>{children}</main>
  ),
  useNavigationLayout: () => ({
    openSidebar: vi.fn(),
    isWideScreen: true,
  }),
}));

describe("AgentsPage process kill", () => {
  beforeEach(() => {
    abortProcess.mockReset();
    refetch.mockClear();
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("nests provider-launched child work under its parent process", () => {
    render(
      <MemoryRouter>
        <AgentsPage />
      </MemoryRouter>,
    );

    expect(screen.getByText("Review the restart guard")).toBeTruthy();
    expect(screen.getByText("reviewer")).toBeTruthy();
    expect(
      screen.getByRole("list", { name: "1 provider subagent" }),
    ).toBeTruthy();
  });

  it("reports the PID after shutdown is verified", async () => {
    abortProcess.mockResolvedValue({
      aborted: true,
      processId: "process-1",
      sessionId: "session-1",
      pid: 43210,
      verifiedStopped: true,
      verification: "pid",
    });
    render(
      <MemoryRouter>
        <AgentsPage />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Kill" }));

    await waitFor(() => {
      expect(abortProcess).toHaveBeenCalledWith("process-1", {
        blockResume: true,
      });
    });
    expect((await screen.findByRole("status")).textContent).toContain(
      "Stopped PID 43210 and verified it is no longer running.",
    );
    expect(refetch).toHaveBeenCalledOnce();
  });

  it("notes the resume exemption when the server reports one", async () => {
    abortProcess.mockResolvedValue({
      aborted: true,
      processId: "process-1",
      sessionId: "session-1",
      pid: 43210,
      verifiedStopped: true,
      verification: "pid",
      resumeExemption: {
        heartbeatDisabled: true,
        autoResumeDisabled: true,
      },
    });
    render(
      <MemoryRouter>
        <AgentsPage />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Kill" }));

    expect((await screen.findByRole("status")).textContent).toContain(
      "Auto-resume disabled for the killed session.",
    );
  });

  it("reports a resume exemption failure after verified shutdown", async () => {
    abortProcess.mockResolvedValue({
      aborted: true,
      processId: "process-1",
      sessionId: "session-1",
      pid: 43210,
      verifiedStopped: true,
      verification: "pid",
      resumeExemption: {
        heartbeatDisabled: false,
        autoResumeDisabled: false,
        error: "metadata is read-only",
      },
    });
    render(
      <MemoryRouter>
        <AgentsPage />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Kill" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "The process stopped, but auto-resume could not be disabled: metadata is read-only",
    );
  });

  it("surfaces a failed shutdown verification", async () => {
    abortProcess.mockRejectedValue(
      new Error("Provider PID 43210 is still running after abort"),
    );
    render(
      <MemoryRouter>
        <AgentsPage />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Kill" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Could not stop the agent: Provider PID 43210 is still running after abort",
    );
    expect(refetch).toHaveBeenCalledOnce();
  });
});
