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
    localStorage.setItem("yep-anywhere-sidebar-expanded", "true");
    localStorage.setItem("yep-anywhere-sidebar-width", "360");
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
    Object.assign(window, { typingSamples: samples });
  });
  const release = await holdScripts(page);
  // DOMContentLoaded waits for the held module scripts, so only commit.
  await page.goto(`${baseURL}/new-session`, { waitUntil: "commit" });

  const preboot = page.locator("#yep-preboot-composer textarea");
  await expect(preboot).toBeFocused();
  await page.keyboard.type("typed before boot", { delay: 10 });
  // Enter sends in the app; it must not become a newline in the meantime.
  await page.keyboard.press("Enter");
  await expect(preboot).toHaveValue("typed before boot");

  const earlyBox = await preboot.boundingBox();
  await release();

  const composer = page.locator("textarea.new-session-form-textarea");
  await expect(composer).toBeFocused({ timeout: 30_000 });
  await expect(page.locator("#yep-preboot-composer")).toHaveCount(0);
  await page.keyboard.type(" and after", { delay: 10 });
  await expect(composer).toHaveValue("typed before boot and after");

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
