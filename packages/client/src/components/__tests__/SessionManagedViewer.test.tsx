import { act, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import {
  clearCurrentSessionViewer,
  minimizeSessionViewer,
  presentSessionViewer,
  restoreSessionViewer,
} from "../../lib/sessionViewerController";
import { sessionRightPaneSetting } from "../../lib/sessionViewerPlacement";
import { MessageList } from "../MessageList";
import { useSessionAppAnnouncer } from "../SessionAppLinks";
import {
  SessionViewerProvider,
  SessionViewerTranscriptGate,
  useSessionArtifactLink,
  useSessionViewerSessionId,
} from "../SessionManagedViewer";

const ARTIFACT_ORIGIN = "http://artifacts.localhost:3400";
vi.mock("../../hooks/useVersion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../hooks/useVersion")>()),
  useRetainedVersionInfo: () => ({
    artifactViewer: { available: true, localOrigin: ARTIFACT_ORIGIN },
  }),
}));
import {
  assistantMessage,
  installMessageListTestEnvironment,
  userMessage,
} from "./MessageList.test-support";

installMessageListTestEnvironment();

function TranscriptProbe({ version }: { version: number }) {
  const sessionId = useSessionViewerSessionId();
  return (
    <div data-testid="transcript-probe">
      {sessionId}:{version}
    </div>
  );
}

function TestSession({ version }: { version: number }) {
  return (
    <I18nProvider>
      <SessionViewerProvider sessionId="session-1">
        <SessionViewerTranscriptGate>
          <TranscriptProbe version={version} />
        </SessionViewerTranscriptGate>
      </SessionViewerProvider>
    </I18nProvider>
  );
}

describe("SessionViewerTranscriptGate", () => {
  afterEach(() => {
    act(() => clearCurrentSessionViewer());
    vi.useRealTimers();
  });

  it("freezes the covered transcript until the file modal is parked", () => {
    const view = render(<TestSession version={1} />);

    act(() => {
      presentSessionViewer({
        id: "viewer-1",
        kind: "file",
        sessionId: "session-1",
        label: "README.md",
        filePath: "README.md",
        lineSuffix: "",
        renderContent: (inactive) => (
          <div data-testid="managed-viewer">
            {inactive ? "inactive" : "active"}
          </div>
        ),
      });
    });

    expect(screen.getByTestId("managed-viewer").textContent).toBe("active");
    view.rerender(<TestSession version={2} />);
    expect(screen.getByTestId("transcript-probe").textContent).toBe(
      "session-1:1",
    );

    act(() => minimizeSessionViewer("viewer-1"));
    expect(screen.getByTestId("transcript-probe").textContent).toBe(
      "session-1:2",
    );

    act(() => restoreSessionViewer("viewer-1"));
    view.rerender(<TestSession version={3} />);
    expect(screen.getByTestId("transcript-probe").textContent).toBe(
      "session-1:2",
    );

    act(() => clearCurrentSessionViewer());
    expect(screen.getByTestId("transcript-probe").textContent).toBe(
      "session-1:3",
    );
  });

  it("keeps the transcript live while an artifact app is open", () => {
    const view = render(<TestSession version={1} />);

    act(() => {
      presentSessionViewer({
        id: "artifact-1",
        kind: "artifact",
        sessionId: "session-1",
        label: "Report app",
        url: "http://artifacts.localhost/a/token/report.html",
      });
    });

    view.rerender(<TestSession version={2} />);
    expect(screen.getByTestId("transcript-probe").textContent).toBe(
      "session-1:2",
    );
  });

  it("pauses progressive transcript batches while the viewer is open", async () => {
    vi.useFakeTimers();
    const messages = Array.from({ length: 160 }, (_, index) => [
      userMessage(`user-${index}`, `request ${index}`),
      assistantMessage(`assistant-${index}`, `response ${index}`),
    ]).flat();
    const { container } = render(
      <I18nProvider>
        <SessionViewerProvider sessionId="session-1">
          <SessionViewerTranscriptGate>
            <MessageList
              messages={messages}
              progressiveRenderEnabled
              progressiveRenderKey="viewer-covered-session"
            />
          </SessionViewerTranscriptGate>
        </SessionViewerProvider>
      </I18nProvider>,
    );
    const renderWeight = () =>
      Number(
        container
          .querySelector(".message-list")
          ?.getAttribute("data-transcript-render-weight") ?? 0,
      );
    const coveredWeight = renderWeight();

    act(() => {
      presentSessionViewer({
        id: "viewer-1",
        kind: "file",
        sessionId: "session-1",
        label: "README.md",
        filePath: "README.md",
        lineSuffix: "",
        renderContent: () => null,
      });
    });
    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    expect(renderWeight()).toBe(coveredWeight);

    act(() => minimizeSessionViewer("viewer-1"));
    await act(async () => {
      vi.advanceTimersByTime(33);
    });
    expect(renderWeight()).toBeGreaterThan(coveredWeight);
  });

  it("continues progressive transcript batches while an artifact app is open", async () => {
    vi.useFakeTimers();
    const messages = Array.from({ length: 160 }, (_, index) => [
      userMessage(`user-${index}`, `request ${index}`),
      assistantMessage(`assistant-${index}`, `response ${index}`),
    ]).flat();
    const { container } = render(
      <I18nProvider>
        <SessionViewerProvider sessionId="session-1">
          <SessionViewerTranscriptGate>
            <MessageList
              messages={messages}
              progressiveRenderEnabled
              progressiveRenderKey="artifact-app-session"
            />
          </SessionViewerTranscriptGate>
        </SessionViewerProvider>
      </I18nProvider>,
    );
    const renderWeight = () =>
      Number(
        container
          .querySelector(".message-list")
          ?.getAttribute("data-transcript-render-weight") ?? 0,
      );
    const initialWeight = renderWeight();

    act(() => {
      presentSessionViewer({
        id: "artifact-1",
        kind: "artifact",
        sessionId: "session-1",
        label: "Report app",
        url: "http://artifacts.localhost/a/token/report.html",
      });
    });
    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    expect(renderWeight()).toBeGreaterThan(initialWeight);
  });
});

describe("managed panel placement", () => {
  afterEach(() => {
    act(() => {
      sessionRightPaneSetting.set(false);
      clearCurrentSessionViewer();
    });
  });

  function PanelSession({ target }: { target: HTMLElement | null }) {
    return (
      <I18nProvider>
        <SessionViewerProvider sessionId="session-1" rightPaneTarget={target}>
          <span />
        </SessionViewerProvider>
      </I18nProvider>
    );
  }

  function presentPanel() {
    act(() => {
      presentSessionViewer({
        id: "panel-1",
        kind: "panel",
        sessionId: "session-1",
        label: "Edit",
        title: "Edit detail",
        content: <div data-testid="panel-content">diff</div>,
        onClose: () => {},
      });
    });
  }

  it("covers the transcript with a modal while the right pane is off", () => {
    const target = document.createElement("div");
    document.body.append(target);
    render(<PanelSession target={target} />);
    presentPanel();

    expect(
      screen.getByTestId("panel-content").closest(".modal"),
    ).not.toBeNull();
    expect(target.querySelector("[data-testid='panel-content']")).toBeNull();
    target.remove();
  });

  it("shows the same panel in the right pane once that setting is on", () => {
    sessionRightPaneSetting.set(true);
    const target = document.createElement("div");
    document.body.append(target);
    render(<PanelSession target={target} />);
    presentPanel();

    expect(
      target.querySelector("[data-testid='panel-content']"),
    ).not.toBeNull();
    expect(screen.getByTestId("panel-content").closest(".modal")).toBeNull();
    expect(
      screen.getByRole("dialog", { name: "Edit" }).hasAttribute("hidden"),
    ).toBe(false);
    target.remove();
  });
});

describe("session App announcements", () => {
  afterEach(() => {
    act(() => clearCurrentSessionViewer());
  });

  const grantUrl = `${ARTIFACT_ORIGIN}/a/tok3n/report.html#results`;

  function PlayingViewer() {
    const announce = useSessionAppAnnouncer();
    useEffect(() => {
      announce({ sourceUrl: grantUrl, url: grantUrl, label: "report.html" });
    }, [announce]);
    return <div data-testid="playing" />;
  }

  function ArtifactLinkProbe() {
    const openArtifact = useSessionArtifactLink();
    return (
      <button type="button" onClick={() => openArtifact?.(grantUrl, "Report")}>
        open artifact
      </button>
    );
  }

  it("lets a play activation inside a hosted viewer announce its App", () => {
    const onAnnounceApp = vi.fn();
    render(
      <I18nProvider>
        <SessionViewerProvider
          sessionId="session-1"
          onAnnounceApp={onAnnounceApp}
        >
          <span />
        </SessionViewerProvider>
      </I18nProvider>,
    );
    act(() => {
      presentSessionViewer({
        id: "panel-1",
        kind: "panel",
        sessionId: "session-1",
        label: "report.html",
        title: "report.html",
        content: <PlayingViewer />,
        onClose: () => {},
      });
    });

    expect(screen.getByTestId("playing")).toBeTruthy();
    expect(onAnnounceApp).toHaveBeenCalledWith(
      expect.objectContaining({ url: grantUrl }),
    );
  });

  it("announces an artifact link opened from session prose as an App", () => {
    const onAnnounceApp = vi.fn();
    render(
      <I18nProvider>
        <SessionViewerProvider
          sessionId="session-1"
          onAnnounceApp={onAnnounceApp}
        >
          <ArtifactLinkProbe />
        </SessionViewerProvider>
      </I18nProvider>,
    );
    act(() => screen.getByRole("button", { name: "open artifact" }).click());

    expect(onAnnounceApp).toHaveBeenCalledWith({
      sourceUrl: grantUrl,
      url: grantUrl,
      label: "Report",
      artifactToken: "tok3n",
    });
  });
});
