import type { Page, Route } from "@playwright/test";
import { expect, test } from "./fixtures.js";
import { recordUiCapture } from "./support/ui-capture.js";

// These cases own no seeded session draft.
test.use({ draftSessionIds: [] });
test.use({ serviceWorkers: "block" });

/** Hold every script request until released, so only inline code runs. */
async function holdScripts(page: Page): Promise<() => Promise<void>> {
  const held: Route[] = [];
  let releasing = false;
  await page.route("**/*", (route) => {
    if (releasing || route.request().resourceType() !== "script") {
      return route.continue();
    }
    held.push(route);
  });
  return async () => {
    releasing = true;
    await Promise.all(held.splice(0).map((route) => route.continue()));
  };
}

test("keys typed before the app loads reach the new-session composer", async ({
  page,
  baseURL,
}) => {
  // Wide enough for the saved desktop sidebar, which stays expanded.
  await page.setViewportSize({ width: 1400, height: 700 });
  await page.addInitScript(() => {
    localStorage.setItem(
      "draft-new-session:local",
      JSON.stringify({ version: 1, text: "Saved prompt: " }),
    );
    localStorage.setItem("yep-anywhere-sidebar-expanded", "true");
    localStorage.setItem("yep-anywhere-sidebar-width", "360");
    const samples: number[] = [];
    const moduleFallbacks: number[] = [];
    new MutationObserver(() => {
      if (document.querySelector('[data-startup-phase="module"]')) {
        moduleFallbacks.push(performance.now());
      }
    }).observe(document, { childList: true, subtree: true });
    let keyAt = 0;
    document.addEventListener(
      "keydown",
      () => {
        keyAt = performance.now();
      },
      true,
    );
    document.addEventListener(
      "input",
      () => {
        samples.push(performance.now() - keyAt);
      },
      true,
    );
    Object.assign(window, { typingSamples: samples, moduleFallbacks });
  });
  const release = await holdScripts(page);
  // DOMContentLoaded waits for the held module scripts, so only commit.
  await page.goto(`${baseURL}/new-session`, { waitUntil: "commit" });

  const preboot = page.locator("#yep-preboot-composer textarea");
  await expect(preboot).toBeFocused();
  await expect(preboot).toHaveValue("Saved prompt: ");
  // Route chunks must be discovered from HTML while all modules are held.
  await expect(
    page.locator('link[rel="modulepreload"][href*="/NewSessionPage-"]'),
  ).toHaveCount(1);
  await page.keyboard.type("typed before boot", { delay: 10 });
  // Enter sends in the app; it must not become a newline in the meantime.
  await page.keyboard.press("Enter");
  await expect(preboot).toHaveValue("Saved prompt: typed before boot");

  const earlyBox = await preboot.boundingBox();
  await release();

  const composer = page.locator("textarea.new-session-form-textarea");
  await expect(composer).toBeFocused({ timeout: 30_000 });
  await expect(page.locator("#yep-preboot-composer")).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { moduleFallbacks: number[] }).moduleFallbacks,
    ),
  ).toEqual([]);
  await page.keyboard.type(" and after", { delay: 10 });
  await expect(composer).toHaveValue(
    "Saved prompt: typed before boot and after",
  );

  await expect(page.locator(".sidebar-desktop")).toBeVisible();
  await expect(page.locator(".sidebar-desktop")).not.toHaveClass(
    /sidebar-collapsed/,
  );
  await expect(page.locator(".sidebar-floating-restore")).toHaveCount(0);
  const adoptedBox = await page
    .locator(".new-session-form .speech-draft-field")
    .boundingBox();
  expect(Math.abs(adoptedBox!.x - earlyBox!.x)).toBeLessThan(2);
  expect(Math.abs(adoptedBox!.width - earlyBox!.width)).toBeLessThan(2);
  const samples = await page.evaluate(
    () => (window as unknown as { typingSamples: number[] }).typingSamples,
  );
  expect(samples).toHaveLength("typed before boot and after".length);
  expect(Math.max(...samples)).toBeLessThan(100);
  // Let project/provider discovery settle before reviewing the final form.
  await page.waitForURL((url) => url.searchParams.has("projectId"));
  await expect(page.locator(".new-session-provider-slot")).toContainText(
    "Claude",
  );
  await expect(
    page.locator('a[title="Show project app while composing"]'),
  ).toHaveCount(0);
  await recordUiCapture(page, "new-session-expanded-1400");
  for (const viewport of [
    { width: 1000, height: 600 },
    { width: 375, height: 812 },
  ]) {
    await page.setViewportSize(viewport);
    await recordUiCapture(page, `new-session-default-${viewport.width}`);
  }
});

test("a reload before the app adopts the composer keeps what was typed", async ({
  page,
  baseURL,
}) => {
  const release = await holdScripts(page);
  await page.goto(`${baseURL}/new-session`, { waitUntil: "commit" });
  const preboot = page.locator("#yep-preboot-composer textarea");
  await expect(preboot).toBeFocused();
  await page.keyboard.type("typed before", { delay: 10 });

  // What a development source-version check or applied defaults do mid-boot.
  await page.reload({ waitUntil: "commit" });
  await expect(preboot).toBeFocused();
  await expect(preboot).toHaveValue("typed before");
  await page.keyboard.type(" a reload", { delay: 10 });

  await release();
  const composer = page.locator("textarea.new-session-form-textarea");
  await expect(composer).toBeFocused({ timeout: 30_000 });
  await expect(composer).toHaveValue("typed before a reload");
  // Adopted once: the stash is spent, so a later reload does not add it again.
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("yep-preboot-composer-text"),
    ),
  ).toBeNull();
});

test("route data arrives before the New Session module executes", async ({
  page,
  baseURL,
}) => {
  const mathRequests: string[] = [];
  page.on("request", (request) => {
    if (/\/assets\/katex-[^/]+\.js$/.test(new URL(request.url()).pathname)) {
      mathRequests.push(request.url());
    }
  });
  await page.addInitScript(() => {
    const observer = new MutationObserver(() => {
      const input = document.querySelector<HTMLInputElement>(
        ".new-session-project-input",
      );
      if (!input) return;
      Object.assign(window, { firstNewSessionProjectValue: input.value });
      observer.disconnect();
    });
    observer.observe(document, { childList: true, subtree: true });
  });
  const held: Route[] = [];
  let expectedProjectPath = "";
  let releasing = false;
  await page.route("**/assets/NewSessionPage-*.js", (route) => {
    if (releasing) return route.continue();
    held.push(route);
  });
  const responses = [
    "/api/settings",
    "/api/projects",
    "/api/recents",
    "/api/version",
    "/api/providers/claude",
  ].map((path) =>
    page.waitForResponse(
      (response) => new URL(response.url()).pathname === path && response.ok(),
    ),
  );
  try {
    await page.goto(`${baseURL}/new-session`, { waitUntil: "commit" });
    const [, projectsResponse] = await Promise.all(responses);
    const { projects } = await projectsResponse!.json();
    expectedProjectPath = projects[0].path;
    expect(held.length).toBeGreaterThan(0);
    await expect(page.locator(".new-session-form textarea")).toHaveCount(0);
  } finally {
    releasing = true;
    await Promise.all(held.map((route) => route.continue()));
  }
  await expect(page.locator(".new-session-form textarea")).toBeVisible();
  expect(mathRequests).toEqual([]);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { firstNewSessionProjectValue: string })
          .firstNewSessionProjectValue,
    ),
  ).toBe(expectedProjectPath);
  for (const viewport of [
    { width: 1000, height: 600 },
    { width: 375, height: 812 },
  ]) {
    await page.setViewportSize(viewport);
    await recordUiCapture(page, `initial-project-${viewport.width}`);
  }
});

test("other routes never show the pre-boot composer", async ({
  page,
  baseURL,
}) => {
  await page.goto(`${baseURL}/projects`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#yep-preboot-composer")).toHaveCount(0);
});

test("refresh preserves saved sidebar modes on New Session", async ({
  page,
  baseURL,
}) => {
  await page.setViewportSize({ width: 1400, height: 700 });
  for (const mode of ["expanded", "collapsed", "minimized"]) {
    await page.goto(`${baseURL}/projects`);
    await page.evaluate((mode) => {
      localStorage.setItem(
        "yep-anywhere-sidebar-expanded",
        String(mode === "expanded"),
      );
      localStorage.setItem(
        "yep-anywhere-sidebar-minimized",
        String(mode === "minimized"),
      );
    }, mode);
    await page.goto(`${baseURL}/new-session`);
    await expect(
      page.locator("textarea.new-session-form-textarea"),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.locator("textarea.new-session-form-textarea"),
    ).toBeVisible();
    if (mode === "minimized") {
      await expect(page.locator(".sidebar-floating-restore")).toBeVisible();
    } else {
      await expect(page.locator(".sidebar-desktop")).toBeVisible();
      if (mode === "collapsed")
        await expect(page.locator(".sidebar-desktop")).toHaveClass(
          /sidebar-collapsed/,
        );
      else
        await expect(page.locator(".sidebar-desktop")).not.toHaveClass(
          /sidebar-collapsed/,
        );
    }
  }
  await page.goto(`${baseURL}/new-session?sidebar=expanded`);
  await expect(page.locator(".sidebar-desktop")).toBeVisible();
  await expect(page.locator(".sidebar-desktop")).not.toHaveClass(
    /sidebar-collapsed/,
  );
});

test("a sibling tab shows projects while version and catalog requests are held", async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const projects = await (await request.get(`${baseURL}/api/projects`)).json();
  const project = projects.projects.find((row: { path: string }) =>
    row.path.endsWith("/mockproject"),
  );
  expect(project).toBeTruthy();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const sibling = await context.newPage();
  const attempts: string[] = [];
  sibling.on("request", (req) => {
    if (req.method() === "POST" && /sessions|project-queue/.test(req.url()))
      attempts.push(req.url());
  });
  try {
    // The existing tab need not have visited New Session: the shared sidebar
    // keeps its accepted project display rows available to sibling tabs.
    await page.goto(`${baseURL}/projects`);
    await page.waitForFunction(
      () =>
        localStorage.getItem('ya:new-session-projects:["local",null]') !== null,
    );
    await sibling.route(
      /\/api\/(?:projects|recents|version)(?:[/?]|$)/,
      async (route) => {
        await gate;
        await route.continue();
      },
    );
    await sibling.addInitScript(() => {
      const samples: number[] = [];
      let keyAt = 0;
      document.addEventListener(
        "keydown",
        () => {
          keyAt = performance.now();
        },
        true,
      );
      document.addEventListener(
        "input",
        () => {
          samples.push(performance.now() - keyAt);
        },
        true,
      );
      Object.assign(window, { projectSnapshotTypingSamples: samples });
    });
    await sibling.goto(
      `${baseURL}/new-session?projectId=${encodeURIComponent(project.id)}`,
      { waitUntil: "commit" },
    );
    await expect(sibling.locator(".new-session-project-input")).toHaveValue(
      project.path,
    );
    await expect(
      sibling.getByText("Refreshing project…", { exact: false }),
    ).toBeVisible();
    await expect(
      sibling.locator(".new-session-model-field button").first(),
    ).toBeVisible();
    const composer = sibling.locator("textarea.new-session-form-textarea");
    await composer.fill("");
    await composer.pressSequentially("project snapshot typing", { delay: 10 });
    await expect(composer).toHaveValue("project snapshot typing");
    await composer.press("Enter");
    await composer.press("ControlOrMeta+Enter");
    expect(attempts).toEqual([]);
    const samples = await sibling.evaluate(() =>
      (
        window as unknown as { projectSnapshotTypingSamples: number[] }
      ).projectSnapshotTypingSamples.slice(1),
    );
    expect(samples.length).toBeGreaterThan(10);
    expect(Math.max(...samples)).toBeLessThan(100);
    for (const viewport of [
      { width: 1000, height: 600 },
      { width: 375, height: 812 },
    ]) {
      await sibling.setViewportSize(viewport);
      await recordUiCapture(
        sibling,
        `new-session-project-snapshot-${viewport.width}`,
      );
    }
    release();
    await expect(
      sibling.getByText("Refreshing project…", { exact: false }),
    ).toHaveCount(0);
    await expect(sibling.locator(".new-session-project-input")).toHaveValue(
      project.path,
    );
    await expect(composer).toHaveValue("project snapshot typing");
    expect(attempts).toEqual([]);
  } finally {
    release();
    await sibling.close();
  }
});

test("a sibling tab shows saved model and effort before settings or catalogs arrive", async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const before = await (await request.get(`${baseURL}/api/settings`)).json();
  const headers = { "X-Yep-Anywhere": "true" };
  const update = await request.put(`${baseURL}/api/settings`, {
    headers,
    data: {
      newSessionDefaults: {
        provider: "claude",
        providers: {
          claude: { model: "sonnet", thinkingMode: "on", effortLevel: "high" },
        },
      },
    },
  });
  expect(update.ok()).toBe(true);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const sibling = await context.newPage();
  try {
    await context.route(/\/api\/providers(?:\?.*)?$/, async (route) => {
      await gate;
      await route.continue();
    });
    await page.goto(`${baseURL}/new-session`);
    await expect(
      page.locator(".new-session-model-field button").first(),
    ).toContainText("Sonnet");
    await page.waitForFunction(
      () => localStorage.getItem('ya:provider-row:["local","claude"]') !== null,
    );
    expect(
      await page.evaluate(() => localStorage.getItem("ya:providers:local")),
    ).toBeNull();
    await sibling.route("**/api/settings", async (route) => {
      await gate;
      await route.continue();
    });
    await sibling.route(/\/api\/providers\/claude(?:\?.*)?$/, async (route) => {
      await gate;
      await route.continue();
    });
    await sibling.goto(page.url(), { waitUntil: "commit" });
    await expect(
      sibling.locator(".new-session-model-field button").first(),
    ).toContainText("Sonnet");
    await expect(
      sibling.locator(
        '.new-session-helper-section button[aria-label*="Thinking"]',
      ),
    ).toContainText("High");
    await expect(
      sibling.locator(".new-session-provider-section button"),
    ).toContainText("Claude");
    const composer = sibling.locator("textarea.new-session-form-textarea");
    const originalDraft = await composer.inputValue();
    await composer.press("ControlOrMeta+End");
    await composer.pressSequentially("cached choices, live typing", {
      delay: 10,
    });
    await expect(composer).toHaveValue(
      `${originalDraft}cached choices, live typing`,
    );
    for (const viewport of [
      { width: 1000, height: 600 },
      { width: 375, height: 812 },
    ]) {
      await sibling.setViewportSize(viewport);
      await recordUiCapture(
        sibling,
        `new-session-retained-defaults-${viewport.width}`,
      );
    }
  } finally {
    release();
    await sibling.close();
    const restored = await request.put(`${baseURL}/api/settings`, {
      headers,
      data: { newSessionDefaults: before.settings.newSessionDefaults ?? {} },
    });
    expect(restored.ok()).toBe(true);
  }
});
