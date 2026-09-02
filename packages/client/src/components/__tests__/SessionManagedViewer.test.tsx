import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import {
  clearCurrentSessionViewer,
  minimizeSessionViewer,
  presentSessionViewer,
  restoreSessionViewer,
} from "../../lib/sessionViewerController";
import { MessageList } from "../MessageList";
import {
  SessionViewerProvider,
  SessionViewerTranscriptGate,
  useSessionViewerSessionId,
} from "../SessionManagedViewer";
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
    <SessionViewerProvider sessionId="session-1">
      <SessionViewerTranscriptGate>
        <TranscriptProbe version={version} />
      </SessionViewerTranscriptGate>
    </SessionViewerProvider>
  );
}

describe("SessionViewerTranscriptGate", () => {
  afterEach(() => {
    act(() => clearCurrentSessionViewer());
    vi.useRealTimers();
  });

  it("freezes the covered transcript until the managed viewer is parked", () => {
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
});
