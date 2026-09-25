import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../../i18n";
import { FileViewerEmbeddedMedia } from "../FileViewerEmbeddedMedia";

function renderPdf() {
  return render(
    <I18nProvider>
      <FileViewerEmbeddedMedia
        kind="pdf"
        url="/api/projects/p/files/raw?path=paper.pdf"
        fileName="paper.pdf"
        sampleText=""
        unsupported={<p>cannot display</p>}
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
    expect(link.getAttribute("href")).toBe(
      "/api/projects/p/files/raw?path=paper.pdf",
    );
    expect(link.getAttribute("target")).toBe("_blank");
  });
});
