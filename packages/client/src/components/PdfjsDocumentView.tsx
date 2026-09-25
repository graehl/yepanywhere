import { useEffect, useRef, useState } from "react";
import {
  openPdfjsDocument,
  type PdfjsDocument,
  type PdfjsViewport,
} from "../lib/pdfjsRenderer";
import styles from "./PdfjsDocumentView.module.css";

interface PdfjsDocumentViewProps {
  url: string;
  fileName: string;
  loading: string;
  onError: () => void;
}

/**
 * A PDF drawn by pdf.js: every page is laid out at its own aspect ratio at
 * once, so the scroll extent is stable, and each canvas is drawn when its
 * page nears the viewport.
 */
export function PdfjsDocumentView({
  url,
  fileName,
  loading,
  onError,
}: PdfjsDocumentViewProps) {
  const [opened, setOpened] = useState<{
    document: PdfjsDocument;
    sizes: PdfjsViewport[];
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setOpened(null);
    const task = openPdfjsDocument(url);
    task.promise
      .then(async (document) => {
        const sizes: PdfjsViewport[] = [];
        for (let number = 1; number <= document.numPages; number += 1)
          sizes.push(
            (await document.getPage(number)).getViewport({ scale: 1 }),
          );
        if (!cancelled) setOpened({ document, sizes });
      })
      .catch(() => {
        if (!cancelled) onError();
      });
    return () => {
      cancelled = true;
      task.destroy();
    };
  }, [url, onError]);

  if (!opened) return <div className="file-viewer-loading">{loading}</div>;
  return (
    <div className={styles.document} role="document" aria-label={fileName}>
      {opened.sizes.map((size, index) => (
        <PdfjsPageCanvas
          // biome-ignore lint/suspicious/noArrayIndexKey: pages are fixed for one opened document
          key={index}
          document={opened.document}
          pageNumber={index + 1}
          size={size}
          onError={onError}
        />
      ))}
    </div>
  );
}

function scrollingAncestor(element: Element): Element | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll") return node;
  }
  return null;
}

function PdfjsPageCanvas({
  document,
  pageNumber,
  size,
  onError,
}: {
  document: PdfjsDocument;
  pageNumber: number;
  size: PdfjsViewport;
  onError: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let render: { cancel(): void } | null = null;
    let cancelled = false;
    const draw = async () => {
      const page = await document.getPage(pageNumber);
      const pixels = canvas.clientWidth * window.devicePixelRatio;
      const viewport = page.getViewport({ scale: pixels / size.width });
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      if (cancelled) return;
      const task = page.render({ canvas, viewport });
      render = task;
      await task.promise;
    };
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        // Cancelling an in-flight render on unmount rejects it too. A real
        // failure surfaces as the fallback to the browser's viewer.
        draw().catch(() => {
          if (!cancelled) onError();
        });
      },
      // The viewer scrolls inside its own container, which clips pages
      // before the viewport would see them, so the look-ahead margin is
      // measured against that container.
      { root: scrollingAncestor(canvas), rootMargin: "100% 0px" },
    );
    observer.observe(canvas);
    return () => {
      cancelled = true;
      observer.disconnect();
      render?.cancel();
    };
  }, [document, pageNumber, size.width, onError]);

  return (
    <canvas
      ref={canvasRef}
      className={styles.page}
      style={{ aspectRatio: `${size.width} / ${size.height}` }}
    />
  );
}
