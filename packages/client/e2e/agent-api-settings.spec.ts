import { expect, test } from "./fixtures.js";
import { recordUiCapture } from "./support/ui-capture.js";

test("agent API discovery previews its bootstrap and acknowledges typing during a settings reply", async ({
  page,
  baseURL,
}) => {
  let enabled = false;
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  // Browser-owned writes keep this case independent of other fixture settings.
  await page.route("**/api/settings", async (route) => {
    const response = await page.request.get(route.request().url());
    const body = await response.json();
    if (route.request().method() === "PUT") {
      enabled = route.request().postDataJSON().agentApiEnabled === true;
      await held;
    }
    await route.fulfill({
      response,
      json: {
        ...body,
        settings: { ...body.settings, agentApiEnabled: enabled },
      },
    });
  });
  try {
    await page.setViewportSize({ width: 1000, height: 600 });
    await page.goto(`${baseURL}/settings/local-access`);
    const skip = page.locator(".onboarding-skip-all");
    if (await skip.isVisible()) await skip.click();
    const toggle = page.getByRole("checkbox", {
      name: "Agent API discovery",
      exact: true,
    });
    const toggleControl = toggle.locator("..");
    await expect(toggleControl).toBeVisible();
    await expect(toggle).not.toBeChecked();
    await toggleControl.scrollIntoViewIfNeeded();
    await recordUiCapture(page, "agent-api-desktop");
    await toggleControl.click();
    const search = page.getByRole("searchbox", { name: "Search settings" });
    await search.focus();
    await search.evaluate((element) => {
      const input = element as HTMLInputElement;
      (window as unknown as { apiTyping: number[] }).apiTyping = [];
      input.addEventListener("keydown", () => {
        const start = performance.now();
        input.addEventListener(
          "input",
          () =>
            requestAnimationFrame(() => {
              (window as unknown as { apiTyping: number[] }).apiTyping.push(
                performance.now() - start,
              );
            }),
          { once: true },
        );
      });
    });
    let typed = "";
    for (const character of "Agent API discovery") {
      typed += character;
      if (typed.length === 4) release();
      await search.pressSequentially(character);
      await expect(search).toHaveValue(typed, { timeout: 100 });
    }
    await expect(toggle).toBeChecked();
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as unknown as { apiTyping: number[] }).apiTyping.length,
        ),
      )
      .toBe(typed.length);
    const times = await page.evaluate(
      () => (window as unknown as { apiTyping: number[] }).apiTyping,
    );
    expect(Math.max(...times), JSON.stringify(times)).toBeLessThanOrEqual(100);
    await search.clear();
    await page.goto(`${baseURL}/settings/local-access`);
    await expect(toggle).toBeChecked();
    const preview = page.getByText("Preview agent instructions", {
      exact: true,
    });
    const details = preview.locator("..");
    if (!(await details.evaluate((node) => (node as HTMLDetailsElement).open)))
      await preview.click();
    await expect(details).toHaveAttribute("open", "");
    await expect(details).toContainText("AGENT_YA_V0_AUTHORIZATION");
    await details.scrollIntoViewIfNeeded();
    await recordUiCapture(page, "agent-api-desktop-preview");
    await page.setViewportSize({ width: 375, height: 812 });
    if (await details.evaluate((node) => (node as HTMLDetailsElement).open))
      await preview.click();
    await expect(details).not.toHaveAttribute("open", "");
    await toggleControl.scrollIntoViewIfNeeded();
    await recordUiCapture(page, "agent-api-phone");
    if (!(await details.evaluate((node) => (node as HTMLDetailsElement).open)))
      await preview.click();
    await expect(details).toHaveAttribute("open", "");
    await preview.scrollIntoViewIfNeeded();
    await recordUiCapture(page, "agent-api-phone-preview");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  } finally {
    release();
  }
});
