import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { ArtifactViewerStatus } from "@yep-anywhere/shared";
import type { Message } from "../../types";
import { invalidateLocalStorageValues } from "../../lib/localStorageValue";
import {
  invalidateSessionApps,
  SESSION_APPS_KEY_PREFIX,
} from "../../lib/sessionApps";
import { UI_KEYS } from "../../lib/storageKeys";
import { useSessionRightPane } from "../useSessionRightPane";
import { clearCurrentSessionViewer } from "../../lib/sessionViewerController";

const config: ArtifactViewerStatus = {
  port: 4402,
  available: true,
  locked: false,
  defaultLocalOrigin: "http://artifacts.localhost",
  localOrigin: "http://artifacts.localhost",
  vhosts: [{ name: "plan", port: 19432 }],
};
const output = (path: string): Message => ({
  content: [
    { type: "tool_result", content: `Open http://localhost:19432/${path}` },
  ],
});

describe("session right pane lifecycle", () => {
  beforeEach(() => {
    clearCurrentSessionViewer();
    localStorage.clear();
    invalidateLocalStorageValues();
  });
  it("offers loaded history without reopening it, then opens fresh output", () => {
    localStorage.setItem(UI_KEYS.sessionRightPane, "true");
    invalidateLocalStorageValues();
    const history = [output("expired")];
    const { result, rerender, unmount } = renderHook(
      ({ messages, active }) =>
        useSessionRightPane("reload", messages, config, active, "reload"),
      { initialProps: { messages: [] as Message[], active: false } },
    );
    rerender({ messages: history, active: true });
    expect(result.current.apps).toHaveLength(1);
    expect(result.current.selected).toBeUndefined();
    act(() => result.current.select(result.current.apps[0]!.url));
    expect(result.current.expanded).toBe(true);
    act(() => result.current.close());
    rerender({ messages: [...history, output("fresh")], active: true });
    expect(result.current.selected?.url).toContain("/fresh");
    act(() => result.current.close());
    unmount();
    const reloaded = renderHook(() =>
      useSessionRightPane("reload", history, config, true, "reload"),
    );
    expect(reloaded.result.current.apps).toHaveLength(1);
    expect(reloaded.result.current.selected).toBeUndefined();
  });
  it("auto-opens a fresh artifact without vhosts and does not open older history", async () => {
    localStorage.setItem(UI_KEYS.sessionRightPane, "true");
    invalidateLocalStorageValues();
    const artifact = (id: string): Message => ({
      uuid: id,
      content: [
        {
          type: "tool_result",
          content: `http://artifacts.localhost/a/${id}/review.html`,
        },
      ],
    });
    const previous = artifact("previous-token");
    const latest = artifact("latest-token");
    const { result, rerender } = renderHook(
      ({ messages }) =>
        useSessionRightPane(
          "artifact",
          messages,
          { ...config, vhosts: [] },
          true,
          "artifact",
        ),
      { initialProps: { messages: [previous] } },
    );
    expect(result.current.selected).toBeUndefined();
    rerender({ messages: [previous, latest] });
    expect(result.current.selected?.artifactToken).toBe("latest-token");
    act(() => result.current.close());
    act(() => result.current.select(result.current.apps[0]!.url));
    await act(() => result.current.kill());
    expect(result.current.apps).toHaveLength(2);
    expect(result.current.selected).toBeUndefined();
    act(() => result.current.select(result.current.apps[0]!.url));
    expect(result.current.selected?.artifactToken).toBe("previous-token");
  });
  it("defaults off, retains selectable links, isolates sessions and honors close", () => {
    const messages = [output("one")];
    const { result, rerender } = renderHook(
      ({ key, messages, active, config }) =>
        useSessionRightPane(key, messages, config, active, key),
      { initialProps: { key: "one", messages, active: true, config } },
    );
    expect(result.current.apps).toHaveLength(1);
    expect(result.current.selected).toBeUndefined();
    act(() => {
      localStorage.setItem(UI_KEYS.sessionRightPane, "true");
      invalidateLocalStorageValues();
    });
    act(() => result.current.select(result.current.apps[0]!.url));
    expect(result.current.expanded).toBe(true);
    act(() => result.current.hide());
    expect(result.current.selected).toBeDefined();
    expect(result.current.expanded).toBe(false);
    act(() => result.current.close());
    rerender({ key: "one", messages: [...messages], active: true, config });
    expect(result.current.selected).toBeUndefined();
    rerender({
      key: "one",
      messages: [...messages, output("two")],
      active: false,
      config,
    });
    expect(result.current.apps).toHaveLength(1);
    rerender({
      key: "one",
      messages: [...messages, output("two")],
      active: true,
      config,
    });
    expect(result.current.selected?.url).toContain("/two");
    rerender({
      key: "one",
      messages,
      active: true,
      config: { ...config, vhosts: [] },
    });
    expect(result.current.apps).toHaveLength(0);
    expect(result.current.selected).toBeUndefined();
    rerender({ key: "other", messages: [], active: true, config });
    expect(result.current.apps).toHaveLength(0);
  });
});

describe("session right pane viewer-activated apps", () => {
  beforeEach(() => {
    localStorage.clear();
    invalidateLocalStorageValues();
    clearCurrentSessionViewer();
  });

  it("makes a play activation the latest App and seeds it on return", () => {
    localStorage.setItem(UI_KEYS.sessionRightPane, "true");
    const messages = [output("one")];
    const { result, rerender } = renderHook(
      ({ key, messages }) =>
        useSessionRightPane(key, messages, config, true, key),
      { initialProps: { key: "play", messages } },
    );
    expect(result.current.apps.at(-1)?.url).toContain("/one");
    const grant = {
      sourceUrl: `${config.localOrigin}/a/tok3n/report.html`,
      url: `${config.localOrigin}/a/tok3n/report.html`,
      label: "report.html",
      artifactToken: "tok3n",
    };
    act(() => result.current.announce(grant));
    expect(result.current.apps.at(-1)?.url).toBe(grant.url);
    expect(result.current.apps).toHaveLength(2);
    // The announcing viewer already shows it; the pane must not take it over.
    expect(result.current.selected).toBeUndefined();
    // Announcing the same grant again does not duplicate it.
    act(() => result.current.announce(grant));
    expect(result.current.apps).toHaveLength(2);
    expect(
      JSON.parse(localStorage.getItem("yep-anywhere-session-apps:play") ?? "{}")
        .latest,
    ).toMatchObject({ url: grant.url, announcementId: `play:${grant.url}` });

    // Leaving and returning re-seeds the play app from storage, so the App
    // action still recalls it after the viewer that started it closed.
    rerender({ key: "elsewhere", messages: [] });
    expect(result.current.apps).toHaveLength(0);
    rerender({ key: "play", messages });
    expect(result.current.apps.map((app) => app.url)).toEqual(
      expect.arrayContaining([grant.url]),
    );
  });
});

describe("session right pane app persistence", () => {
  const sessionKey = "/project-1/session-1";
  const storageKey = `${SESSION_APPS_KEY_PREFIX}${sessionKey}`;
  const noMessages: readonly Message[] = [];

  beforeEach(() => {
    clearCurrentSessionViewer();
    localStorage.clear();
    invalidateLocalStorageValues();
    invalidateSessionApps();
  });

  const mount = () =>
    renderHook(() =>
      useSessionRightPane(sessionKey, noMessages, undefined, true, "session-1"),
    );

  it("leaves storage untouched for a session with no app URLs", () => {
    localStorage.setItem("unrelated-key", "unrelated");
    const before = localStorage.length;

    mount();

    expect(localStorage.length).toBe(before);
    expect(localStorage.getItem(storageKey)).toBeNull();
  });

  it("does not write its older App back when another tab publishes a newer one", () => {
    const messages = [output("older")];
    renderHook(() =>
      useSessionRightPane(sessionKey, messages, config, true, "session-1"),
    );
    const newer = JSON.stringify({
      latest: {
        sourceUrl: "http://localhost:19432/newer",
        url: "http://plan.localhost/newer",
        label: "plan/newer",
      },
      dismissed: [],
    });
    act(() => {
      localStorage.setItem(storageKey, newer);
      window.dispatchEvent(new StorageEvent("storage", { key: storageKey }));
    });
    expect(localStorage.getItem(storageKey)).toBe(newer);
  });

  it("removes a stored entry that has decayed to the default", () => {
    localStorage.setItem(storageKey, '{"dismissed":[]}');

    mount();

    expect(localStorage.getItem(storageKey)).toBeNull();
  });

  it("keeps a stored entry that still carries dismissals", () => {
    const stored = '{"dismissed":["vhost:announcement-1"]}';
    localStorage.setItem(storageKey, stored);

    mount();

    expect(localStorage.getItem(storageKey)).toBe(stored);
  });
});
