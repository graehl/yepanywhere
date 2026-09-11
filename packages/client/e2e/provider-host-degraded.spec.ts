import { expect, test } from "./fixtures.js";
import { recordUiCapture } from "./support/ui-capture.js";

for (const viewport of [
  { width: 1000, height: 600 },
  { width: 375, height: 812 },
]) {
  test(`degraded provider host keeps navigation reachable at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.route("**/api/version", async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        json: { ...(await response.json()), providerHostDegraded: true },
      });
    });
    await page.goto("/");
    const banner = page.locator('[data-provider-host-degraded="true"]');
    await expect(banner).toBeVisible();
    const toggle = page.getByRole("button", {
      name: "Open sidebar",
      exact: true,
    });
    await expect(toggle).toBeVisible();
    const bannerBox = await banner.boundingBox();
    const toggleBox = await toggle.boundingBox();
    expect(toggleBox!.y).toBeGreaterThanOrEqual(
      bannerBox!.y + bannerBox!.height,
    );
    await recordUiCapture(
      page,
      `provider-host-degraded-${viewport.width}`,
      viewport,
    );
    await toggle.click();
    await expect(
      page.getByRole("link", { name: "Settings", exact: true }).first(),
    ).toBeVisible();
    await page
      .getByRole("link", { name: "Settings", exact: true })
      .first()
      .click();
    await expect(page).toHaveURL(/settings/);
  });
}
