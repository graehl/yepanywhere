import {
  DEFAULT_PROJECT_TEMPLATE_SOURCES,
  type ProjectTemplateSourceState,
} from "@yep-anywhere/shared";
import { expect, test } from "./fixtures.js";
import { recordUiCapture } from "./support/ui-capture.js";

test.use({ serviceWorkers: "block" });

for (const viewport of [
  { name: "desktop", width: 1200, height: 600 },
  { name: "phone", width: 375, height: 812 },
]) {
  test(`edits ordered template sources and preserves typing on ${viewport.name}`, async ({
    page,
    baseURL,
  }) => {
    await page.setViewportSize(viewport);
    let state: ProjectTemplateSourceState = {
      config: structuredClone(DEFAULT_PROJECT_TEMPLATE_SOURCES),
      phase: "disabled",
    };
    let writes = 0;
    await page.route("**/api/project-template-source", async (route) => {
      if (route.request().method() === "PUT") {
        writes++;
        state = { config: route.request().postDataJSON(), phase: "fetching" };
      } else if (state.phase === "fetching") {
        state = {
          ...state,
          phase: "ready",
          result: "up-to-date",
          snapshot: {
            sources: state.config.sources.map((source) => ({
              ...source,
              commit: "a".repeat(40),
              rawDirectory: "/cache/raw",
              directory: "/cache/content",
              rewrittenFiles: 3,
            })),
            templates: [
              {
                id: "storybook",
                sourceId: "ya-default",
                title: "Storybook",
                description: "Stories with illustrations",
                status: "draft",
              },
            ],
          },
        };
      }
      await route.fulfill({ json: state });
    });
    await page.goto(`${baseURL}/settings/project-templates`);
    await expect(
      page.getByText("Templates disabled. No content is fetched."),
    ).toBeVisible();
    await page.getByLabel("Enable project templates").check();
    await page.getByRole("button", { name: "Add source", exact: true }).click();
    const repositories = page.getByLabel("GitHub or local dir", {
      exact: true,
    });
    await expect(repositories.first()).toHaveValue(
      "https://github.com/graehl/agents/project-templates",
    );
    await repositories.nth(1).fill("https://github.com/example/community");
    await expect(
      page.getByLabel("Subdirectory (optional)", { exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Fetch / update", exact: true })
      .click();
    const revision = page
      .getByLabel("Revision (branch, tag or commit)", { exact: true })
      .nth(1);
    await revision.fill("");
    let typed = "";
    for (const character of "community-branch") {
      typed += character;
      await revision.pressSequentially(character);
      await expect(revision).toHaveValue(typed, { timeout: 100 });
    }
    await expect(
      page.getByText("Already up to date.", { exact: true }),
    ).toBeVisible();
    await expect(revision).toHaveValue("community-branch");
    expect(writes).toBe(1);
    expect(state.config.sources).toHaveLength(2);
    expect(state.config.sources[1]?.contentPath).toBe("");
    expect(state.config.sources[0]?.contentPath).toBe("project-templates");
    await page
      .getByRole("button", { name: "Move up", exact: true })
      .nth(1)
      .click();
    await expect(repositories.first()).toHaveValue(
      "https://github.com/example/community",
    );
    await page.getByRole("button", { name: "Add source", exact: true }).click();
    await page
      .getByLabel("Revision (branch, tag or commit)", { exact: true })
      .nth(2)
      .fill("");
    await repositories.nth(2).fill("~/community/templates");
    await expect(
      page.getByLabel("Revision (branch, tag or commit)", { exact: true }),
    ).toHaveCount(2);
    await page
      .getByRole("button", { name: "Fetch / update", exact: true })
      .click();
    await expect.poll(() => writes).toBe(2);
    expect(state.config.sources[2]).toMatchObject({
      repository: "~/community/templates",
      contentPath: "",
      revision: "HEAD",
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await recordUiCapture(page, `template-sources-${viewport.name}`);
  });
}

for (const release of ["0.8.0", "0.8.1"])
  test(`older server ${release} receives no template source requests`, async ({
    page,
    baseURL,
  }) => {
    await page.route("**/api/version*", async (route) => {
      const response = await route.fetch();
      const version = await response.json();
      for (const field of [
        "capabilityEncoding",
        "capabilityBits",
        "deniedCapabilityBits",
        "optionalCapabilityBits",
        "capabilityExtensions",
      ])
        delete version[field];
      await route.fulfill({
        json: {
          ...version,
          current: release,
          capabilities: [],
          // The banner proves this response reached the shared version store;
          // absent controls alone also pass before version discovery completes.
          providerHostDegraded: true,
        },
      });
    });
    let requests = 0;
    await page.route("**/api/project-template-source", async (route) => {
      requests++;
      await route.fulfill({ status: 404 });
    });
    await page.route("**/api/project-templates/**", async (route) => {
      requests++;
      await route.fulfill({ status: 404 });
    });
    await page.goto(`${baseURL}/settings/project-templates`);
    await expect(
      page.getByRole("searchbox", { name: "Search settings" }),
    ).toBeVisible();
    await expect(
      page.locator('[data-provider-host-degraded="true"]'),
    ).toBeVisible();
    await expect(page.getByLabel("Enable project templates")).toHaveCount(0);
    await page.goto(`${baseURL}/projects`);
    await page
      .getByRole("button", { name: "Add Project", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "From template", exact: true }),
    ).toHaveCount(0);
    await page.goto(`${baseURL}/new-session`);
    await expect(
      page.locator('[data-provider-host-degraded="true"]'),
    ).toBeVisible();
    // New project also creates a plain folder on older servers. Only the
    // template choices and requests require the template capability.
    await page
      .getByRole("button", { name: "New project", exact: true })
      .click();
    await expect(page.getByText("Empty folder", { exact: true })).toBeVisible();
    await expect(page.getByText("Storybook", { exact: true })).toHaveCount(0);
    expect(requests).toBe(0);
  });

// Explicit network integration: a reproducible real source, not a mocked Git tree.
const DEFAULT_SOURCE_COMMIT = "635f865044709f8262f3c6f9620ed75225989687";
test("fetches and composes the pinned YA-default source through the UI", async ({
  page,
  baseURL,
}) => {
  test.skip(
    process.env.YEP_E2E_TEMPLATE_NETWORK !== "1",
    "Set YEP_E2E_TEMPLATE_NETWORK=1 to fetch the pinned GitHub source",
  );
  test.setTimeout(180_000);
  await page.goto(`${baseURL}/settings/project-templates`);
  await expect(
    page.getByText("Templates disabled. No content is fetched."),
  ).toBeVisible();
  await page.getByLabel("Enable project templates").check();
  await page
    .getByLabel("Revision (branch, tag or commit)", { exact: true })
    .fill(DEFAULT_SOURCE_COMMIT);
  await page
    .getByRole("button", { name: "Fetch / update", exact: true })
    .click();
  await expect(
    page.getByText("Template sources validated.", { exact: true }),
  ).toBeVisible({ timeout: 150_000 });
  await expect(
    page.getByText(DEFAULT_SOURCE_COMMIT, { exact: true }),
  ).toBeVisible();
  for (const title of ["App canvas", "Storybook", "Web page"])
    await expect(page.getByText(title, { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Fetch / update", exact: true })
    .click();
  await expect(
    page.getByText("Already up to date.", { exact: true }),
  ).toBeVisible();
});
