import type { ArtifactViewerStatus } from "@yep-anywhere/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Message } from "../types";
import {
  sessionToolUrls,
  sessionVhostApp,
  type SessionVhostApp,
} from "../lib/sessionVhostApps";
import { useSessionRightPaneSetting } from "./useSessionRightPaneSetting";
import { sessionViewerUsesRightPane } from "../lib/sessionViewerPlacement";
import { type SessionApps, useSessionApps } from "../lib/sessionApps";
import { useVhostAccess } from "./useVhostAccess";
import { useVhostListener } from "./useVhostListener";
import { useCurrentSourceRuntime } from "../contexts/SourceRuntimeContext";
import { useRetainedVersionInfo } from "./useVersion";
import { serverHasCapability, SERVER_CAPABILITIES } from "@yep-anywhere/shared";
import {
  clearSessionViewer,
  presentSessionViewer,
  restoreSessionViewer,
  type SessionViewerControllerState,
  useSessionViewerController,
  setSessionViewerCloseAction,
} from "../lib/sessionViewerController";

/** The pane shows one content viewer: a file, or a tool-detail panel. */
type PaneViewerState = Extract<
  SessionViewerControllerState,
  { kind: "file" | "panel" }
>;

type PaneApp = SessionVhostApp & { announcementId: string };
const PLAY_ANNOUNCEMENT_PREFIX = "play:";

/** A saved viewer-activated app is the only app storage can seed. */
function emptyPane(key: string, saved?: SessionApps["latest"]) {
  const apps: PaneApp[] =
    saved?.announcementId?.startsWith(PLAY_ANNOUNCEMENT_PREFIX) &&
    saved.sourceUrl &&
    saved.url
      ? [{ ...saved, announcementId: saved.announcementId }]
      : [];
  return { key, apps };
}

/** Session right pane discovery and selection; parked routes do no discovery. */
export function useSessionRightPane(
  key: string,
  messages: readonly Message[],
  suppliedConfig: ArtifactViewerStatus | undefined,
  active: boolean,
  sessionId: string,
) {
  const { sessionRightPaneEnabled } = useSessionRightPaneSetting();
  const access = useVhostAccess(suppliedConfig);
  const config = access.config;
  const controller = useSessionViewerController();
  const runtime = useCurrentSourceRuntime();
  const version = useRetainedVersionInfo(runtime.sourceKey);
  const canKillVhost = serverHasCapability(
    version,
    SERVER_CAPABILITIES.vhostAppControl.name,
  );
  const {
    value: savedApps,
    saveLatest,
    dismiss: dismissApps,
  } = useSessionApps(key);
  const [killError, setKillError] = useState<string>();
  const [killing, setKilling] = useState(false);
  const initialized = useRef(new Set<string>());
  const announced = useRef(new Set<string>());
  const [state, setState] = useState(() => emptyPane(key, savedApps.latest));
  const current = state.key === key ? state : emptyPane(key, savedApps.latest);
  if (state.key !== key) setState(current);
  /**
   * A viewer's play activation is an app the session should remember: it
   * becomes the latest app so the App action recalls it after close, without
   * the reader having to minimize instead. The announcing viewer is already
   * showing it, so the announcement must not also open it as the pane's app.
   */
  const announce = useCallback(
    (app: SessionVhostApp) => {
      const announcementId = `${PLAY_ANNOUNCEMENT_PREFIX}${app.url}`;
      announced.current.add(`vhost:${key}:${announcementId}`);
      setState((previous) => {
        if (previous.key !== key) return previous;
        return {
          ...previous,
          apps: [
            ...previous.apps.filter(
              (known) => known.announcementId !== announcementId,
            ),
            { ...app, announcementId },
          ],
        };
      });
    },
    [key],
  );

  useEffect(() => {
    if (!active || !config) return;
    const found = new Map<
      string,
      SessionVhostApp & { announcementId: string }
    >();
    for (const message of messages) {
      for (const raw of sessionToolUrls(message)) {
        const app = sessionVhostApp(raw, config, window.location.href);
        const announcementId = `${message.uuid ?? message.id ?? "output"}:${raw}`;
        if (app) found.set(announcementId, { ...app, announcementId });
      }
    }
    // Loaded history offers links, but cannot establish that an app is still alive.
    if (!initialized.current.has(key)) {
      initialized.current.add(key);
      for (const app of found.values()) {
        announced.current.add(`vhost:${key}:${app.announcementId}`);
      }
    }
    setState((previous) => {
      if (previous.key !== key) return previous;
      const known = new Set(previous.apps.map((app) => app.announcementId));
      const added = [...found.values()].filter(
        (app) => !known.has(app.announcementId),
      );
      const latest = added.at(-1);
      const changed = [...found.values()].some(
        (app) =>
          previous.apps.find(
            (knownApp) => knownApp.announcementId === app.announcementId,
          )?.url !== app.url,
      );
      if (!latest && !changed) return previous;
      return {
        ...previous,
        apps: [
          ...previous.apps.filter((app) => !found.has(app.announcementId)),
          ...found.values(),
        ],
      };
    });
  }, [active, config, key, messages]);

  const apps = useMemo(
    () =>
      current.apps.filter(
        (app) =>
          !savedApps.dismissed.includes(app.announcementId) &&
          sessionVhostApp(app.sourceUrl, config, window.location.href)?.url ===
            app.url,
      ),
    [current.apps, config, savedApps.dismissed],
  );
  const latest = apps.at(-1);
  const latestId = latest ? `vhost:${key}:${latest.announcementId}` : undefined;
  useEffect(() => {
    if (!active) return;
    // Publish local discovery changes, never echo another tab's storage write.
    // Different transcript windows can legitimately have different latest apps.
    // A play-activated app keeps its id so a reopened session can seed it.
    saveLatest(
      latest
        ? latest.announcementId.startsWith(PLAY_ANNOUNCEMENT_PREFIX)
          ? latest
          : { ...latest, announcementId: undefined }
        : undefined,
    );
  }, [active, latest, saveLatest]);
  useEffect(() => {
    if (!active || !latest || !latestId || announced.current.has(latestId))
      return;
    announced.current.add(latestId);
    if (sessionRightPaneEnabled)
      presentSessionViewer({
        id: latestId,
        kind: "vhost",
        sessionId,
        label: latest.label,
        url: latest.url,
        artifactToken: latest.artifactToken,
      });
  }, [active, latest, latestId, sessionId, sessionRightPaneEnabled]);
  const owned =
    controller?.kind === "vhost" &&
    controller.sessionId === sessionId &&
    controller.id.startsWith(`vhost:${key}:`)
      ? controller
      : undefined;
  const selected =
    sessionRightPaneEnabled && owned
      ? apps.find((app) => app.url === owned.url)
      : undefined;
  // A file viewer and a tool-detail panel occupy the pane on the same terms.
  const paneViewer: PaneViewerState | undefined =
    (controller?.kind === "file" || controller?.kind === "panel") &&
    controller.sessionId === sessionId &&
    sessionViewerUsesRightPane(controller)
      ? controller
      : undefined;
  const canKill = selected?.artifactToken ? true : canKillVhost;
  const viewerId = owned?.id;
  const minimized = owned?.minimized;
  // An artifact has no listener to poll: its pane closes without stopping a server.
  const vhostRow =
    active && canKillVhost && selected && !selected.artifactToken && !minimized
      ? config?.vhosts?.find(
          (row) => row.port === Number(new URL(selected.sourceUrl).port),
        )
      : undefined;
  const vhostName = vhostRow?.name;
  const selectedUrl = selected?.url;
  const listenerTarget = useMemo(
    () =>
      vhostName && selectedUrl
        ? { name: vhostName, url: selectedUrl }
        : undefined,
    [vhostName, selectedUrl],
  );
  const { listener, onFrameLoad } = useVhostListener(listenerTarget, viewerId);
  // A fresh listener to watch supersedes whatever the last stop attempt reported.
  useEffect(() => {
    if (listenerTarget) setKillError(undefined);
  }, [listenerTarget]);
  useEffect(() => {
    if (owned && !selected) clearSessionViewer(owned.id);
  }, [owned, selected]);
  const select = useCallback(
    (url: string) => {
      const app = apps.find((app) => app.url === url);
      if (!app || !sessionRightPaneEnabled) return false;
      const id = `vhost:${key}:${url}`;
      presentSessionViewer({
        id,
        kind: "vhost",
        sessionId,
        label: app.label,
        url,
        artifactToken: app.artifactToken,
      });
      restoreSessionViewer(id);
      return true;
    },
    [apps, sessionRightPaneEnabled, key, sessionId],
  );
  const kill = async () => {
    if (!canKill || !selected || killing) return;
    setKilling(true);
    setKillError(undefined);
    if (!selected.artifactToken)
      dismissApps(current.apps.map((app) => app.announcementId));
    // Dismiss immediately; a pending stop request must not hold the pane open.
    owned?.close();
    try {
      if (!selected.artifactToken) {
        if (
          !listener ||
          listener.viewerId !== owned?.id ||
          listener.url !== selected.url ||
          listener.error
        )
          throw new Error(
            "App listener has not been identified; reopen the app to retry",
          );
        await runtime.transport.fetch(
          `/artifacts/vhosts/${encodeURIComponent(listener.name)}/stop`,
          { method: "POST", body: JSON.stringify({ token: listener.token }) },
        );
      }
    } catch (error) {
      setKillError(error instanceof Error ? error.message : String(error));
    } finally {
      setKilling(false);
    }
  };
  const killRef = useRef(kill);
  killRef.current = kill;
  const invokeKill = useCallback(() => {
    void killRef.current();
  }, []);
  useEffect(() => {
    if (!owned) return;
    // Stopping a live app is destructive; dismissing an artifact view is not.
    setSessionViewerCloseAction(
      owned.id,
      canKill
        ? {
            label: owned.artifactToken
              ? "sessionViewerClose"
              : "sessionRightPaneKill",
            destructive: !owned.artifactToken,
            busy: killing,
            run: invokeKill,
          }
        : undefined,
    );
  }, [owned, canKill, invokeKill, killing]);
  return {
    config,
    apps,
    selected,
    paneViewer,
    copyUrl:
      selected && !selected.artifactToken
        ? (sessionVhostApp(
            selected.sourceUrl,
            config,
            window.location.href,
            "public",
          )?.url ?? selected.url)
        : selected?.url,
    onFrameLoad,
    frameKey: owned?.id,
    appStatus:
      canKillVhost && selected && !selected.artifactToken
        ? listener?.viewerId !== owned?.id
          ? "checking"
          : listener?.error
            ? "error"
            : listener?.token
              ? "ready"
              : "unavailable"
        : undefined,
    appError: listener?.viewerId === owned?.id ? listener?.error : undefined,
    expanded: !!(selected || paneViewer) && !controller?.minimized,
    enabled: sessionRightPaneEnabled,
    select,
    announce,
    hide: () => (paneViewer ?? owned)?.minimize(),
    close: () => (paneViewer ?? owned)?.close(),
    canKill,
    killing,
    killError,
    accessError: access.error,
    kill,
  };
}
