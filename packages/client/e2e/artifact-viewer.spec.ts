import { createRequire } from "node:module";
import { createServer as createHttpServer, request } from "node:http";
import {
  cp,
  copyFile,
  mkdir,
  mkdtemp,
  rm,
  readFile,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { createTestViteServer as createViteServer } from "./support/vite-server";
import { createApp } from "../../server/test/setup/create-app";
import { createFrontendProxy } from "../../server/src/frontend/proxy";
import { MockClaudeSDK } from "../../server/src/sdk/mock";
import { ServerSettingsService } from "../../server/src/services/ServerSettingsService";
import { initFileAccess } from "../../server/src/middleware/file-access";
import { recordUiCapture } from "./support/ui-capture";
import { presentUiCaptures } from "./support/ui-capture";

const clientRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serverRequire = createRequire(join(clientRoot, "../server/package.json"));
const { getRequestListener } = serverRequire("@hono/node-server");
let vite: Awaited<ReturnType<typeof createViteServer>>;
let instance: ReturnType<typeof createApp>;
let listener: ReturnType<typeof createHttpServer>;
let directory: string;
let base: string;
let entry: string;

test.beforeAll(async () => {
  const scratch = resolve(clientRoot, "../../.artifacts/artifact-browser");
  await mkdir(scratch, { recursive: true });
  directory = await mkdtemp(join(scratch, "run-"));
  const bundle = join(directory, "bundle");
  await cp(resolve(clientRoot, "../server/test/fixtures/artifact"), bundle, {
    recursive: true,
  });
  await copyFile(
    join(
      dirname(serverRequire.resolve("katex/package.json")),
      "dist/fonts/KaTeX_Main-Regular.woff2",
    ),
    join(bundle, "font.woff2"),
  );
  entry = join(bundle, "index.html");
  const settings = new ServerSettingsService({
    dataDir: join(directory, "data"),
  });
  await settings.initialize();
  initFileAccess({
    uploadsDir: directory,
    homeDir: directory,
    tempPaths: [directory],
    envPaths: [directory],
  });
  process.env.VITE_DISABLE_ONBOARDING = "true";
  process.env.VITE_DISABLE_CLI_UPDATE_NOTIFICATIONS = "true";
  vite = await createViteServer({
    root: clientRoot,
    server: { port: 0, host: "127.0.0.1" },
  });
  await vite.listen();
  const viteAddress = vite.httpServer?.address();
  if (!viteAddress || typeof viteAddress === "string")
    throw new Error("Missing Vite port");
  instance = createApp({
    sdk: new MockClaudeSDK(),
    dataDir: join(directory, "data"),
    projectsDir: join(directory, "sessions"),
    serverSettingsService: settings,
    frontendProxy: createFrontendProxy({
      vitePort: viteAddress.port,
      viteHost: "127.0.0.1",
    }),
  });
  listener = createHttpServer(getRequestListener(instance.app.fetch));
  await new Promise<void>((ready) => listener.listen(0, "127.0.0.1", ready));
  const address = listener.address();
  if (!address || typeof address === "string")
    throw new Error("Missing YA port");
  base = `http://localhost:${address.port}`;
  const reservation = createHttpServer();
  await new Promise<void>((ready) => reservation.listen(0, "127.0.0.1", ready));
  const artifactAddress = reservation.address();
  if (!artifactAddress || typeof artifactAddress === "string")
    throw new Error("Missing artifact port");
  await new Promise<void>((resolve, reject) =>
    reservation.close((error) => (error ? reject(error) : resolve())),
  );
  await instance.artifactServer.configure({
    port: artifactAddress.port,
    localOrigin: `http://artifacts.localhost:${address.port}`,
  });
});

test.afterEach(async ({ page }) => {
  // Saving settings refreshes version metadata. Let intercepted responses
  // finish before Playwright closes the browser context.
  await page.unrouteAll({ behavior: "wait" });
});

test.afterAll(async () => {
  await presentUiCaptures();
  if (listener) {
    listener.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      listener.close((error) => (error ? reject(error) : resolve())),
    );
  }
  if (instance) await instance.disposeSessionReaders();
  if (vite) await vite.close();
  if (directory) await rm(directory, { recursive: true });
});

test("edits mapped source from default sanitized HTML and preserves a stale preview", async ({
  page,
}) => {
  const sourcePath = join(directory, "bundle", "section.qmd");
  const htmlPath = join(directory, "bundle", "editable.html");
  const original = `# Title\n\nThe original paragraph.\n${"Context line\n".repeat(3000)}`;
  await writeFile(sourcePath, original);
  await writeFile(
    htmlPath,
    `<!doctype html><html><head><style>body{font:20px Georgia;padding:32px;line-height:1.5}</style></head><body><h1>Field notes</h1><!-- ya-source-target:v1 {"id":"intro","source":"section.qmd","sourceRange":[[2,0],[3,0]]} --><p>The original paragraph.</p><!-- /ya-source-target:v1 intro --></body></html>`,
  );
  await page.setViewportSize({ width: 1200, height: 600 });
  let unsupportedRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/artifacts")
      unsupportedRequests++;
  });
  await page.goto(
    `${base}/e2e/fixtures/artifact-viewer.html?editor&path=${encodeURIComponent(htmlPath)}`,
  );
  await expect(
    page
      .frameLocator(`iframe[title="editable.html"]`)
      .getByRole("heading", { name: "Field notes" }),
  ).toBeVisible();
  expect(unsupportedRequests).toBe(0);
  await page.getByRole("button", { name: "Edit mode", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Edit source" });
  await expect(dialog).toBeVisible();
  const preview = page.frameLocator('iframe[title="Preview"]');
  await preview.getByText("The original paragraph.").click();
  const textarea = dialog.getByRole("textbox", { name: "Source", exact: true });
  await expect(textarea).toHaveValue(original);
  expect(
    await textarea.evaluate(
      (input: HTMLTextAreaElement) => input.selectionStart,
    ),
  ).toBe(9);
  let typed = "";
  const updatesBefore = Number(
    await page.getByTestId("background-updates").getAttribute("data-updates"),
  );
  for (const character of "New text. ") {
    typed += character;
    await textarea.pressSequentially(character);
    await expect(textarea).toHaveValue(
      original.slice(0, 9) + typed + original.slice(9),
      { timeout: 100 },
    );
  }
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText("Source saved");
  expect(
    Number(
      await page.getByTestId("background-updates").getAttribute("data-updates"),
    ),
  ).toBeGreaterThan(updatesBefore);
  expect(await readFile(sourcePath, "utf8")).toBe(
    original.replace("The original", "New text. The original"),
  );
  await expect(preview.getByText("The original paragraph.")).toBeVisible();
  await expect(
    dialog.getByText(/line references may now be stale/),
  ).toBeVisible();
  await recordUiCapture(page, "source-editor-desktop", {
    width: 1200,
    height: 600,
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(textarea).toBeVisible();
  await recordUiCapture(page, "source-editor-phone", {
    width: 375,
    height: 812,
  });
  await textarea.pressSequentially("Keep draft");
  await writeFile(sourcePath, "External writer\n");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("file changed");
  await expect(textarea).toHaveValue(/Keep draft/);
  expect(await readFile(sourcePath, "utf8")).toBe("External writer\n");
});

test("viewer icon modes toggle locally and open through Shift and middle clicks", async ({
  page,
  context,
}) => {
  const htmlPath = join(directory, "bundle", "mode-controls.html");
  await writeFile(htmlPath, "<!doctype html><h1>Viewer mode controls</h1>");
  await page.goto(
    `${base}/e2e/fixtures/artifact-viewer.html?editor&path=${encodeURIComponent(htmlPath)}`,
  );
  const edit = page.getByRole("button", { name: "Edit mode", exact: true });
  const run = page.getByRole("button", {
    name: "Run full HTML/CSS/JavaScript preview (current view is sanitized)",
    exact: true,
  });
  await expect(edit).toHaveAttribute("aria-pressed", "false");
  await expect(run).toHaveAttribute("aria-pressed", "false");
  for (const control of [edit, run]) {
    const box = await control.boundingBox();
    expect(box?.width).toBe(36);
    expect(box?.height).toBe(36);
    expect(await control.locator("svg").count()).toBe(1);
    for (const gesture of ["shift", "middle"]) {
      const opened = context.waitForEvent("page");
      await control.click(
        gesture === "shift" ? { modifiers: ["Shift"] } : { button: "middle" },
      );
      const tab = await opened;
      await tab.waitForURL("**/file-view?**");
      if (control === edit) {
        await expect(
          tab.getByRole("dialog", { name: "Edit source", exact: true }),
        ).toBeVisible();
        await expect(
          tab.getByRole("button", { name: "Exit edit mode" }),
        ).toHaveAttribute("aria-pressed", "true");
      } else {
        await expect(
          tab.getByRole("button", { name: "Stop interactive preview" }),
        ).toHaveAttribute("aria-pressed", "true");
      }
      await expect(control).toHaveAttribute("aria-pressed", "false");
      await tab.close();
    }
  }
  await run.click();
  const stop = page.getByRole("button", { name: "Stop interactive preview" });
  await expect(stop).toHaveAttribute("aria-pressed", "true");
  await stop.click();
  await expect(run).toHaveAttribute("aria-pressed", "false");
  await expect(
    page.locator('iframe[title="mode-controls.html"]'),
  ).toHaveAttribute("sandbox", "allow-same-origin");
});

test("finds within a running artifact frame only, from its own Ctrl+F", async ({
  page,
}) => {
  const htmlPath = join(directory, "bundle", "findable.html");
  await writeFile(
    htmlPath,
    `<!doctype html><title>Findable</title><p>alpha beta</p><p>beta gamma</p><div style="height:3000px"></div><p id="last">last beta</p>`,
  );
  const grant = await instance.artifactServer.createGrant(htmlPath, "local");
  await page.setViewportSize({ width: 1200, height: 600 });
  await page.goto(
    `${base}/file-view?mode=interactive&artifactUrl=${encodeURIComponent(grant.url)}`,
  );
  const findBox = page.getByRole("searchbox", { name: "Find in this view" });
  // The agent announced itself, and a desktop header has room for the field.
  await expect(findBox).toBeVisible();
  const frame = page.frameLocator('iframe[title="findable.html"]');
  await frame.getByText("alpha beta").click();
  await page.keyboard.press("Control+f");
  await expect(findBox).toBeFocused();
  await page.keyboard.type("beta");
  const count = page.getByRole("search").getByText("1/3");
  await expect(count).toBeVisible();
  // The viewer page's own URL names the file too, so match the frame's origin.
  const child = page
    .frames()
    .find((f) => new URL(f.url()).hostname === "artifacts.localhost");
  if (!child) throw new Error("Missing artifact frame");
  expect(await child.evaluate(() => CSS.highlights.get("yep-find")?.size)).toBe(
    3,
  );
  // The YA page's own text is not searched.
  expect(
    await page.evaluate(() => CSS.highlights.get("yep-find")?.size ?? 0),
  ).toBe(0);
  await page.keyboard.press("Shift+Enter");
  await expect(page.getByRole("search").getByText("3/3")).toBeVisible();
  await expect(frame.locator("#last")).toBeInViewport();
  await recordUiCapture(page, "viewer-find-artifact-1200");
  await page.keyboard.press("Escape");
  await expect(findBox).toHaveValue("");
  expect(
    await child.evaluate(() => CSS.highlights.get("yep-find")?.size ?? 0),
  ).toBe(0);
  // Focus is back in the frame, so its Ctrl+F reopens the field.
  await page.keyboard.press("Control+f");
  await expect(findBox).toBeFocused();
  await page.setViewportSize({ width: 375, height: 812 });
  await page.keyboard.type("gamma");
  await expect(page.getByRole("search").getByText("1/1")).toBeVisible();
  await recordUiCapture(page, "viewer-find-artifact-375");
});

test("finds within the scriptless preview without giving it scripts", async ({
  page,
}) => {
  const htmlPath = join(directory, "bundle", "static-find.html");
  await writeFile(
    htmlPath,
    "<!doctype html><h1>Static find</h1><p>needle one</p><p>needle two</p>",
  );
  await page.setViewportSize({ width: 1200, height: 600 });
  await page.goto(
    `${base}/e2e/fixtures/artifact-viewer.html?editor&path=${encodeURIComponent(htmlPath)}`,
  );
  const preview = page.locator('iframe[title="static-find.html"]');
  await expect(preview).toHaveAttribute("sandbox", "allow-same-origin");
  const frame = page.frameLocator('iframe[title="static-find.html"]');
  await expect(frame.getByText("needle one")).toBeVisible();
  await recordUiCapture(page, "viewer-find-local-idle-1200");
  await frame.getByText("needle one").click();
  await page.keyboard.press("Control+f");
  const findBox = page.getByRole("searchbox", { name: "Find in this view" });
  await expect(findBox).toBeFocused();
  // Typed into the field while the fixture re-renders every 25ms.
  await page.keyboard.type("needle", { delay: 20 });
  await expect(findBox).toHaveValue("needle");
  await expect(page.getByRole("search").getByText("1/2")).toBeVisible();
  await recordUiCapture(page, "viewer-find-local-1200");
  const child = page
    .frames()
    .find((candidate) => candidate.url().startsWith("about:srcdoc"));
  if (!child) throw new Error("Missing preview frame");
  expect(
    await preview.evaluate(
      (element: HTMLIFrameElement) =>
        (element.contentWindow as typeof globalThis | null)?.CSS.highlights.get(
          "yep-find",
        )?.size,
    ),
  ).toBe(2);
  // Same-origin grants the viewer access, not the preview any scripts: a
  // script element added to the document does not run.
  expect(
    await child.evaluate(() => {
      const script = document.createElement("script");
      script.textContent = "document.title = 'ran'";
      document.body.append(script);
      return document.title;
    }),
  ).toBe("");
});

test("sanitized preview section links scroll within the document", async ({
  page,
}) => {
  const htmlPath = join(directory, "bundle", "sections.html");
  await writeFile(
    htmlPath,
    '<!doctype html><base href="https://example.invalid/"><p><a href="#far">Jump to far section</a></p><div style="height:4000px"></div><h2 id="far">Far section</h2><div style="height:1000px"></div>',
  );
  await page.goto(
    `${base}/e2e/fixtures/artifact-viewer.html?editor&path=${encodeURIComponent(htmlPath)}`,
  );
  const preview = page.frameLocator('iframe[title="sections.html"]');
  await preview.getByRole("link", { name: "Jump to far section" }).click();
  // Resolving against the embedding page would navigate the frame to YA.
  await expect(
    preview.getByRole("heading", { name: "Far section" }),
  ).toBeInViewport();
  const frame = page
    .frames()
    .find((candidate) => candidate.url().startsWith("about:srcdoc"));
  expect(frame?.url()).toBe("about:srcdoc#far");
});

test("artifact Edit links open an authenticated editor tab and preserve the original view", async ({
  page,
  context,
}) => {
  const grant = await instance.artifactServer.createGrant(entry, "local");
  await page.goto(
    `${base}/file-view?mode=edit&artifactUrl=${encodeURIComponent(grant.url)}`,
  );
  await page.getByRole("button", { name: "Exit edit mode" }).click();
  const edit = page.getByRole("button", { name: "Edit mode", exact: true });
  for (const gesture of ["shift", "middle"]) {
    const opened = context.waitForEvent("page");
    await edit.click(
      gesture === "shift" ? { modifiers: ["Shift"] } : { button: "middle" },
    );
    const tab = await opened;
    await expect(
      tab.getByRole("dialog", { name: "Edit source", exact: true }),
    ).toBeVisible();
    await expect(
      tab.getByRole("textbox", { name: "Source", exact: true }),
    ).toHaveValue(/<!doctype html>/i);
    await expect(edit).toHaveAttribute("aria-pressed", "false");
    await tab.close();
  }
});

test("edits ordinary HTML without source maps and hides Edit on older servers", async ({
  page,
}) => {
  const htmlPath = join(directory, "bundle", "plain.html");
  await writeFile(htmlPath, "<!doctype html><p>Plain HTML</p>");
  const url = `${base}/e2e/fixtures/artifact-viewer.html?editor&path=${encodeURIComponent(htmlPath)}`;
  await page.goto(url);
  await page.getByRole("button", { name: "Edit mode", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Edit source" });
  const text = dialog.getByRole("textbox", { name: "Source", exact: true });
  await expect(text).toHaveValue("<!doctype html><p>Plain HTML</p>");
  await text.press("End");
  await text.pressSequentially("<!-- saved -->");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect
    .poll(() => readFile(htmlPath, "utf8"))
    .toContain("<!-- saved -->");
  await dialog.getByRole("button", { name: "Exit edit mode" }).click();
  await page.route("**/api/version*", (route) =>
    route.fulfill({
      json: { current: "0.9.0", capabilityEncoding: 1, capabilityBits: [] },
    }),
  );
  let newRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/file-edit") newRequests++;
  });
  await page.goto(url);
  await expect(
    page.frameLocator('iframe[title="plain.html"]').getByText("Plain HTML"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Edit mode", exact: true }),
  ).toHaveCount(0);
  expect(newRequests).toBe(0);
});

test("loads the bundle through the same port, preserves scripts, and denies YA access", async ({
  page,
}, testInfo) => {
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(error.message));
  await page.setViewportSize({ width: 1000, height: 600 });
  await page.goto(
    `${base}/e2e/fixtures/artifact-viewer.html?path=${encodeURIComponent(entry)}`,
  );
  await page
    .getByRole("button", { name: "Run full HTML/CSS/JavaScript preview" })
    .click();
  const frame = page.frameLocator("iframe");
  await expect(frame.getByRole("status")).toHaveText("3 sample notes");
  await frame.getByRole("button", { name: "Menu", exact: true }).click();
  await expect(
    frame.getByRole("link", { name: "Project details" }),
  ).toBeVisible();
  await frame.getByPlaceholder("Write something").fill("A saved idea");
  await frame.getByRole("button", { name: "Save note" }).click();
  await expect(frame.getByRole("status")).toHaveText("Note saved");
  const child = page.frames().find((frame) => frame.url().includes("/a/"));
  if (!child) throw new Error("Missing artifact frame");
  expect(
    await child.evaluate(async () => {
      await document.fonts.ready;
      return document.fonts.check("17px ArtifactFont");
    }),
  ).toBe(true);
  expect(
    await child.evaluate(() => localStorage.getItem("artifact-note")),
  ).toBe("A saved idea");
  expect(
    await child.evaluate(() => {
      try {
        return parent.document.title;
      } catch {
        return "blocked";
      }
    }),
  ).toBe("blocked");
  expect(
    await child.evaluate(async () => (await fetch("/api/version")).status),
  ).toBe(404);
  const artifacts = resolve(
    clientRoot,
    "../../.artifacts/ui-testing/2026-09-07-artifact-viewer",
  );
  await mkdir(artifacts, { recursive: true });
  await child.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: join(artifacts, `${testInfo.project.name}-desktop.png`),
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await child.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: join(artifacts, `${testInfo.project.name}-phone.png`),
  });
  await frame.getByRole("link", { name: "Project details" }).click();
  await expect(
    frame.getByRole("heading", { name: "Project details" }),
  ).toBeVisible();
  expect(problems).toEqual([]);
  const url = child.url();
  await page.getByRole("button", { name: "Stop interactive preview" }).click();
  await expect(
    page.getByRole("button", { name: "Run full HTML/CSS/JavaScript preview" }),
  ).toBeVisible();
  await expect(
    frame.getByRole("heading", { name: "Static preview" }),
  ).toBeVisible();
  // Stopping this view preserves a borrowed URL already opened in another tab.
  expect((await instance.artifactServer.app.request(url)).status).toBe(200);
});

test("saves artifact expiry without revoking links, alongside addresses and port", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1000, height: 600 });
  await page.goto(`${base}/e2e/fixtures/artifact-viewer.html?settings`);
  await expect(
    page.getByRole("heading", { name: "Interactive HTML artifacts" }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Local artifact address", { exact: true }),
  ).toHaveValue(instance.artifactServer.config.localOrigin!);
  const original = await instance.artifactServer.createGrant(entry, "local");
  const slider = page.getByRole("slider", { name: "Link expiry (days)" });
  await expect(slider).toHaveValue("7");
  await slider.focus();
  await slider.press("Home");
  await slider.press("ArrowRight");
  await expect(slider).toHaveValue("2");
  const numeric = page.getByRole("spinbutton", { name: "Link expiry (days)" });
  await expect(numeric).toHaveValue("2");
  await numeric.fill("12");
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/artifacts/config") &&
      response.request().method() === "PUT" &&
      response.request().postDataJSON().expiryDays === 12,
  );
  await numeric.press("Tab");
  await expect(slider).toHaveValue("12");
  expect((await saved).ok()).toBe(true);
  await expect.poll(() => instance.artifactServer.config.expiryDays).toBe(12);
  const persisted = new ServerSettingsService({
    dataDir: join(directory, "data"),
  });
  await persisted.initialize();
  expect(persisted.getSetting("artifactViewer")?.expiryDays).toBe(12);
  expect(
    (
      await instance.artifactServer.app.request(original.url, {
        method: "HEAD",
      })
    ).status,
  ).toBe(200);
  const start = Date.now();
  const shorter = await instance.artifactServer.createGrant(entry, "local");
  const twelveDays = 12 * 24 * 3600_000;
  expect(shorter.expiresAt).toBeGreaterThanOrEqual(start + twelveDays);
  expect(shorter.expiresAt).toBeLessThanOrEqual(Date.now() + twelveDays);
  await page
    .getByLabel("Public artifact address (optional)")
    .fill("https://artifacts.example.test");
  await page.getByLabel("Public artifact address (optional)").press("Tab");
  await expect
    .poll(() => instance.artifactServer.config.publicOrigin)
    .toBe("https://artifacts.example.test");
  const health = await new Promise<{ status: number; body: string }>(
    (resolve, reject) => {
      const req = request(
        {
          hostname: "127.0.0.1",
          port: instance.artifactServer.config.port,
          path: "/health",
          headers: { Host: "artifacts.example.test" },
        },
        (response) => {
          let body = "";
          response.setEncoding("utf8");
          response.on("data", (chunk) => {
            body += chunk;
          });
          response.on("end", () =>
            resolve({ status: response.statusCode ?? 0, body }),
          );
        },
      );
      req.on("error", reject);
      req.end();
    },
  );
  expect(health).toEqual({ status: 200, body: '{"artifactViewer":1}' });
  await page
    .getByLabel("Public vhost root (optional)")
    .fill("apps.example.test");
  await page.getByLabel("Public vhost root (optional)").press("Tab");
  await page.getByLabel("Always rewrite *.localhost app links").check();
  await expect
    .poll(() => instance.artifactServer.config)
    .toMatchObject({
      vhostPublicRoot: "apps.example.test",
      alwaysRewriteVhostLinks: true,
    });
  await page
    .getByLabel("Always rewrite *.localhost app links")
    .scrollIntoViewIfNeeded();
  await recordUiCapture(page, `${testInfo.project.name}-settings-desktop`);
  await page.setViewportSize({ width: 375, height: 812 });
  await page
    .getByLabel("Always rewrite *.localhost app links")
    .scrollIntoViewIfNeeded();
  await recordUiCapture(page, `${testInfo.project.name}-settings-phone`);
  await page.getByLabel("Public artifact address (optional)").fill("");
  await page.getByLabel("Enable local artifact access").uncheck();
  await expect.poll(() => instance.artifactServer.available).toBe(false);
});

test("shows the public-copy action in the artifact link menu", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1000, height: 600 });
  await page.goto(`${base}/e2e/fixtures/artifact-viewer.html?menu`);
  await expect(page.getByRole("menuitem")).toHaveText([
    "Open",
    "Download",
    "Copy public URL",
  ]);
  await recordUiCapture(page, `${testInfo.project.name}-public-menu-desktop`);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.reload();
  await recordUiCapture(page, `${testInfo.project.name}-public-menu-phone`);
});

test("omits expiry controls and writes when older metadata lacks the field", async ({
  page,
}) => {
  await instance.artifactServer.configure({
    ...instance.artifactServer.config,
    expiryDays: 2,
  });
  await page.route("**/api/version*", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    // An older server advertises neither unit, so no expiry control appears.
    delete body.artifactViewer.expiryHours;
    delete body.artifactViewer.expiryDays;
    await route.fulfill({ response, json: body });
  });
  await page.goto(`${base}/e2e/fixtures/artifact-viewer.html?settings`);
  await expect(
    page.getByRole("heading", { name: "Interactive HTML artifacts" }),
  ).toBeVisible();
  await expect(page.getByRole("slider")).toHaveCount(0);
  await expect(
    page.getByRole("spinbutton", { name: "Link expiry (days)" }),
  ).toHaveCount(0);
  const write = page.waitForRequest(
    (request) =>
      request.url().endsWith("/api/artifacts/config") &&
      request.method() === "PUT",
  );
  await page.getByLabel("Public artifact address (optional)").focus();
  await page.getByLabel("Public artifact address (optional)").press("Tab");
  expect((await write).postDataJSON()).not.toHaveProperty("expiryDays");
  await expect(page.getByRole("status")).toHaveText("Artifact settings saved");
  expect(instance.artifactServer.config.expiryDays).toBe(2);
});
