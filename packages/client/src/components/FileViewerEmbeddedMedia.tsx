import { type ReactNode, useCallback, useEffect, useState } from "react";
import { usePdfjsRendererSetting } from "../hooks/usePdfjsRendererSetting";
import { useI18n } from "../i18n";
import styles from "./FileViewerEmbeddedMedia.module.css";
import { PdfjsDocumentView } from "./PdfjsDocumentView";

/**
 * Non-image file kinds the browser can present natively inside the viewer.
 * Images keep their own path because they carry link and context-menu actions.
 */
export type EmbeddedMediaKind = "pdf" | "audio" | "video" | "font";

export function getEmbeddedMediaKind(
  mimeType: string,
): EmbeddedMediaKind | null {
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("font/")) return "font";
  return null;
}

/**
 * Whether a loaded PDF frame shows the browser's PDF viewer. The frame URL is
 * same-origin (the raw file route or a blob), so a displayed PDF exposes its
 * document. Chromium refuses its viewer in some framings — any sandboxed
 * ancestor, for one — and substitutes a cross-origin error page, which reads
 * as no document.
 */
export function framedPdfDisplayed(frame: HTMLIFrameElement): boolean {
  try {
    return frame.contentDocument?.contentType === "application/pdf";
  } catch {
    return false;
  }
}

const FONT_SPECIMEN_GLYPHS = [
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  "abcdefghijklmnopqrstuvwxyz",
  "0123456789 !?&@#$%*()[]{}",
];
const FONT_SPECIMEN_SIZES = [14, 20, 32, 48];

interface FileViewerEmbeddedMediaProps {
  kind: EmbeddedMediaKind;
  url: string;
  fileName: string;
  sampleText: string;
  /** Shown when the browser cannot decode this particular file. */
  unsupported: ReactNode;
  /**
   * Whether the YA server's origin is addressable, which the opt-in pdf.js
   * renderer needs to load its modules.
   */
  pdfjsAvailable?: boolean;
}

export function FileViewerEmbeddedMedia({
  kind,
  url,
  fileName,
  sampleText,
  unsupported,
  pdfjsAvailable = false,
}: FileViewerEmbeddedMediaProps) {
  const { t } = useI18n();
  const { pdfjsRendererEnabled } = usePdfjsRendererSetting();
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [pdfjsFailedUrl, setPdfjsFailedUrl] = useState<string | null>(null);
  const fail = useCallback(() => setFailedUrl(url), [url]);
  // pdf.js falling through leaves the browser's own viewer to try next.
  const failPdfjs = useCallback(() => setPdfjsFailedUrl(url), [url]);
  if (
    kind === "pdf" &&
    pdfjsAvailable &&
    pdfjsRendererEnabled &&
    pdfjsFailedUrl !== url
  )
    return (
      <PdfjsDocumentView
        url={url}
        fileName={fileName}
        loading={t("fileViewerLoading" as never, { name: fileName })}
        onError={failPdfjs}
      />
    );
  if (failedUrl === url) {
    if (kind !== "pdf") return <>{unsupported}</>;
    // A top-level tab has no framing ancestry, so the browser viewer that
    // refused this frame still opens the same URL there.
    return (
      <>
        {unsupported}
        <p className={styles.openPdf}>
          <a href={url} target="_blank" rel="noopener noreferrer">
            {t("fileViewerOpenNewTab" as never)}
          </a>
        </p>
      </>
    );
  }

  switch (kind) {
    case "pdf":
      return (
        <iframe
          className={styles.pdf}
          src={url}
          title={fileName}
          onLoad={(event) => {
            if (!framedPdfDisplayed(event.currentTarget)) fail();
          }}
        />
      );
    case "audio":
      return (
        <div className={styles.media}>
          {/* biome-ignore lint/a11y/useMediaCaption: arbitrary project audio has no caption track */}
          <audio controls preload="metadata" src={url} onError={fail} />
        </div>
      );
    case "video":
      return (
        <div className={styles.media}>
          {/* biome-ignore lint/a11y/useMediaCaption: arbitrary project video has no caption track */}
          <video controls preload="metadata" src={url} onError={fail} />
        </div>
      );
    case "font":
      return (
        <FontSpecimen
          url={url}
          sampleText={sampleText}
          onError={fail}
          unsupported={unsupported}
        />
      );
  }
}

let fontSpecimenSerial = 0;

function FontSpecimen({
  url,
  sampleText,
  onError,
  unsupported,
}: {
  url: string;
  sampleText: string;
  onError: () => void;
  unsupported: ReactNode;
}) {
  const [family, setFamily] = useState<string | null>(null);

  useEffect(() => {
    if (typeof FontFace === "undefined") return;
    fontSpecimenSerial += 1;
    const face = new FontFace(
      `ya-file-viewer-font-${fontSpecimenSerial}`,
      `url("${url}")`,
    );
    let cancelled = false;
    setFamily(null);
    face.load().then(
      (loaded) => {
        if (cancelled) return;
        document.fonts.add(loaded);
        setFamily(loaded.family);
      },
      () => {
        if (!cancelled) onError();
      },
    );
    return () => {
      cancelled = true;
      document.fonts.delete(face);
    };
  }, [url, onError]);

  if (typeof FontFace === "undefined") return <>{unsupported}</>;
  if (!family) return null;
  return (
    <div
      className={styles.font}
      data-font-specimen
      style={{ fontFamily: `"${family}"` }}
    >
      {FONT_SPECIMEN_SIZES.map((size) => (
        <p key={size} style={{ fontSize: `${size}px` }}>
          {sampleText}
        </p>
      ))}
      {FONT_SPECIMEN_GLYPHS.map((glyphs) => (
        <p key={glyphs} className={styles.glyphs}>
          {glyphs}
        </p>
      ))}
    </div>
  );
}
