import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ResourceContextMenu } from "./FileResourceActions";
import { useSessionAppAnnouncer } from "./SessionAppLinks";
import { ViewerModeToggle } from "./ViewerModeToggle";
import { useArtifactGrant } from "../hooks/useArtifactGrant";
import { useI18n } from "../i18n";
import { ARTIFACT_FRAME_SANDBOX } from "../lib/artifactPreview";
import { writeClipboardTextLater } from "../lib/clipboard";
import { createScriptlessHtmlPreviewDocument } from "../lib/scriptlessHtmlPreview";
import type { ViewerFindSource } from "../lib/viewerFind";
import styles from "./ArtifactPreview.module.css";

interface Props {
  html: string;
  path: string;
  projectId?: string;
  title: string;
  className?: string;
  /** Start only when the owning viewer received an explicit preview click. */
  autoStart?: boolean;
  /** The owning viewer may supply the source/preview toggle in its header. */
  showControls?: boolean;
  toolbarHost?: HTMLElement | null;
  /** Changing this remounts a running frame so it refetches from disk. */
  reloadKey?: number;
  /**
   * The frame now showing, so the owning viewer can search it: the scriptless
   * preview directly, a running artifact through its find agent.
   */
  onFindSource?: (source: ViewerFindSource | null) => void;
}

/**
 * The scriptless preview is same-origin so the trusted viewer can search it,
 * and never also `allow-scripts`: the pair would hand the previewed HTML YA's
 * origin. Its CSP denies scripts as well (scriptlessHtmlPreview.ts).
 */
export const SCRIPTLESS_PREVIEW_SANDBOX = "allow-same-origin";

export function ArtifactPreview(props: Props) {
  const { t } = useI18n();
  const [attempt, setAttempt] = useState(props.autoStart ? 1 : 0);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const { origin, grant, busy, failed, frameBlocked, createPublicUrl } =
    useArtifactGrant(props.path, props.projectId, attempt);
  // A running preview is an App the session should be able to recall from
  // its App action after the viewer closes, minimized or not.
  const announceApp = useSessionAppAnnouncer();
  // Rendering reparses a possibly multi-megabyte document; do it per source.
  const scriptlessDocument = useMemo(
    () => createScriptlessHtmlPreviewDocument(props.html),
    [props.html],
  );
  const [frame, setFrame] = useState<HTMLIFrameElement | null>(null);
  const running = Boolean(grant);
  const { onFindSource } = props;
  useEffect(() => {
    onFindSource?.(frame ? { kind: running ? "agent" : "frame", frame } : null);
  }, [frame, running, onFindSource]);
  useEffect(() => () => onFindSource?.(null), [onFindSource]);
  useEffect(() => {
    if (!grant) return;
    announceApp({
      sourceUrl: grant.url,
      url: grant.url,
      label: props.title,
      artifactToken: new URL(grant.url).pathname.split("/")[2],
    });
  }, [grant, props.title, announceApp]);

  const controls = origin && (props.showControls !== false || failed) && (
    <div className={styles.toolbar}>
      <ViewerModeToggle
        mode="interactive"
        source={{ path: props.path, projectId: props.projectId }}
        artifact
        active={Boolean(grant)}
        disabled={busy}
        onToggle={() =>
          grant ? setAttempt(0) : setAttempt((value) => value + 1)
        }
        onContextMenu={
          grant
            ? (event) => {
                event.preventDefault();
                setMenu({ x: event.clientX, y: event.clientY });
              }
            : undefined
        }
        label={t(
          grant
            ? "artifactStop"
            : busy
              ? "artifactChecking"
              : failed
                ? "artifactRetry"
                : "artifactRun",
        )}
      />
      {failed && <span role="status">{t("artifactUnavailable")}</span>}
    </div>
  );
  // Right-click on the running toggle: open the grant in a tab, copy a public
  // artifact link (a separate public-origin grant, not a file share), or stop.
  const runningMenu = menu && grant && (
    <ResourceContextMenu
      x={menu.x}
      y={menu.y}
      canStartNewSession={false}
      onClose={() => setMenu(null)}
      onOpen={() => window.open(grant.url, "_blank", "noopener,noreferrer")}
      onCopyPublicUrl={
        createPublicUrl
          ? () => void writeClipboardTextLater(createPublicUrl())
          : undefined
      }
      onStop={() => setAttempt(0)}
      stopLabel={t("artifactStop")}
    />
  );
  return (
    <div className={`${styles.preview} ${props.className ?? ""}`}>
      {props.toolbarHost ? createPortal(controls, props.toolbarHost) : controls}
      {runningMenu}
      {props.showControls === false && busy && (
        <div className={styles.notice} role="status">
          {t("artifactChecking")}
        </div>
      )}
      {props.autoStart && !origin && (
        <div className={styles.notice} role="status">
          {t("artifactUnavailable")}
        </div>
      )}
      {grant && frameBlocked ? (
        <div className={styles.notice} role="alert">
          <p>{t("artifactFrameBlocked")}</p>
          <a href={grant.url} target="_blank" rel="noopener noreferrer">
            {t("artifactOpenTab")}
          </a>
        </div>
      ) : grant ? (
        <iframe
          key={`${grant.id}:${props.reloadKey ?? 0}`}
          ref={setFrame}
          className={styles.frame}
          title={props.title}
          aria-label={props.title}
          sandbox={ARTIFACT_FRAME_SANDBOX}
          referrerPolicy="no-referrer"
          src={grant.url}
        />
      ) : (
        <iframe
          ref={setFrame}
          className={styles.frame}
          title={props.title}
          aria-label={props.title}
          sandbox={SCRIPTLESS_PREVIEW_SANDBOX}
          referrerPolicy="no-referrer"
          srcDoc={scriptlessDocument}
        />
      )}
    </div>
  );
}
