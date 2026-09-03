import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { e2ePaths, expect, test } from "./fixtures.js";

const mockProjectPath = join(e2ePaths.tempDir, "mockproject");
const projectId = Buffer.from(mockProjectPath).toString("base64url");
const sessionId = "mock-session-001";

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
  { name: "desktop", width: 1000, height: 600, touch: false },
  { name: "phone", width: 375, height: 812, touch: true },
] as const) {
  test(`hides a toolbar control from its ${viewport.name} hint`, async ({
    page,
    baseURL,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto(`${baseURL}/projects/${projectId}/sessions/${sessionId}`);
    await dismissOnboardingIfVisible(page);

    let control = page
      .locator('[data-session-toolbar-control="attachments"]')
      .filter({ visible: true })
      .first();
    if (!(await control.isVisible())) {
      control = page
        .locator("[data-session-toolbar-control]")
        .filter({ visible: true })
        .first();
    }
    await expect(control).toBeVisible({ timeout: 10_000 });
    const controlKey = await control.getAttribute(
      "data-session-toolbar-control",
    );
    if (!controlKey) throw new Error("Toolbar control marker has no key");
    if (viewport.touch) {
      await control.dispatchEvent("touchstart");
      await control.dispatchEvent("contextmenu");
    } else {
      await control.click({ button: "right" });
    }

    const quickHide = page.getByRole("dialog", {
      name: "Toolbar control actions",
    });
    await expect(quickHide.locator("span").first()).not.toHaveText("");
    await expect(quickHide.getByRole("button", { name: "Hide" })).toBeVisible();
    await expect(quickHide).toBeInViewport();
    await expect(
      page.getByText("Server changed", { exact: false }),
    ).toHaveCount(0);

    await capture(
      page,
      `${viewport.name}-${viewport.width}x${viewport.height}.png`,
    );

    await quickHide.getByRole("button", { name: "Hide" }).click();
    await expect(
      page.locator(`[data-session-toolbar-control="${controlKey}"]`),
    ).toBeHidden();
  });
}
