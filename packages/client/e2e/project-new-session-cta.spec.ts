import { join } from "node:path";
import { e2ePaths, expect, test } from "./fixtures.js";

const mockProjectPath = join(e2ePaths.tempDir, "mockproject");
const projectId = Buffer.from(mockProjectPath).toString("base64url");

test.describe("Project-scoped new session CTA", () => {
  test("shows the CTA when entering sessions from Projects", async ({
    page,
    baseURL,
  }) => {
    await page.goto(`${baseURL}/projects`);

    const projectCard = page.locator(".project-card__link", {
      hasText: "mockproject",
    });
    await expect(projectCard).toBeVisible();

    await projectCard.click();

    await expect(page).toHaveURL(
      new RegExp(`/sessions\\?project=${projectId}&source=projects`),
    );
    await expect(page.getByText("mockproject")).toBeVisible();
    await expect(page.getByText("Open session for")).toBeVisible();
    await expect(
      page.locator(".global-sessions-project-cta").getByRole("button", {
        name: "New Session",
      }),
    ).toBeVisible();
  });

  test("prefills the new session prompt from project search text", async ({
    page,
    baseURL,
  }) => {
    await page.goto(`${baseURL}/projects`);

    const projectCard = page.locator(".project-card__link", {
      hasText: "mockproject",
    });
    await expect(projectCard).toBeVisible();
    await projectCard.click();

    const query = "summarize the current mock session";
    const searchInput = page.getByPlaceholder("Search sessions...");
    await searchInput.fill(query);
    await searchInput.press("Enter");

    await expect(page).toHaveURL(
      new RegExp(
        `/sessions\\?project=${projectId}&source=projects&q=${encodeURIComponent(query).replace(/%20/g, "\\+")}`,
      ),
    );
    await expect(page.getByText("First prompt")).toBeVisible();
    await expect(page.getByText(query)).toBeVisible();

    await page
      .locator(".global-sessions-project-cta")
      .getByRole("button", { name: "New Session" })
      .click();

    await expect(page).toHaveURL(
      new RegExp(`/new-session\\?projectId=${projectId}`),
    );
    await expect(
      page.getByPlaceholder("Describe what you'd like help with..."),
    ).toHaveValue(query);
  });
});
