import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { e2ePaths, expect, test } from "./fixtures.js";
import { recordUiCapture } from "./support/ui-capture.js";

let projectId: string;
let projectPath: string;

test.beforeAll(() => {
  projectPath = join(e2ePaths.tempDir, "file-browser-project");
  projectId = Buffer.from(projectPath).toString("base64url");
});

test.describe("Files API", () => {
  test("previews large HTML without an artifact service", async ({ page }) => {
    const filename =
      "research/pii/frontier/papers/multilingual-pii-redaction/_build/paper-canvas.html";
    await mkdir(dirname(join(projectPath, filename)), { recursive: true });
    await writeFile(
      join(projectPath, filename),
      `<!doctype html><html><body><h1>Large paper</h1><!--${"x".repeat(3 * 1024 * 1024)}--><p>End of complete document</p></body></html>`,
    );
    let artifactRequests = 0;
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/artifacts") {
        artifactRequests += 1;
      }
    });
    await page.goto(`/projects/${projectId}/file?path=${filename}`);
    const frame = page.frameLocator('iframe[aria-label="paper-canvas.html"]');
    await expect(
      frame.getByRole("heading", { name: "Large paper" }),
    ).toBeVisible();
    await expect(frame.getByText("End of complete document")).toBeVisible();
    await expect(
      page.locator('iframe[aria-label="paper-canvas.html"]'),
    ).toHaveAttribute("sandbox", "allow-same-origin");
    expect(artifactRequests).toBe(0);
    await expect(
      page.getByRole("button", { name: "Edit mode", exact: true }),
    ).toBeVisible();
    for (const viewport of [
      { width: 1000, height: 600 },
      { width: 865, height: 600 },
      { width: 375, height: 812 },
    ]) {
      await page.setViewportSize(viewport);
      await expect(frame.getByText("End of complete document")).toBeVisible();
      const header = page.locator(".file-viewer-header");
      const path = header.locator(".file-viewer-path");
      await expect(path).toHaveText(filename);
      if (viewport.width <= 865) {
        const [pathBox, controlsBox] = await Promise.all([
          path.boundingBox(),
          header.locator(".file-viewer-actions").boundingBox(),
        ]);
        expect(pathBox).not.toBeNull();
        expect(controlsBox).not.toBeNull();
        expect(pathBox!.y + pathBox!.height).toBeLessThanOrEqual(
          controlsBox!.y,
        );
      }
      if (viewport.width > 375) {
        await expect(header).not.toHaveAttribute("data-actions-below");
      } else {
        // The header mounts after the loading state; measurement must still
        // attach and move the actions below the context row on a phone.
        await expect(header).toHaveAttribute("data-actions-below", "true");
        const controlsBox = await header
          .locator(".file-viewer-actions")
          .boundingBox();
        expect(controlsBox!.height).toBeLessThan(100);
      }
      await recordUiCapture(page, `large-html-${viewport.width}`, viewport);
    }
  });

  test("returns file content for text files", async ({ request }) => {
    const response = await request.get(
      `/api/projects/${projectId}/files?path=test.txt`,
    );

    expect(response.ok()).toBe(true);
    const data = await response.json();
    expect(data.metadata.path).toBe("test.txt");
    expect(data.metadata.isText).toBe(true);
    expect(data.content).toBe("Hello from test file!");
    expect(data.rawUrl).toContain("/files/raw");
  });

  test("returns raw file with correct content-type", async ({ request }) => {
    const response = await request.get(
      `/api/projects/${projectId}/files/raw?path=data.json`,
    );

    expect(response.ok()).toBe(true);
    expect(response.headers()["content-type"]).toBe("application/json");
    const text = await response.text();
    expect(text).toBe('{"key": "value"}');
  });

  test("sets attachment disposition for downloads", async ({ request }) => {
    const response = await request.get(
      `/api/projects/${projectId}/files/raw?path=test.txt&download=true`,
    );

    expect(response.ok()).toBe(true);
    expect(response.headers()["content-disposition"]).toContain("attachment");
    expect(response.headers()["content-disposition"]).toContain("test.txt");
  });

  test("downloads active project documents instead of executing them", async ({
    baseURL,
    page,
    request,
  }) => {
    const activeDocuments = [
      {
        filename: "hostile.html",
        url: `/api/projects/${projectId}/files/raw?path=hostile.html`,
      },
      {
        filename: "hostile.svg",
        url: `/api/projects/${projectId}/files/raw?path=hostile.svg`,
      },
      {
        filename: "hostile.html",
        url: `/api/local-file?path=${encodeURIComponent(join(projectPath, "hostile.html"))}`,
      },
    ];

    for (const { filename, url } of activeDocuments) {
      const response = await request.get(url);
      expect(response.ok()).toBe(true);
      expect(response.headers()["content-disposition"]).toContain("attachment");
      expect(response.headers()["content-security-policy"]).toContain(
        "script-src 'none'",
      );

      await page.goto(baseURL);
      await page.setContent(
        `<a id="active-file" href="${baseURL}${url}">Open active file</a>`,
      );
      const downloadPromise = page.waitForEvent("download");
      await page.locator("#active-file").click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toBe(filename);
      await expect(page).not.toHaveTitle("EXECUTED");
    }
  });

  test("rejects path traversal attempts", async ({ request }) => {
    const response = await request.get(
      `/api/projects/${projectId}/files?path=../../../etc/passwd`,
    );

    expect(response.status()).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("Invalid file path");
  });

  test("returns 404 for non-existent files", async ({ request }) => {
    const response = await request.get(
      `/api/projects/${projectId}/files?path=does-not-exist.txt`,
    );

    expect(response.status()).toBe(404);
    const data = await response.json();
    expect(data.error).toBe("File not found");
  });
});
