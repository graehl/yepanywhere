/**
 * Opt-in PDF rendering with pdf.js, for browsers that will not show a PDF
 * themselves. YA does not bundle pdf.js: the server fetches a pinned,
 * hash-verified release on first demand and serves it from YA's own origin
 * (`/api/pdfjs/<version>/`), so the module loads under the app's ordinary
 * same-origin script policy and only when a PDF is actually shown. A client
 * without a same-origin server, such as the relay client, keeps the
 * browser's viewer.
 */
import { PDFJS_VERSION } from "@yep-anywhere/shared";
import { createLocalStorageBoolean } from "./localStorageValue";
import { UI_KEYS } from "./storageKeys";

const PDFJS_BASE_URL = `/api/pdfjs/${PDFJS_VERSION}`;

export const pdfjsRendererSetting = createLocalStorageBoolean(
  UI_KEYS.pdfjsRenderer,
  false,
);

export interface PdfjsViewport {
  width: number;
  height: number;
}

export interface PdfjsPage {
  getViewport(options: { scale: number }): PdfjsViewport;
  render(options: { canvas: HTMLCanvasElement; viewport: PdfjsViewport }): {
    promise: Promise<void>;
    cancel(): void;
  };
}

export interface PdfjsDocument {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfjsPage>;
}

interface PdfjsModule {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(options: Record<string, unknown>): {
    promise: Promise<PdfjsDocument>;
    destroy(): Promise<void>;
  };
}

let loading: Promise<PdfjsModule> | null = null;

function loadPdfjs(): Promise<PdfjsModule> {
  loading ??= (
    import(
      /* @vite-ignore */ `${PDFJS_BASE_URL}/build/pdf.min.mjs`
    ) as Promise<PdfjsModule>
  ).then(
    (pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = `${PDFJS_BASE_URL}/build/pdf.worker.min.mjs`;
      return pdfjs;
    },
    (error: unknown) => {
      loading = null;
      throw error;
    },
  );
  return loading;
}

/** Open `url` with pdf.js; `destroy` releases the document and its worker. */
export function openPdfjsDocument(url: string): {
  promise: Promise<PdfjsDocument>;
  destroy: () => void;
} {
  let task: ReturnType<PdfjsModule["getDocument"]> | null = null;
  let destroyed = false;
  const promise = loadPdfjs().then((pdfjs) => {
    if (destroyed) throw new Error("PDF closed");
    task = pdfjs.getDocument({
      url,
      withCredentials: true,
      // The app policy forbids eval; pdf.js then draws glyphs without it.
      isEvalSupported: false,
      // Errors only: font-substitution notices are not actionable here.
      verbosity: 0,
      cMapUrl: `${PDFJS_BASE_URL}/cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${PDFJS_BASE_URL}/standard_fonts/`,
      wasmUrl: `${PDFJS_BASE_URL}/wasm/`,
      iccUrl: `${PDFJS_BASE_URL}/iccs/`,
    });
    return task.promise;
  });
  return {
    promise,
    destroy: () => {
      destroyed = true;
      void task?.destroy();
    },
  };
}
