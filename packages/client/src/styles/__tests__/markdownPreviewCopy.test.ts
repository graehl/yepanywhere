// @vitest-environment node

import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const stylesheetUrl = new URL("../renderers.css", import.meta.url);

let browser: Browser;
let context: BrowserContext;
let page: Page;
let server: Server;

function stylesFor(html: string, tag: string): string[] {
  return Array.from(
    html.matchAll(new RegExp(`<${tag}[^>]*style="([^"]*)"`, "g")),
    (match) => match[1] ?? "",
  );
}

describe("Markdown preview rich-text copy", () => {
  beforeAll(async () => {
    const css = await readFile(stylesheetUrl, "utf8");
    server = createServer((_request, response) => {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(`<!doctype html>
        <style>
          :root {
            --bg-code: #181818;
            --bg-secondary: #202020;
            --border-color: #555;
            --markdown-preview-font-size-offset: 0px;
            --markdown-preview-vspace-offset: 0px;
            --output-prose-font-family: sans-serif;
            --output-prose-font-optical-sizing: auto;
            --output-prose-font-size: 14px;
            --output-prose-font-variation-settings: normal;
            --output-prose-line-height-offset: 0px;
            --output-prose-vspace-offset: 0px;
            --text-primary: #eeeeee;
          }
          ${css}
        </style>
        <div class="markdown-preview">
          <div class="markdown-rendered">
            <table><thead><tr><th>model</th><th>n</th></tr></thead></table>
            <p>Inline <code>code</code></p>
            <pre><code>block code</code></pre>
          </div>
        </div>
        <script>
          const preview = document.querySelector(".markdown-preview");
          preview.addEventListener("copy", () => {
            preview.classList.add("markdown-preview-copy-light");
            setTimeout(() => preview.classList.remove("markdown-preview-copy-light"), 0);
          });
        </script>`);
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const { port } = server.address() as AddressInfo;

    browser = await chromium.launch();
    context = await browser.newContext({
      permissions: ["clipboard-read", "clipboard-write"],
    });
    page = await context.newPage();
    await page.goto(`http://127.0.0.1:${port}`);
  }, 30_000);

  afterAll(async () => {
    await context?.close();
    await browser?.close();
    await new Promise<void>((resolve, reject) => {
      server?.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("copies a light palette without changing the displayed dark theme", async () => {
    const displayedHeader = await page
      .locator("th")
      .first()
      .evaluate((node) => {
        const style = getComputedStyle(node);
        return { background: style.backgroundColor, color: style.color };
      });
    expect(displayedHeader).toEqual({
      background: "rgb(32, 32, 32)",
      color: "rgb(238, 238, 238)",
    });

    await page.locator(".markdown-rendered").selectText();
    await page.keyboard.press("Control+c");
    const html = await page.evaluate(async () => {
      const item = (await navigator.clipboard.read())[0];
      if (!item) {
        throw new Error("Browser clipboard did not contain an item");
      }
      return (await item.getType("text/html")).text();
    });

    const headerStyles = stylesFor(html, "th");
    expect(headerStyles).toHaveLength(2);
    for (const style of headerStyles) {
      expect(style).toContain("rgb(246, 248, 250)");
      expect(style).toContain("color: rgb(31, 35, 40)");
    }

    const inlineCodeStyle = stylesFor(html, "code").find((style) =>
      style.includes("rgb(246, 248, 250)"),
    );
    expect(inlineCodeStyle).toContain("color: rgb(31, 35, 40)");

    const blockCodeStyle = stylesFor(html, "pre")[0];
    expect(blockCodeStyle).toContain("rgb(246, 248, 250)");
    expect(blockCodeStyle).toContain("color: rgb(31, 35, 40)");

    await expect
      .poll(() =>
        page.locator(".markdown-preview").evaluate((node) => node.className),
      )
      .not.toContain("markdown-preview-copy-light");
    const restoredHeader = await page
      .locator("th")
      .first()
      .evaluate((node) => {
        const style = getComputedStyle(node);
        return { background: style.backgroundColor, color: style.color };
      });
    expect(restoredHeader).toEqual(displayedHeader);
  });
});
