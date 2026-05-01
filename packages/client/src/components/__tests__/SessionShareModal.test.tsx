// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { I18nProvider } from "../../i18n";
import { SessionShareModal } from "../SessionShareModal";

describe("SessionShareModal", () => {
  const writeText = vi.fn();

  beforeEach(() => {
    vi.spyOn(api, "getPublicSessionShareStatus").mockResolvedValue({
      activeCount: 0,
      frozenCount: 0,
      liveCount: 0,
    });
    vi.spyOn(api, "createPublicSessionShare").mockResolvedValue({
      url: "https://ya.graehl.org/share/secret?h=test-host",
      mode: "frozen",
      createdAt: "2026-05-01T00:00:00.000Z",
      secretBits: 512,
    });
    vi.spyOn(api, "revokePublicSessionShares").mockResolvedValue({
      activeCount: 0,
      frozenCount: 0,
      liveCount: 0,
      revokedCount: 2,
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    writeText.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("creates and copies a frozen read-only public share in one click", async () => {
    render(
      <I18nProvider>
        <SessionShareModal
          projectId="cHJvamVjdA"
          sessionId="session-1"
          title="Build logs"
          onClose={vi.fn()}
        />
      </I18nProvider>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /Copy Read-Only Snapshot Link/ }),
    );

    await waitFor(() => {
      expect(api.createPublicSessionShare).toHaveBeenCalledWith({
        projectId: "cHJvamVjdA",
        sessionId: "session-1",
        mode: "frozen",
        title: "Build logs",
      });
    });
    expect(writeText).toHaveBeenCalledWith(
      "https://ya.graehl.org/share/secret?h=test-host",
    );
    expect(
      screen.getByDisplayValue("https://ya.graehl.org/share/secret?h=test-host"),
    ).toBeTruthy();
    expect(screen.getByText("Read-only link copied to clipboard.")).toBeTruthy();
  });

  it("creates and copies a live read-only public share in one click", async () => {
    render(
      <I18nProvider>
        <SessionShareModal
          projectId="cHJvamVjdA"
          sessionId="session-1"
          title="Build logs"
          onClose={vi.fn()}
        />
      </I18nProvider>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /Copy Read-Only Live Link/ }),
    );

    await waitFor(() => {
      expect(api.createPublicSessionShare).toHaveBeenCalledWith(
        expect.objectContaining({ mode: "live" }),
      );
    });
  });

  it("does not surface raw focus errors when clipboard access is blocked", async () => {
    writeText.mockRejectedValueOnce(new Error("Document is not focused"));
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: vi.fn(() => false),
    });

    render(
      <I18nProvider>
        <SessionShareModal
          projectId="cHJvamVjdA"
          sessionId="session-1"
          title="Build logs"
          onClose={vi.fn()}
        />
      </I18nProvider>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /Copy Read-Only Snapshot Link/ }),
    );

    await waitFor(() => {
      expect(
        screen.getByText(
          "Read-only link created. Clipboard access was blocked; select the link above to copy it manually.",
        ),
      ).toBeTruthy();
    });
    expect(screen.queryByText("Document is not focused")).toBeNull();
    expect(
      screen.getByDisplayValue("https://ya.graehl.org/share/secret?h=test-host"),
    ).toBeTruthy();
  });

  it("skips async clipboard when the document is not focused", async () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: vi.fn(() => true),
    });

    render(
      <I18nProvider>
        <SessionShareModal
          projectId="cHJvamVjdA"
          sessionId="session-1"
          title="Build logs"
          onClose={vi.fn()}
        />
      </I18nProvider>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /Copy Read-Only Snapshot Link/ }),
    );

    await waitFor(() => {
      expect(screen.getByText("Read-only link copied to clipboard.")).toBeTruthy();
    });
    expect(writeText).not.toHaveBeenCalled();
  });

  it("shows revoke all only when the session already has active shares", async () => {
    vi.mocked(api.getPublicSessionShareStatus).mockResolvedValue({
      activeCount: 2,
      frozenCount: 1,
      liveCount: 1,
    });

    render(
      <I18nProvider>
        <SessionShareModal
          projectId="cHJvamVjdA"
          sessionId="session-1"
          title="Build logs"
          onClose={vi.fn()}
        />
      </I18nProvider>,
    );

    const revoke = await screen.findByRole("button", {
      name: "Revoke All Shared Links",
    });
    fireEvent.click(revoke);

    await waitFor(() => {
      expect(api.revokePublicSessionShares).toHaveBeenCalledWith(
        "cHJvamVjdA",
        "session-1",
      );
    });
    expect(screen.getByText("Revoked 2 shared link(s).")).toBeTruthy();
  });
});
