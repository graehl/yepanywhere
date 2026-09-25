import {
  createContext,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
} from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../i18n";
import { QUOTE_SELECTION_ROOT_ATTRIBUTES } from "../lib/markdownSelectionCopy";
import styles from "./SessionManagedViewer.module.css";
import headerStyles from "./ViewerHeader.module.css";
import { useSessionRightPaneSetting } from "../hooks/useSessionRightPaneSetting";
import { usePanelSlideAnimations } from "../hooks/usePanelSlideAnimations";
import { useClosingPaneContent } from "../hooks/useClosingPaneContent";
import { sessionViewerUsesRightPane } from "../lib/sessionViewerPlacement";
import { useCurrentSourceRuntime } from "../contexts/SourceRuntimeContext";
import { useRetainedVersionInfo } from "../hooks/useVersion";
import { isArtifactLink } from "../lib/artifactPreview";
import { ArtifactLinkViewer } from "./ArtifactLinkViewer";
import {
  type SendSessionViewerComment,
  SessionViewerCommentProvider,
} from "../contexts/SessionViewerCommentContext";
import {
  clearSessionViewer,
  presentSessionViewer,
  restoreSessionViewer,
  sessionViewerFreezesTranscript,
  type SessionViewerControllerState,
  useSessionViewerController,
} from "../lib/sessionViewerController";
import { Modal, useModalLayer } from "./ui/Modal";
import { SessionAppLinkContext } from "./SessionAppLinks";
import {
  rewriteSessionLocalhostHref,
  type SessionAppConfig,
  type SessionVhostApp,
} from "../lib/sessionVhostApps";
import { useRelayUsername } from "../hooks/useRemoteBasePath";

interface SessionManagedPanelProps {
  viewerId?: string;
  sessionId: string;
  title: ReactNode;
  actions?: ReactNode;
  contentRef?: RefObject<HTMLDivElement | null>;
  label: string;
  briefLabel?: string;
  children: ReactNode;
  onClose: () => void;
}

const SessionViewerContext = createContext<string | null>(null);
const SessionFileViewerHostContext = createContext<{
  target: HTMLElement | null;
  inactive: boolean;
} | null>(null);

export function useSessionFileViewerHost() {
  return useContext(SessionFileViewerHostContext);
}
const SessionArtifactLinkContext = createContext<
  ((url: string, label: string) => boolean) | null
>(null);

export function useSessionArtifactLink() {
  return useContext(SessionArtifactLinkContext);
}

export function useSessionViewerSessionId(): string | null {
  return useContext(SessionViewerContext);
}

/** Publishes a content panel to the session's shared managed-viewer host. */
export function SessionManagedPanel({
  viewerId: suppliedViewerId,
  sessionId,
  title,
  actions,
  contentRef,
  label,
  briefLabel,
  children,
  onClose,
}: SessionManagedPanelProps) {
  const generatedViewerId = useId();
  const viewerId = suppliedViewerId ?? generatedViewerId;
  const mountedRef = useRef(true);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    presentSessionViewer({
      id: viewerId,
      kind: "panel",
      sessionId,
      title,
      actions,
      contentRef,
      label,
      briefLabel,
      content: children,
      onClose: () => {
        if (mountedRef.current) onCloseRef.current();
      },
    });
  }, [
    actions,
    briefLabel,
    children,
    contentRef,
    label,
    sessionId,
    title,
    viewerId,
  ]);

  return null;
}

export function SessionViewerProvider({
  sessionId,
  inactive = false,
  onSendComment,
  onOpenApp,
  onAnnounceApp,
  appConfig,
  rightPaneTarget,
  children,
}: {
  sessionId: string;
  inactive?: boolean;
  onSendComment?: SendSessionViewerComment;
  onOpenApp?: (url: string) => boolean;
  onAnnounceApp?: (app: SessionVhostApp) => void;
  appConfig?: SessionAppConfig;
  rightPaneTarget?: HTMLElement | null;
  children: ReactNode;
}) {
  const runtime = useCurrentSourceRuntime();
  const version = useRetainedVersionInfo(runtime.sourceKey);
  const relayUsername = useRelayUsername();
  const viewerId = useId();
  const appLinks = useMemo(
    () =>
      inactive
        ? null
        : {
            config: appConfig,
            open: onOpenApp,
            announce: onAnnounceApp,
            rewriteHref: (url: string) =>
              rewriteSessionLocalhostHref(url, appConfig, {
                clientUrl: window.location.href,
                relayed: relayUsername !== undefined,
              }),
            publicHref: (url: string) => {
              if (!appConfig?.vhostPublicRoot) return undefined;
              const rewritten = rewriteSessionLocalhostHref(url, appConfig, {
                clientUrl: window.location.href,
                relayed: relayUsername !== undefined,
                force: true,
              });
              if (rewritten !== url) return rewritten;
              try {
                const target = new URL(url);
                if (target.hostname.endsWith(`.${appConfig.vhostPublicRoot}`))
                  return target.href;
              } catch {
                return undefined;
              }
              return undefined;
            },
          },
    [inactive, appConfig, onOpenApp, onAnnounceApp, relayUsername],
  );
  const openArtifact = useCallback(
    (url: string, label: string) => {
      if (
        inactive ||
        !isArtifactLink(url, version?.artifactViewer, window.location.href)
      )
        return false;
      presentSessionViewer({
        id: viewerId,
        kind: "artifact",
        sessionId,
        url,
        label,
      });
      restoreSessionViewer(viewerId);
      // An opened artifact is an App the session recalls after this viewer
      // closes, the same as a file viewer's play activation.
      onAnnounceApp?.({
        sourceUrl: url,
        url,
        label,
        artifactToken: new URL(url).pathname.split("/")[2],
      });
      return true;
    },
    [inactive, onAnnounceApp, sessionId, version?.artifactViewer, viewerId],
  );
  return (
    <SessionViewerContext.Provider value={sessionId}>
      <SessionArtifactLinkContext.Provider value={openArtifact}>
        <SessionViewerCommentProvider onSendComment={onSendComment}>
          {/* Viewers the host renders belong to the session: a play activation
              inside one announces its App like any transcript content. */}
          <SessionAppLinkContext.Provider value={appLinks}>
            {children}
            <SessionManagedViewerHost
              sessionId={sessionId}
              inactive={inactive}
              rightPaneTarget={rightPaneTarget}
            />
          </SessionAppLinkContext.Provider>
        </SessionViewerCommentProvider>
      </SessionArtifactLinkContext.Provider>
    </SessionViewerContext.Provider>
  );
}

/** Keeps covered transcript props stable behind an expensive covering modal. */
export function SessionViewerTranscriptGate({
  children,
}: {
  children: ReactNode;
}) {
  const sessionId = useSessionViewerSessionId();
  const controller = useSessionViewerController();
  useSessionRightPaneSetting();
  const viewerOpen = Boolean(
    controller?.sessionId === sessionId &&
      sessionViewerFreezesTranscript(controller),
  );
  const renderedChildrenRef = useRef(children);
  if (!viewerOpen) {
    renderedChildrenRef.current = children;
  }
  return renderedChildrenRef.current;
}

export function SessionManagedViewerHost({
  sessionId,
  inactive = false,
  rightPaneTarget,
}: {
  sessionId: string;
  inactive?: boolean;
  rightPaneTarget?: HTMLElement | null;
}) {
  const controller = useSessionViewerController();
  const { sessionRightPaneEnabled } = useSessionRightPaneSetting();
  const { panelSlideDurationMs } = usePanelSlideAnimations();
  const controllerRef = useRef(controller);
  const lifecycleGenerationRef = useRef(0);
  controllerRef.current = controller;
  const activePanel =
    controller?.kind === "panel" && controller.sessionId === sessionId
      ? controller
      : null;
  const panel = useClosingPaneContent(
    activePanel,
    sessionRightPaneEnabled && (!controller || activePanel)
      ? panelSlideDurationMs
      : 0,
  );
  const activeFile =
    controller?.kind === "file" &&
    controller.sessionId === sessionId &&
    controller.renderContent
      ? controller
      : null;
  const file = useClosingPaneContent(
    activeFile,
    sessionRightPaneEnabled && (!controller || activeFile)
      ? panelSlideDurationMs
      : 0,
  );

  useEffect(() => {
    lifecycleGenerationRef.current += 1;
    return () => {
      const cleanupGeneration = lifecycleGenerationRef.current + 1;
      lifecycleGenerationRef.current = cleanupGeneration;
      queueMicrotask(() => {
        const active = controllerRef.current;
        if (
          lifecycleGenerationRef.current === cleanupGeneration &&
          active?.sessionId === sessionId
        ) {
          clearSessionViewer(active.id);
        }
      });
    };
  }, [sessionId]);

  if (file) {
    const content = (
      <SessionViewerContext.Provider value={null}>
        <SessionFileViewerHostContext.Provider
          value={{
            target: sessionViewerUsesRightPane(file)
              ? (rightPaneTarget ?? null)
              : null,
            inactive: inactive || file.minimized || controller?.id !== file.id,
          }}
        >
          {file.renderContent(inactive, sessionViewerUsesRightPane(file))}
        </SessionFileViewerHostContext.Provider>
      </SessionViewerContext.Provider>
    );
    if (sessionViewerUsesRightPane(file)) {
      if (!rightPaneTarget) return null;
      return createPortal(content, rightPaneTarget);
    }
    return content;
  }
  if (controller?.kind === "artifact" && controller.sessionId === sessionId)
    return (
      <ArtifactLinkViewer
        key={controller.url}
        controller={controller}
        inactive={inactive}
      />
    );
  if (!panel) return null;
  if (sessionViewerUsesRightPane(panel)) {
    if (!rightPaneTarget) return null;
    return createPortal(
      <SessionPanelPane panel={panel} inactive={inactive} />,
      rightPaneTarget,
    );
  }
  return (
    <Modal
      title={panel.title}
      actions={panel.actions}
      contentRef={panel.contentRef}
      onClose={panel.close}
      onMinimize={panel.minimize}
      minimized={panel.minimized || inactive}
    >
      {panel.content}
    </Modal>
  );
}

/**
 * The session's detail panel as a right-pane column.
 *
 * Chrome reuses the modal header/content classes so a panel written for the
 * covering modal needs no knowledge of where it is shown.
 */
function SessionPanelPane({
  panel,
  inactive,
}: {
  panel: Extract<SessionViewerControllerState, { kind: "panel" }>;
  inactive: boolean;
}) {
  const { t } = useI18n();
  const hidden = panel.minimized || inactive;
  useModalLayer(panel.close, !hidden);
  return (
    <section
      className={styles.panePanel}
      role="dialog"
      aria-label={panel.label}
      hidden={hidden}
      {...QUOTE_SELECTION_ROOT_ATTRIBUTES}
    >
      <div className={`modal-header ${headerStyles.header}`}>
        <span className={headerStyles.identity}>
          <span className="modal-title">{panel.title}</span>
        </span>
        <span className={`modal-header-actions ${headerStyles.actions}`}>
          {panel.actions}
          <button
            type="button"
            className="modal-close"
            onClick={panel.minimize}
            aria-label={t("modalMinimize")}
          >
            −
          </button>
          <button
            type="button"
            className="modal-close"
            onClick={panel.close}
            aria-label={t("modalClose")}
          >
            ×
          </button>
        </span>
      </div>
      <div className="modal-content" ref={panel.contentRef}>
        {panel.content}
      </div>
    </section>
  );
}
