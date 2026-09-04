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
  await page.mouse.move(0, 0);
  await page.waitForTimeout(50);
  await page.screenshot({
    animations: "disabled",
    path: join(directory, name),
  });
}

for (const viewport of [
  { name: "desktop", width: 1000, height: 600 },
  { name: "phone", width: 375, height: 812 },
] as const) {
  test(`pairs show thinking with suggestions on ${viewport.name}`, async ({
    page,
    baseURL,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto(`${baseURL}/settings/model`);
    await dismissOnboardingIfVisible(page);

    const showThinking = page.locator(
      '[data-settings-item="session-default-show-thinking"]',
    );
    const suggestions = page.locator(
      '[data-settings-item="session-default-suggestions"]',
    );
    const recap = page.locator('[data-settings-item="session-default-recap"]');
    await expect(showThinking).toBeVisible({ timeout: 10_000 });
    await expect(suggestions).toBeVisible();
    await expect(recap).toBeVisible({ timeout: 10_000 });
    await recap.getByRole("button", { name: "Forked" }).click();

    const duration = page.locator(".recap-after-seconds-control--inline");
    const seconds = duration.getByRole("spinbutton", {
      name: "Recap after seconds away",
    });
    await expect(duration).toBeVisible();
    await expect(seconds).toBeVisible();
    await showThinking.scrollIntoViewIfNeeded();

    const showThinkingBox = await showThinking.boundingBox();
    const suggestionsBox = await suggestions.boundingBox();
    const recapBox = await recap.boundingBox();
    const durationBox = await duration.boundingBox();
    const secondsBox = await seconds.boundingBox();
    if (
      !showThinkingBox ||
      !suggestionsBox ||
      !recapBox ||
      !durationBox ||
      !secondsBox
    ) {
      throw new Error("Session Defaults controls have no layout box");
    }

    if (viewport.name === "desktop") {
      expect(Math.abs(showThinkingBox.y - suggestionsBox.y)).toBeLessThan(2);
      expect(suggestionsBox.x).toBeGreaterThanOrEqual(
        showThinkingBox.x + showThinkingBox.width,
      );
    } else {
      expect(suggestionsBox.y).toBeGreaterThanOrEqual(
        showThinkingBox.y + showThinkingBox.height,
      );
    }
    expect(recapBox.y).toBeGreaterThanOrEqual(
      Math.max(
        showThinkingBox.y + showThinkingBox.height,
        suggestionsBox.y + suggestionsBox.height,
      ),
    );
    expect(durationBox.y).toBeGreaterThanOrEqual(recapBox.y + recapBox.height);
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

  test(`expands New Session option explanations on ${viewport.name}`, async ({
    page,
    baseURL,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto(`${baseURL}/new-session?detached=1`);
    await dismissOnboardingIfVisible(page);

    const toggle = page.getByRole("button", {
      name: "Show option explanations",
    });
    const project = page.locator(".new-session-project-slot");
    const projectSummary = page.locator(".new-session-project-summary");
    const primaryOptions = page.locator(".new-session-provider-slot");
    const secondaryOptions = page.locator(
      '[data-new-session-secondary-options="true"]',
    );
    const showThinking = page.locator(".new-session-show-thinking-section");
    const explanation = "Show the model's thinking";
    await expect(toggle).toBeVisible({ timeout: 10_000 });
    await expect(project).toBeVisible();
    await expect(primaryOptions).toBeVisible();
    await expect(secondaryOptions).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(showThinking).toHaveAttribute(
      "data-tooltip",
      /Show the model's thinking/,
    );
    await expect(page.getByText(explanation, { exact: false })).toHaveCount(0);

    const projectBox = await project.boundingBox();
    const primaryOptionsBox = await primaryOptions.boundingBox();
    const secondaryOptionsBox = await secondaryOptions.boundingBox();
    if (!projectBox || !primaryOptionsBox || !secondaryOptionsBox) {
      throw new Error("New Session controls have no layout box");
    }
    if (viewport.name === "desktop") {
      expect(secondaryOptionsBox.x).toBeGreaterThanOrEqual(projectBox.x);
      expect(secondaryOptionsBox.y).toBeGreaterThanOrEqual(
        projectBox.y + projectBox.height,
      );
    } else {
      expect(secondaryOptionsBox.y).toBeGreaterThanOrEqual(
        primaryOptionsBox.y + primaryOptionsBox.height,
      );
    }

    await projectSummary.click();
    const projectPanel = page.locator("#new-session-project-panel");
    await expect(projectPanel).toBeVisible();
    await expect(secondaryOptions).toBeHidden();
    await projectSummary.click();
    await expect(projectPanel).not.toBeVisible();
    await expect(secondaryOptions).toBeVisible();

    await capture(
      page,
      `new-session-${viewport.name}-compact-${viewport.width}x${viewport.height}.png`,
    );

    await toggle.click();
    await expect(
      page.getByRole("button", { name: "Hide option explanations" }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText(explanation, { exact: false })).toBeVisible();
    await expect(
      page.getByText("Server changed", { exact: false }),
    ).toHaveCount(0);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator(".page-scroll-container").evaluate((container) => {
      container.scrollTop = 0;
    });
    await capture(
      page,
      `new-session-${viewport.name}-expanded-${viewport.width}x${viewport.height}.png`,
    );
  });
}
