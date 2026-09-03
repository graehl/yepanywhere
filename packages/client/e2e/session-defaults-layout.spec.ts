import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.js";

test.use({ serviceWorkers: "block" });

async function dismissOnboardingIfVisible(page: Page) {
  const dialog = page.getByText("Welcome to yepanywhere");
  const appeared = await dialog
    .waitFor({ state: "visible", timeout: 2_000 })
    .then(() => true)
    .catch(() => false);
  if (!appeared) return;
  await page.getByRole("button", { name: "Skip all" }).click({ force: true });
  await expect(dialog).not.toBeVisible();
}

async function capture(page: Page, name: string) {
  const directory = process.env.YEP_E2E_UI_CAPTURE_DIR;
  if (!directory) return;
  mkdirSync(directory, { recursive: true });
  await page.screenshot({
    animations: "disabled",
    path: join(directory, name),
  });
}

for (const viewport of [
  { name: "desktop", width: 1000, height: 600 },
  { name: "phone", width: 375, height: 812 },
] as const) {
  test(`keeps recap duration clear of suggestions on ${viewport.name}`, async ({
    page,
    baseURL,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto(`${baseURL}/settings/model`);
    await dismissOnboardingIfVisible(page);

    const recap = page.locator('[data-settings-item="session-default-recap"]');
    await expect(recap).toBeVisible({ timeout: 10_000 });
    await recap.getByRole("button", { name: "Forked" }).click();

    const duration = page.locator(".recap-after-seconds-control--inline");
    const suggestions = page.locator(
      '[data-settings-item="session-default-suggestions"]',
    );
    const seconds = duration.getByRole("spinbutton", {
      name: "Recap after seconds away",
    });
    await expect(duration).toBeVisible();
    await expect(suggestions).toBeVisible();
    await expect(seconds).toBeVisible();
    await duration.scrollIntoViewIfNeeded();

    const durationBox = await duration.boundingBox();
    const suggestionsBox = await suggestions.boundingBox();
    const secondsBox = await seconds.boundingBox();
    if (!durationBox || !suggestionsBox || !secondsBox) {
      throw new Error("Session Defaults controls have no layout box");
    }
    const boxesOverlap =
      durationBox.x < suggestionsBox.x + suggestionsBox.width &&
      durationBox.x + durationBox.width > suggestionsBox.x &&
      durationBox.y < suggestionsBox.y + suggestionsBox.height &&
      durationBox.y + durationBox.height > suggestionsBox.y;
    const secondsOverlapSuggestions =
      secondsBox.x < suggestionsBox.x + suggestionsBox.width &&
      secondsBox.x + secondsBox.width > suggestionsBox.x &&
      secondsBox.y < suggestionsBox.y + suggestionsBox.height &&
      secondsBox.y + secondsBox.height > suggestionsBox.y;

    expect(boxesOverlap).toBe(false);
    expect(secondsOverlapSuggestions).toBe(false);
    expect(suggestionsBox.y).toBeGreaterThanOrEqual(
      durationBox.y + durationBox.height,
    );
    expect(secondsBox.x + secondsBox.width).toBeLessThanOrEqual(viewport.width);
    await expect(seconds).toHaveValue(/\d+/);
    await expect(
      page.getByText("Server changed", { exact: false }),
    ).toHaveCount(0);

    await capture(
      page,
      `${viewport.name}-${viewport.width}x${viewport.height}.png`,
    );
  });
}
