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
  await page.waitForTimeout(1_000);
  await page.screenshot({ path: join(directory, name) });
}

async function captureMenu(page: Page, name: string) {
  const directory = process.env.YEP_E2E_UI_CAPTURE_DIR;
  if (!directory) return;
  mkdirSync(directory, { recursive: true });
  await page.getByRole("menu").screenshot({ path: join(directory, name) });
}

test("shows provider-owned slash hints and argument completions", async ({
  page,
  baseURL,
}) => {
  await page.route(
    (url) =>
      url.pathname === `/api/projects/${projectId}/sessions/${sessionId}`,
    async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as Record<string, unknown>;
      await route.fulfill({
        response,
        json: {
          ...body,
          slashCommands: [
            {
              name: "goal",
              description:
                "Keep working toward a verifiable end state until it is met",
              argumentHint: "<verifiable end state>",
              argumentCompletions: [
                { value: "clear", description: "Remove the current goal" },
                { value: "pause", description: "Pause the current goal" },
                { value: "resume", description: "Resume the current goal" },
              ],
              invocation: { kind: "native", prefix: "/" },
            },
          ],
        },
      });
    },
  );

  await page.setViewportSize({ width: 1000, height: 600 });
  await page.goto(`${baseURL}/projects/${projectId}/sessions/${sessionId}`);
  await dismissOnboardingIfVisible(page);

  const composer = page.locator("[data-composer-input]");
  await expect(composer).toBeVisible({ timeout: 10_000 });
  await expect(
    page.getByText("Previous message", { exact: true }).last(),
  ).toBeVisible();
  await composer.fill("/go");
  const goalCommand = page.getByRole("menuitem", { name: "/goal" });
  await expect(goalCommand).toContainText("<verifiable end state>");
  await expect(goalCommand).toContainText(
    "Keep working toward a verifiable end state until it is met",
  );
  await capture(page, "goal-hint-desktop-1000x600.png");

  await page.reload();
  await dismissOnboardingIfVisible(page);
  await expect(composer).toBeVisible({ timeout: 10_000 });
  await expect(
    page.getByText("Previous message", { exact: true }).last(),
  ).toBeVisible();
  await composer.fill("/goal ");
  await expect(
    page.getByRole("menuitem", { name: "/goal clear" }),
  ).toBeVisible();
  await expect(page.getByText("Remove the current goal")).toBeVisible();
  await captureMenu(page, "goal-verbs-desktop-1000x600.png");

  await page.setViewportSize({ width: 375, height: 812 });
  await page.reload();
  await dismissOnboardingIfVisible(page);
  await expect(composer).toBeVisible({ timeout: 10_000 });
  await expect(
    page.getByText("Previous message", { exact: true }).last(),
  ).toBeVisible();
  await composer.fill("/go");
  await expect(goalCommand).toContainText("<verifiable end state>");
  await capture(page, "goal-hint-mobile-375x812.png");

  await page.reload();
  await dismissOnboardingIfVisible(page);
  await expect(composer).toBeVisible({ timeout: 10_000 });
  await expect(
    page.getByText("Previous message", { exact: true }).last(),
  ).toBeVisible();
  await composer.fill("/goal ");
  await expect(
    page.getByRole("menuitem", { name: "/goal resume" }),
  ).toBeVisible();
  await captureMenu(page, "goal-verbs-mobile-375x812.png");

  await composer.fill("/go");
  await composer.press("Enter");
  await expect(composer).toHaveValue("/goal ");
});
