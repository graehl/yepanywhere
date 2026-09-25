import { describe, expect, it, vi } from "vitest";
import {
  buildPlayableHtml,
  buildPublicSharePlayUrl,
  isInlinableReference,
  KEEP_FRAGMENT_LINKS_IN_FRAME_SCRIPT,
  parsePublicSharePlayUrl,
  publicSharePlayUrlFromFileShareUrl,
  resolveShareReference,
} from "../publicSharePlay";

describe("public share play links", () => {
  it("round-trips the grant with the secret in the fragment", () => {
    const href = buildPublicSharePlayUrl("/remote", {
      relayUsername: "host",
      relayUrl: "wss://relay.example/ws",
      secret: "s3cr3t",
      projectId: "cHJvag",
      path: "_build/paper.html",
    });
    expect(href).toBe(
      "/remote/play.html?h=host&projectId=cHJvag&path=_build%2Fpaper.html&r=wss%3A%2F%2Frelay.example%2Fws#share=s3cr3t",
    );
    expect(parsePublicSharePlayUrl(`https://ya.example${href}`)).toEqual({
      relayUsername: "host",
      relayUrl: "wss://relay.example/ws",
      secret: "s3cr3t",
      projectId: "cHJvag",
      path: "_build/paper.html",
    });
    expect(parsePublicSharePlayUrl("https://ya.example/play.html")).toBeNull();
  });

  it("derives the play link from a file share link and keeps its prefix", () => {
    expect(
      publicSharePlayUrlFromFileShareUrl(
        "https://ya.example/share/abc_123/file?h=host&projectId=cHJvag&path=a%2Fb.html&standalone=1&r=wss%3A%2F%2Frelay.example%2Fws#v=2&target=file",
      ),
    ).toBe(
      "https://ya.example/play.html?h=host&projectId=cHJvag&path=a%2Fb.html&r=wss%3A%2F%2Frelay.example%2Fws#share=abc_123",
    );
    expect(
      publicSharePlayUrlFromFileShareUrl(
        "https://ya.example/remote/share/abc/file?h=host&projectId=p&path=x.html",
      ),
    ).toBe(
      "https://ya.example/remote/play.html?h=host&projectId=p&path=x.html#share=abc",
    );
    expect(
      publicSharePlayUrlFromFileShareUrl("https://ya.example/share/abc"),
    ).toBeNull();
  });
});

describe("public share play", () => {
  it("resolves references against the root's directory", () => {
    expect(resolveShareReference("_build/paper.html", "canvas.css")).toBe(
      "_build/canvas.css",
    );
    expect(resolveShareReference("_build/paper.html", "../img/a.png")).toBe(
      "img/a.png",
    );
    expect(resolveShareReference("_build/paper.html", "/site/x.js?v=1")).toBe(
      "site/x.js",
    );
    expect(isInlinableReference("https://cdn.example/x.js")).toBe(false);
    expect(isInlinableReference("//cdn.example/x.js")).toBe(false);
    expect(isInlinableReference("data:text/plain,x")).toBe(false);
    expect(isInlinableReference("#top")).toBe(false);
    expect(isInlinableReference("app.js")).toBe(true);
  });

  it("inlines served assets as data URLs and leaves the rest untouched", async () => {
    const fetchAsset = vi.fn(async (path: string) => {
      if (path === "_build/canvas.css")
        return new Blob(["body{color:red}"], { type: "text/css" });
      if (path === "_build/app.js")
        return new Blob(["console.log(1)"], { type: "text/javascript" });
      throw new Error("not served");
    });
    const html = await buildPlayableHtml(
      `<!doctype html><html><head><base href="/x/"><link rel="stylesheet" href="canvas.css"><script src="app.js"></script><script src="https://cdn.example/lib.js"></script></head><body><img src="missing.png"><p>Hi</p></body></html>`,
      "_build/paper.html",
      fetchAsset,
    );
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).not.toContain("<base");
    expect(html).toContain(
      `<head><script>${KEEP_FRAGMENT_LINKS_IN_FRAME_SCRIPT}</script>`,
    );
    expect(html).toContain('href="data:text/css;base64,');
    expect(html).toContain('src="data:text/javascript;base64,');
    expect(html).toContain('src="https://cdn.example/lib.js"');
    expect(html).toContain('src="missing.png"');
    expect(fetchAsset).toHaveBeenCalledTimes(3);
  });
});
