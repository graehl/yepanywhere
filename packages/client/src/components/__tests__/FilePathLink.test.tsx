import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { toUrlProjectId } from "@yep-anywhere/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PublicShareProvider } from "../../contexts/PublicShareContext";
import { FilePathLink } from "../FilePathLink";

describe("FilePathLink", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders a native link to the standalone file viewer", () => {
    render(
      <FilePathLink
        projectId="project-id"
        filePath="docs/guide.md"
        lineNumber={12}
        displayText="guide.md"
      />,
    );

    const link = screen.getByRole("link", { name: /guide\.md\s*:12/ });
    expect(link.getAttribute("href")).toBe(
      "/projects/project-id/file?path=docs%2Fguide.md&line=12",
    );
  });

  it("renders file range links with lineEnd", () => {
    render(
      <FilePathLink
        projectId="project-id"
        filePath="docs/guide.md"
        lineNumber={12}
        lineEnd={16}
        displayText="guide.md"
      />,
    );

    const link = screen.getByRole("link", { name: /guide\.md\s*:12-16/ });
    expect(link.getAttribute("href")).toBe(
      "/projects/project-id/file?path=docs%2Fguide.md&line=12&lineEnd=16",
    );
  });

  it("renders compact range links with view=range", () => {
    render(
      <FilePathLink
        projectId="project-id"
        filePath="docs/guide.md"
        lineNumber={12}
        lineEnd={16}
        displayText="5 lines"
        showLineSuffix={false}
        viewMode="range"
      />,
    );

    const link = screen.getByRole("link", { name: "5 lines" });
    expect(link.getAttribute("href")).toBe(
      "/projects/project-id/file?path=docs%2Fguide.md&line=12&lineEnd=16&view=range",
    );
  });

  it("links absolute paths under the project as project-relative paths", () => {
    const projectId = toUrlProjectId("/local/graehl/yepanywhere");

    render(
      <FilePathLink
        projectId={projectId}
        filePath="/local/graehl/yepanywhere/ui-report/README.md"
        lineNumber={8}
        displayText="ui-report/README.md"
      />,
    );

    const link = screen.getByRole("link", {
      name: /ui-report\/README\.md\s*:8/,
    });
    expect(link.getAttribute("href")).toBe(
      `/projects/${projectId}/file?path=ui-report%2FREADME.md&line=8`,
    );
  });

  it("links Windows absolute paths under the project as project-relative paths", () => {
    const projectRoot = "C:\\Users\\user\\Documents\\code\\playbox";
    const projectId = toUrlProjectId(projectRoot);

    render(
      <FilePathLink
        projectId={projectId}
        filePath={`${projectRoot}\\docs\\tactical\\note.md`}
        lineNumber={8}
        displayText="docs/tactical/note.md"
      />,
    );

    const link = screen.getByRole("link", {
      name: /docs\/tactical\/note\.md\s*:8/,
    });
    expect(link.getAttribute("href")).toBe(
      `/projects/${projectId}/file?path=docs%2Ftactical%2Fnote.md&line=8`,
    );
  });

  it("keeps Windows absolute paths outside the project absolute", () => {
    const projectRoot = "C:\\Users\\user\\Documents\\code\\playbox";
    const projectId = toUrlProjectId(projectRoot);

    render(
      <FilePathLink
        projectId={projectId}
        filePath={"D:\\scratch\\outside.md"}
        lineNumber={4}
        displayText="outside.md"
      />,
    );

    const link = screen.getByRole("link", { name: /outside\.md\s*:4/ });
    expect(link.getAttribute("href")).toBe(
      `/projects/${projectId}/file?path=D%3A%5Cscratch%5Coutside.md&line=4`,
    );
  });

  it("renders a copy-path button that copies the path without bubbling", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const containerClick = vi.fn();

    render(
      // biome-ignore lint/a11y/noStaticElementInteractions: asserts non-bubbling
      // biome-ignore lint/a11y/useKeyWithClickEvents: test-only wrapper
      <div onClick={containerClick}>
        <FilePathLink
          projectId="project-id"
          filePath="docs/guide.md"
          lineNumber={12}
          displayText="guide.md"
        />
      </div>,
    );

    const copyButton = screen.getByRole("button", { name: "Copy path" });
    fireEvent.click(copyButton);
    await Promise.resolve();

    expect(writeText).toHaveBeenCalledWith("docs/guide.md");
    expect(containerClick).not.toHaveBeenCalled();
  });

  it("copies absolute paths under the project as project-relative", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const projectId = toUrlProjectId("/local/graehl/yepanywhere");

    render(
      <FilePathLink
        projectId={projectId}
        filePath="/local/graehl/yepanywhere/ui-report/README.md"
        displayText="ui-report/README.md"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy path" }));
    await Promise.resolve();

    expect(writeText).toHaveBeenCalledWith("ui-report/README.md");
  });

  it("copies paths outside the project verbatim", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const projectId = toUrlProjectId("/local/graehl/yepanywhere");

    render(
      <FilePathLink
        projectId={projectId}
        filePath="/home/graehl/.claude/CLAUDE.md"
        displayText="CLAUDE.md"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy path" }));
    await Promise.resolve();

    expect(writeText).toHaveBeenCalledWith("/home/graehl/.claude/CLAUDE.md");
  });

  it("omits the copy button when showCopyButton is false", () => {
    render(
      <FilePathLink
        projectId="project-id"
        filePath="docs/guide.md"
        displayText="guide.md"
        showCopyButton={false}
      />,
    );

    expect(screen.queryByRole("button", { name: "Copy path" })).toBeNull();
  });

  it("uses share-scoped file routes when rendered in a public share", () => {
    const projectId = toUrlProjectId("/local/graehl/yepanywhere");

    render(
      <PublicShareProvider
        value={{
          projectId,
          relayUrl: "wss://relay.graehl.org/ws",
          relayUsername: "ygraehl",
          secret: "share-secret",
        }}
      >
        <FilePathLink
          projectId={projectId}
          filePath="/local/graehl/yepanywhere/ui-report/README.md"
          lineNumber={8}
          lineEnd={12}
          displayText="ui-report/README.md"
          viewMode="range"
        />
      </PublicShareProvider>,
    );

    const link = screen.getByRole("link", {
      name: /ui-report\/README\.md\s*:8/,
    });
    expect(link.getAttribute("href")).toBe(
      `/share/share-secret/file?path=ui-report%2FREADME.md&h=ygraehl&r=wss%3A%2F%2Frelay.graehl.org%2Fws&projectId=${projectId}&line=8&lineEnd=12&view=range`,
    );
  });
});
