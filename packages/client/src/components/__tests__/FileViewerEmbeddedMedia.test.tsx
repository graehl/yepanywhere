import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { pdfjsRendererSetting } from "../../lib/pdfjsRenderer";
import { FileViewerEmbeddedMedia } from "../FileViewerEmbeddedMedia";

const pdfjs = vi.hoisted(() => ({
  open: vi.fn(),
}));

vi.mock("../../lib/pdfjsRenderer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/pdfjsRenderer")>()),
  openPdfjsDocument: pdfjs.open,
}));

const PDF_URL = "/api/projects/p/files/raw?path=paper.pdf";

function renderPdf({ pdfjsAvailable = false } = {}) {
  return render(
    <I18nProvider>
      <FileViewerEmbeddedMedia
        kind="pdf"
        url={PDF_URL}
        fileName="paper.pdf"
        sampleText=""
        unsupported={<p>cannot display</p>}
        pdfjsAvailable={pdfjsAvailable}
      />
    </I18nProvider>,
  );
}

function loadFrameWith(frame: HTMLIFrameElement, document: Document | null) {
  Object.defineProperty(frame, "contentDocument", {
    configurable: true,
    get: () => document,
  });
  fireEvent.load(frame);
}

afterEach(() => {
  pdfjsRendererSetting.set(false);
  pdfjs.open.mockReset();
});

describe("FileViewerEmbeddedMedia PDF", () => {
  it("keeps a frame that shows the browser PDF viewer", () => {
    const { container } = renderPdf();
    const frame = container.querySelector("iframe")!;
    loadFrameWith(frame, { contentType: "application/pdf" } as Document);
    expect(container.querySelector("iframe")).not.toBeNull();
    expect(screen.queryByText("cannot display")).toBeNull();
  });

  it("offers a top-level tab when the browser blocks the framed viewer", () => {
    const { container } = renderPdf();
    loadFrameWith(container.querySelector("iframe")!, null);
    expect(container.querySelector("iframe")).toBeNull();
    screen.getByText("cannot display");
    const link = screen.getByRole("link", { name: "Open in new tab" });
    expect(link.getAttribute("href")).toBe(PDF_URL);
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("leaves pdf.js unloaded while the setting is off", () => {
    const { container } = renderPdf({ pdfjsAvailable: true });
    expect(container.querySelector("iframe")).not.toBeNull();
    expect(pdfjs.open).not.toHaveBeenCalled();
  });

  it("keeps the browser viewer when the server origin is not addressable", () => {
    pdfjsRendererSetting.set(true);
    const { container } = renderPdf({ pdfjsAvailable: false });
    expect(container.querySelector("iframe")).not.toBeNull();
    expect(pdfjs.open).not.toHaveBeenCalled();
  });

  it("draws with pdf.js when enabled, and falls back to the browser viewer if it fails", async () => {
    pdfjsRendererSetting.set(true);
    let rejectOpen: (error: Error) => void = () => {};
    const destroy = vi.fn();
    pdfjs.open.mockReturnValue({
      promise: new Promise((_, reject) => {
        rejectOpen = reject;
      }),
      destroy,
    });
    const { container } = renderPdf({ pdfjsAvailable: true });
    expect(pdfjs.open).toHaveBeenCalledWith(PDF_URL);
    expect(container.querySelector("iframe")).toBeNull();
    await act(async () => rejectOpen(new Error("module failed to load")));
    expect(container.querySelector("iframe")?.getAttribute("src")).toBe(
      PDF_URL,
    );
    expect(destroy).toHaveBeenCalled();
  });
});
