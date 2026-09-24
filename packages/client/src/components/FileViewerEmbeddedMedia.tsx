import { type ReactNode, useCallback, useEffect, useState } from "react";
import styles from "./FileViewerEmbeddedMedia.module.css";

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
}

export function FileViewerEmbeddedMedia({
  kind,
  url,
  fileName,
  sampleText,
  unsupported,
}: FileViewerEmbeddedMediaProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const fail = useCallback(() => setFailedUrl(url), [url]);
  if (failedUrl === url) return <>{unsupported}</>;

  switch (kind) {
    case "pdf":
      return <iframe className={styles.pdf} src={url} title={fileName} />;
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
